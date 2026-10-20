import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  BUILTIN_PIPELINES,
  normaliseSharedPipeline,
  Pipeline,
  PipelineBody,
  pipelineProblem,
  RpcError,
  sharedPipelineId,
  validatePipeline,
  type PipelineSave,
  type PipelineSaveScope,
  type PipelineScope,
} from '@switchboard/protocol';
import { entriesOf, readSharedFile, removeEntry, SHARED_FILE, upsertEntry, writeSharedFile } from '../actions/sharedFile.ts';

interface Row {
  id: string;
  scope_root: string | null;
  name: string;
  json: string;
  created_at: number;
  updated_at: number;
}

/** Where an entry's keys go in the shared file: these first, then anything else it had. */
const ENTRY_ORDER = ['id', 'name', 'workspace', 'steps', 'confirmBefore'] as const;

const sameScope = (a: PipelineScope, b: PipelineScope) => a.kind === b.kind && (a.kind === 'builtin' || a.kind === 'global' || a.root === (b as { root: string }).root);

/** What a scope is called in a message. */
const scopeName = (scope: PipelineScope) =>
  scope.kind === 'builtin' ? 'the built-in pipelines' : scope.kind === 'global' ? 'every project' : scope.kind === 'project' ? 'this project' : `the project's ${SHARED_FILE}`;

/** What is saved of a pipeline: its body, as the schema reads it. */
const bodyOf = (pipeline: PipelineBody): PipelineBody => PipelineBody.parse({ name: pipeline.name, workspace: pipeline.workspace, steps: pipeline.steps, confirmBefore: pipeline.confirmBefore, ...(pipeline.autoPush ? { autoPush: true } : {}) });

/**
 * Pipelines (#179), like saved prompts: yours for every project or one project (in the database), the ones shared in
 * a project's .switchboard.json under `pipelines`, and the ones that ship with Switchboard (read only, to duplicate).
 * A shared pipeline is read as it will run here: no bypass permissions (default mode instead), no `autoPush`, and
 * `issues` saying what was changed or is wrong.
 */
export class PipelineStore {
  private readonly statements;

