import { basename } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { byRecentUse, PROMPT_NAME_MAX, PROMPT_TEXT_MAX, RpcError, SavedPromptId, type PromptScope, type SavedPrompt, type SavedPromptInput } from '@seshboard/protocol';
import { slugify } from '../actions/actionStore.ts';
import { entriesOf, readSharedFile, removeEntry, SHARED_FILE, upsertEntry, writeSharedFile } from '../actions/sharedFile.ts';

/** Where an entry's keys go in the shared file: these first, then anything else it had. */
const ENTRY_ORDER = ['id', 'name', 'text'] as const;

interface Row {
  id: string;
  project_root: string | null;
  name: string;
  text: string;
  created_at: number;
  updated_at: number;
  uses: number;
  last_used_at: number | null;
}

/** The id of a shared entry: its own, else made from its name. */
const sharedId = (raw: Record<string, unknown>, index: number) => (typeof raw.id === 'string' ? raw.id : slugify(String(raw.name ?? `prompt-${index + 1}`)));

const sameScope = (a: PromptScope, b: PromptScope) => a.kind === b.kind && (a.kind === 'global' || a.root === (b as { root: string }).root);

/** What a scope is called in a message. */
const scopeName = (scope: PromptScope) => (scope.kind === 'global' ? 'every project' : scope.kind === 'personal' ? 'this project, just for you' : `the project's ${SHARED_FILE}`);

/**
 * Saved prompts with blanks: yours for every project or one project (in the database), and the ones shared in a
 * project's .seshboard.json under `prompts`. How often you use a shared one stays in the database, never in the file.
 */
export class SavedPromptStore {
  private readonly statements;