  constructor(
    db: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {
    this.statements = {
      list: db.prepare("SELECT * FROM pipelines WHERE COALESCE(scope_root, '') = ? ORDER BY created_at, rowid"),
      get: db.prepare('SELECT * FROM pipelines WHERE id = ?'),
      all: db.prepare('SELECT * FROM pipelines ORDER BY created_at, rowid'),
      insert: db.prepare('INSERT INTO pipelines (id, scope_root, name, json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'),
      update: db.prepare('UPDATE pipelines SET name = ?, json = ?, updated_at = ? WHERE id = ?'),
      remove: db.prepare('DELETE FROM pipelines WHERE id = ?'),
    };
  }

  /** The built-in pipelines, your own for every project, and with `root` the project's own and shared ones. */
  list(root?: string): { pipelines: Pipeline[]; errors: string[] } {
    const pipelines: Pipeline[] = [...BUILTIN_PIPELINES, ...this.own({ kind: 'global' })];
    let errors: string[] = [];
    if (root) {
      pipelines.push(...this.own({ kind: 'project', root }));
      const shared = this.shared(root);
      pipelines.push(...shared.pipelines);
      errors = shared.errors;
    }
    return { pipelines, errors };
  }

  find(id: string, scope: PipelineScope): Pipeline | null {
    if (scope.kind === 'builtin') return BUILTIN_PIPELINES.find((p) => p.id === id) ?? null;
    if (scope.kind === 'shared') return this.shared(scope.root).pipelines.find((p) => p.id === id) ?? null;
    const row = this.statements.get.get(id) as Row | undefined;
    if (!row) return null;
    const found = this.fromRow(row);
    return found && sameScope(found.scope, scope) ? found : null;
  }

  /** One pipeline, or NOT_FOUND. */
  get(id: string, scope: PipelineScope): Pipeline {
    const found = this.find(id, scope);
    if (!found) throw new RpcError('NOT_FOUND', 'That pipeline is gone. It may have been deleted or moved.');
    return found;
  }

  /** Creates a pipeline (no id) or changes it where it is. Refuses one that can't run, and bypass permissions in a shared one. */
  save(input: PipelineSave): Pipeline {
    const body = bodyOf(PipelineBody.parse(input));
    const problem = pipelineProblem(body);
    if (problem) throw new RpcError('INVALID', problem);
    if (input.scope.kind === 'shared') {
      const bypass = body.steps.find((s) => s.kind === 'claude' && s.permissionMode === 'bypassPermissions');
      if (bypass) throw new RpcError('INVALID', `“${bypass.name}” can’t bypass permissions in a pipeline shared with the project. Pick another mode.`);
      // A shared pipeline never pushes without you.
      delete body.autoPush;
    }
    const at = this.now();
    if (input.id) {
      const existing = this.find(input.id, input.scope);
      if (!existing) throw new RpcError('NOT_FOUND', 'That pipeline is gone. It may have been deleted or moved.');
      return this.write({ ...body, id: existing.id, scope: existing.scope, createdAt: existing.createdAt, updatedAt: at, issues: [] }, false);
    }
    return this.write({ ...body, id: this.freeId(input.scope, body.name), scope: input.scope, createdAt: at, updatedAt: at, issues: [] }, true);
  }

  remove(id: string, scope: PipelineScope): void {
    if (scope.kind === 'builtin') throw new RpcError('INVALID', 'The built-in pipelines can’t be deleted. Duplicate one to change it.');
    if (scope.kind === 'shared') {
      if (!this.shared(scope.root).pipelines.some((p) => p.id === id)) return;
      writeSharedFile(scope.root, (data) => removeEntry(data, 'pipelines', id, sharedPipelineId));
      return;
    }
    const existing = this.find(id, scope);
    if (existing) this.statements.remove.run(id);
  }

  /** A copy in `to`, named `name` (else “<name> copy”). Built-in pipelines are copied this way to change them. */
  duplicate(id: string, from: PipelineScope, to: PipelineSaveScope, name?: string): Pipeline {
    const source = this.get(id, from);
    const copyName = (name ?? `${source.name} copy`).trim().slice(0, 60);
    try {
      return this.save({ name: copyName, workspace: source.workspace, steps: source.steps, confirmBefore: source.confirmBefore, ...(source.autoPush ? { autoPush: true } : {}), scope: to });
    } catch (error) {
      if (error instanceof RpcError) throw new RpcError(error.code, `Couldn’t copy “${source.name}” to ${scopeName(to)}. ${error.message}`);
      throw error;
    }
  }

  /** The project's shared pipelines. An entry that doesn't read is reported, not fatal. */
  shared(root: string): { pipelines: Pipeline[]; errors: string[] } {
    const read = readSharedFile(root);
    if (read.error) return { pipelines: [], errors: [read.error] };
    const entries = entriesOf(read.data, 'pipelines');
    if (!entries) return { pipelines: [], errors: [`${SHARED_FILE}: expected { "pipelines": [...] }`] };
    const pipelines: Pipeline[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();
    for (const [i, entry] of entries.entries()) {
      const { id, pipeline, issues } = normaliseSharedPipeline(entry, i);
      if (!pipeline) {
        errors.push(`${SHARED_FILE} pipeline ${i + 1}: ${issues[0] ?? 'it doesn’t read.'}`);
        continue;
      }
      if (seen.has(id)) {
        errors.push(`${SHARED_FILE} pipeline ${i + 1}: another pipeline has the id “${id}”.`);
        continue;
      }
      seen.add(id);
      pipelines.push(Pipeline.parse({ ...pipeline, id, scope: { kind: 'shared', root }, createdAt: read.mtime, updatedAt: read.mtime, issues }));
    }
    return { pipelines, errors };
  }

  /** Your own pipelines of every project (for the settings file). */
  ownAll(): Array<{ pipeline: Pipeline; root: string | null }> {
    return (this.statements.all.all() as unknown as Row[]).flatMap((row) => {
      const pipeline = this.fromRow(row);
      return pipeline ? [{ pipeline, root: row.scope_root }] : [];
    });
  }

  /** Puts a pipeline back as it is (an import): same id and times. */
  restore(pipeline: Pipeline): void {
    if (pipeline.scope.kind !== 'global' && pipeline.scope.kind !== 'project') return;
    const body = JSON.stringify(bodyOf(pipeline));
    if (this.statements.get.get(pipeline.id)) this.statements.update.run(pipeline.name, body, pipeline.updatedAt, pipeline.id);
    else this.statements.insert.run(pipeline.id, pipeline.scope.kind === 'project' ? pipeline.scope.root : null, pipeline.name, body, pipeline.createdAt, pipeline.updatedAt);
  }

  /** Deletes one of your own by id, in any scope. */
  removeOwn(id: string): void {
    this.statements.remove.run(id);
  }

  private own(scope: Extract<PipelineScope, { kind: 'global' | 'project' }>): Pipeline[] {
    return (this.statements.list.all(scope.kind === 'global' ? '' : scope.root) as unknown as Row[]).flatMap((row) => {
      const pipeline = this.fromRow(row);
      return pipeline ? [pipeline] : [];
    });
  }

  private fromRow(row: Row): Pipeline | null {
    let json: unknown;
    try {
      json = JSON.parse(row.json);
    } catch {
      return null;
    }
    const scope: PipelineScope = row.scope_root === null ? { kind: 'global' } : { kind: 'project', root: row.scope_root };
    const parsed = Pipeline.safeParse({ ...(json as object), id: row.id, scope, createdAt: row.created_at, updatedAt: row.updated_at, issues: validatePipeline((json as PipelineBody) ?? { steps: [], confirmBefore: [] }) });
    return parsed.success ? parsed.data : null;
  }

  /** A new id: random for yours, made from the name for a shared one (it is written in the file). */
  private freeId(scope: PipelineSaveScope, name: string): string {
    if (scope.kind !== 'shared') return randomUUID();
    const base = sharedPipelineId({ name }, 0);
    const taken = new Set(this.shared(scope.root).pipelines.map((p) => p.id));
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  }

  private write(pipeline: Pipeline, fresh: boolean): Pipeline {
    const { scope } = pipeline;
    const body = bodyOf(pipeline);
    if (scope.kind === 'shared') {
      writeSharedFile(scope.root, (data) => upsertEntry(data, 'pipelines', { id: pipeline.id, ...body } as Record<string, unknown> & { id: string }, ENTRY_ORDER, sharedPipelineId));
      return this.find(pipeline.id, scope) ?? pipeline;
    }
    if (scope.kind === 'builtin') throw new RpcError('INVALID', 'The built-in pipelines can’t be changed. Duplicate one to change it.');
    const json = JSON.stringify(body);
    if (fresh) this.statements.insert.run(pipeline.id, scope.kind === 'project' ? scope.root : null, pipeline.name, json, pipeline.createdAt, pipeline.updatedAt);
    else this.statements.update.run(pipeline.name, json, pipeline.updatedAt, pipeline.id);
    return pipeline;
  }
}