  constructor(db: DatabaseSync) {
    this.statements = {
      list: db.prepare("SELECT * FROM saved_prompts WHERE COALESCE(project_root, '') = ?"),
      get: db.prepare("SELECT * FROM saved_prompts WHERE COALESCE(project_root, '') = ? AND id = ?"),
      insert: db.prepare('INSERT INTO saved_prompts (id, project_root, name, text, created_at, updated_at, uses, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
      update: db.prepare("UPDATE saved_prompts SET name = ?, text = ?, updated_at = ? WHERE COALESCE(project_root, '') = ? AND id = ?"),
      remove: db.prepare("DELETE FROM saved_prompts WHERE COALESCE(project_root, '') = ? AND id = ?"),
      used: db.prepare("UPDATE saved_prompts SET uses = uses + 1, last_used_at = ? WHERE COALESCE(project_root, '') = ? AND id = ?"),
      sharedUses: db.prepare('SELECT id, uses, last_used_at FROM shared_prompt_uses WHERE project_root = ?'),
      sharedUse: db.prepare('SELECT uses, last_used_at FROM shared_prompt_uses WHERE project_root = ? AND id = ?'),
      setSharedUse: db.prepare(
        'INSERT INTO shared_prompt_uses (project_root, id, uses, last_used_at) VALUES (?, ?, ?, ?) ON CONFLICT (project_root, id) DO UPDATE SET uses = excluded.uses, last_used_at = excluded.last_used_at',
      ),
      bumpSharedUse: db.prepare(
        'INSERT INTO shared_prompt_uses (project_root, id, uses, last_used_at) VALUES (?, ?, 1, ?) ON CONFLICT (project_root, id) DO UPDATE SET uses = uses + 1, last_used_at = excluded.last_used_at',
      ),
      removeSharedUse: db.prepare('DELETE FROM shared_prompt_uses WHERE project_root = ? AND id = ?'),
    };
  }

  /** Your prompts for every project, and with `root` the project's own (yours and shared), most recently used first. */
  list(root?: string): { prompts: SavedPrompt[]; errors: string[] } {
    const prompts = this.own({ kind: 'global' });
    let errors: string[] = [];
    if (root) {
      prompts.push(...this.own({ kind: 'personal', root }));
      const shared = this.shared(root);
      prompts.push(...shared.prompts);
      errors = shared.errors;
    }
    return { prompts: byRecentUse(prompts), errors };
  }

  /** One prompt, or NOT_FOUND. */
  get(id: string, scope: PromptScope): SavedPrompt {
    const found = scope.kind === 'shared' ? this.shared(scope.root).prompts.find((p) => p.id === id) : this.ownOne(id, scope);
    if (!found) throw new RpcError('NOT_FOUND', 'That prompt is gone. It may have been deleted or moved.');
    return found;
  }

  /** Creates a prompt (no id: one is made from its name) or updates it where it is. */
  save(input: SavedPromptInput, now = Date.now()): SavedPrompt {
    const name = input.name.trim();
    if (input.id) {
      const existing = this.find(input.id, input.scope);
      if (existing) return this.write({ ...existing, name, text: input.text, updatedAt: now }, false);
    }
    const id = this.freeId(input.id ?? slugify(name), input.scope);
    return this.write({ id, name, text: input.text, scope: input.scope, createdAt: now, updatedAt: now, uses: 0, lastUsedAt: null }, true);
  }

  remove(id: string, scope: PromptScope): void {
    if (scope.kind === 'shared') {
      if (!this.shared(scope.root).prompts.some((p) => p.id === id)) return;
      writeSharedFile(scope.root, (data) => removeEntry(data, 'prompts', id, sharedId));
      this.statements.removeSharedUse.run(scope.root, id);
      return;
    }
    this.statements.remove.run(rootOf(scope), id);
  }

  /**
   * Moves a prompt to another place, its use count along with it. The copy is written first and the original taken
   * out after, so a failure on the way loses nothing: when taking it out fails, the copy goes again and the error says why.
   */
  move(id: string, from: PromptScope, to: PromptScope, now = Date.now()): SavedPrompt {
    const prompt = this.get(id, from);
    if (sameScope(from, to)) return prompt;
    const targetId = this.freeId(prompt.id, to);
    const moved: SavedPrompt = { ...prompt, id: targetId, scope: to, updatedAt: now };
    try {
      this.write(moved, true);
    } catch (error) {
      throw explain(error, `Couldn't move “${prompt.name}” to ${scopeName(to)}`);
    }
    try {
      this.remove(id, from);
    } catch (error) {
      try {
        this.remove(targetId, to);
      } catch {
        // The copy stays: the prompt is in both places, which loses nothing.
      }
      throw explain(error, `Couldn't move “${prompt.name}” out of ${scopeName(from)}`);
    }
    return moved;
  }

  /** It was sent: one more use, now. */
  used(id: string, scope: PromptScope, now = Date.now()): void {
    if (scope.kind === 'shared') this.statements.bumpSharedUse.run(scope.root, id, now);
    else this.statements.used.run(now, rootOf(scope), id);
  }

  /** The project's shared prompts, with your use counts. Entries that don't read are reported, not fatal. */
  shared(root: string): { prompts: SavedPrompt[]; errors: string[] } {
    const read = readSharedFile(root);
    if (read.error) return { prompts: [], errors: [read.error] };
    const entries = entriesOf(read.data, 'prompts');
    if (!entries) return { prompts: [], errors: [`${basename(read.file)}: expected { "prompts": [...] }`] };
    const uses = new Map((this.statements.sharedUses.all(root) as unknown as Array<{ id: string; uses: number; last_used_at: number | null }>).map((row) => [row.id, row]));
    const prompts: SavedPrompt[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();
    for (const [i, entry] of entries.entries()) {
      const id = sharedId(entry, i);
      const problem = !SavedPromptId.safeParse(id).success
        ? 'its id can only have lowercase letters, digits and dashes'
        : typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > PROMPT_NAME_MAX
          ? `it needs a "name" of up to ${PROMPT_NAME_MAX} characters`
          : typeof entry.text !== 'string' || !entry.text || entry.text.length > PROMPT_TEXT_MAX
            ? `it needs a "text" of up to ${PROMPT_TEXT_MAX.toLocaleString('en-US')} characters`
            : seen.has(id)
              ? `another prompt has the id "${id}"`
              : null;
      if (problem) {
        errors.push(`${basename(read.file)} prompt ${i + 1}: ${problem}`);
        continue;
      }
      seen.add(id);
      const use = uses.get(id);
      prompts.push({
        id,
        name: (entry.name as string).trim(),
        text: entry.text as string,
        scope: { kind: 'shared', root },
        createdAt: read.mtime,
        updatedAt: read.mtime,
        uses: use?.uses ?? 0,
        lastUsedAt: use?.last_used_at ?? null,
      });
    }
    return { prompts, errors };
  }

  private own(scope: Exclude<PromptScope, { kind: 'shared' }>): SavedPrompt[] {
    return (this.statements.list.all(rootOf(scope)) as unknown as Row[]).map((row) => fromRow(row, scope));
  }

  private ownOne(id: string, scope: Exclude<PromptScope, { kind: 'shared' }>): SavedPrompt | null {
    const row = this.statements.get.get(rootOf(scope), id) as Row | undefined;
    return row ? fromRow(row, scope) : null;
  }

  private find(id: string, scope: PromptScope): SavedPrompt | null {
    return scope.kind === 'shared' ? (this.shared(scope.root).prompts.find((p) => p.id === id) ?? null) : this.ownOne(id, scope);
  }

  /** `wanted`, or `wanted-2`, `wanted-3`… when another prompt there has it. */
  private freeId(wanted: string, scope: PromptScope): string {
    const base = wanted.slice(0, 60).replace(/-+$/, '') || 'prompt';
    if (!this.find(base, scope)) return base;
    for (let i = 2; ; i++) if (!this.find(`${base}-${i}`, scope)) return `${base}-${i}`;
  }

  /** Writes a prompt where its scope says: a new one with its counts, or the name and text of one that is there. */
  private write(prompt: SavedPrompt, fresh: boolean): SavedPrompt {
    const { scope } = prompt;
    if (scope.kind === 'shared') {
      writeSharedFile(scope.root, (data) => upsertEntry(data, 'prompts', { id: prompt.id, name: prompt.name, text: prompt.text }, ENTRY_ORDER, sharedId));
      if (fresh) {
        if (prompt.uses > 0 || prompt.lastUsedAt !== null) this.statements.setSharedUse.run(scope.root, prompt.id, prompt.uses, prompt.lastUsedAt);
        else this.statements.removeSharedUse.run(scope.root, prompt.id);
      }
      return this.find(prompt.id, scope) ?? prompt;
    }
    if (fresh) this.statements.insert.run(prompt.id, scope.kind === 'global' ? null : scope.root, prompt.name, prompt.text, prompt.createdAt, prompt.updatedAt, prompt.uses, prompt.lastUsedAt);
    else this.statements.update.run(prompt.name, prompt.text, prompt.updatedAt, rootOf(scope), prompt.id);
    return prompt;
  }
}

const rootOf = (scope: Exclude<PromptScope, { kind: 'shared' }> | PromptScope) => (scope.kind === 'global' ? '' : scope.root);

const fromRow = (row: Row, scope: PromptScope): SavedPrompt => ({
  id: row.id,
  name: row.name,
  text: row.text,
  scope,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  uses: row.uses,
  lastUsedAt: row.last_used_at,
});

/** The error with what was being done in front of it; a WRITE_FAILED keeps its code. */
function explain(error: unknown, doing: string): RpcError {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof RpcError ? error.code : 'WRITE_FAILED';
  return new RpcError(code, `${doing}. ${message}`);
}
