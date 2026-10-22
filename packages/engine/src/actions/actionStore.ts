import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { ProjectAction, RpcError, type ActionSuggestion, type ListedAction } from '@switchboard/protocol';
import type { UserShell } from '../system/shell.ts';
import { entriesOf, readSharedFile, removeEntry, SHARED_FILE, upsertEntry, writeSharedFile } from './sharedFile.ts';

export { SHARED_FILE } from './sharedFile.ts';

export const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'action';

const hash = (command: string) => createHash('sha256').update(command).digest('hex');

/** Where an action's keys go in the shared file: these first, then anything else it had. */
const ENTRY_ORDER = ['id', 'name', 'icon', 'type', 'command', 'cwd', 'confirm', 'shortcut', 'runOnWorktreeCreate', 'sendOutput'] as const;

/** The id of a shared entry: its own, else made from its name. */
const sharedId = (raw: Record<string, unknown>, index: number) => (typeof raw.id === 'string' ? raw.id : slugify(String(raw.name ?? `action-${index + 1}`)));

/**
 * An action as the shared file holds it: values left at their default are left out (undefined, so an entry that had
 * them loses them), the way people write the file by hand.
 */
function sharedEntry(action: ProjectAction): Record<string, unknown> & { id: string } {
  const defaults = ProjectAction.parse({ id: action.id, name: action.name, command: action.command });
  const entry: Record<string, unknown> = {};
  for (const key of ENTRY_ORDER) entry[key] = key === 'id' || key === 'name' || key === 'command' || action[key] !== defaults[key] ? action[key] : undefined;
  return { ...entry, id: action.id };
}

export interface ActionVariables {
  cwd: string;
  projectRoot: string;
  branch: string;
  worktreeName: string;
  sessionId: string;
  sessionTitle: string;
}

/**
 * Fills in `${cwd}`, `${branch}`, … . For shell actions every value is quoted for the shell that runs them
 * (`shell.quote`, from `UserShell`), so a branch or title can never inject a command; prompts pass null.
 * Where no quoting is safe for every program (Windows, `shell.unsafe`), a value the action uses that holds a
 * dangerous character is refused instead (`UNSAFE_VALUE`). A value written inside double quotes in the action is
 * inserted as it is, since the quotes already keep it one argument, and a character the shell still reads there
 * (`$`, a backtick, …) is refused. Unknown variables are left as they are.
 */
export function expandCommand(command: string, vars: ActionVariables, shell: Pick<UserShell, 'kind' | 'quote' | 'unsafe'> | null): string {
  return command.replace(/\$\{(\w+)\}/g, (match, name: string, offset: number) => {
    if (!Object.hasOwn(vars, name)) return match;
    const value = vars[name as keyof ActionVariables];
    if (!shell) return value;
    const unsafe = shell.unsafe(value);
    if (unsafe !== null) throw new RpcError('UNSAFE_VALUE', `\${${name}} contains ${describeCharacter(unsafe)}, which Windows can't pass safely to every program. Leave \${${name}} out of this action, or change the ${VARIABLE_NOUNS[name] ?? 'value'}.`);
    if (insideDoubleQuotes(command, offset)) {
      const read = DOUBLE_QUOTE_READS[shell.kind].exec(value)?.[0];
      if (read) throw new RpcError('UNSAFE_VALUE', `\${${name}} is in double quotes in this action, and the shell reads "${read}" inside them. Take the quotes off \${${name}}, or change the ${VARIABLE_NOUNS[name] ?? 'value'}.`);
      return value;
    }
    return shell.quote(value);
  });
}

/** The characters a shell still reads inside double quotes, where a value is inserted as it is. */
const DOUBLE_QUOTE_READS: Record<UserShell['kind'], RegExp> = {
  posix: /[$`"\\!]/,
  powershell: /[$`"]/,
};

/**
 * Whether the action leaves the shell inside double quotes at `index`. Single quotes hold `"` literally and the
 * other way round; a backslash (or backtick, for PowerShell) escapes the next character outside single quotes. A
 * placeholder this can't place inside double quotes is quoted, which is safe in any case.
 */
function insideDoubleQuotes(command: string, index: number): boolean {
  let open: '"' | "'" | null = null;
  for (let i = 0; i < index; i++) {
    const char = command[i];
    if (open === "'") {
      if (char === "'") open = null;
      continue;
    }
    if (char === '\\' || char === '`') {
      i++;
      continue;
    }
    if (open === '"') {
      if (char === '"') open = null;
    } else if (char === '"' || char === "'") {
      open = char;
    }
  }
  return open === '"';
}

/** What each variable is, for the message when its value is refused. */
const VARIABLE_NOUNS: Record<string, string> = {
  cwd: 'folder name',
  projectRoot: 'project folder name',
  branch: 'branch name',
  worktreeName: 'worktree name',
  sessionTitle: 'session title',
};

const describeCharacter = (char: string) =>
  char === '\n' || char === '\r' ? 'a line break' : char === '\0' ? 'a NUL character' : char === '"' ? 'a double quote' : `"${char}"`;

interface Row {
  id: string;
  name: string;
  icon: string | null;
  type: string;
  command: string;
  cwd_mode: string;
  confirm: number;
  shortcut: string | null;
  run_on_worktree_create: number;
  send_output: number;
  project_id: string | null;
  imported: number;
}

const fromRow = (row: Row): ProjectAction =>
  ProjectAction.parse({
    id: row.id,
    name: row.name,
    icon: row.icon ?? 'play',
    type: row.type,
    command: row.command,
    cwd: row.cwd_mode,
    confirm: row.confirm === 1,
    shortcut: row.shortcut,
    runOnWorktreeCreate: row.run_on_worktree_create === 1,
    sendOutput: row.send_output === 1,
  });

/** Project actions: yours (per project or global, in the database) and shared ones from the repo. */
export class ActionStore {
  private readonly statements;

  constructor(db: DatabaseSync) {
    this.statements = {
      list: db.prepare('SELECT * FROM project_actions WHERE COALESCE(project_id, \'\') = ? ORDER BY sort, name'),
      all: db.prepare('SELECT * FROM project_actions ORDER BY COALESCE(project_id, \'\'), sort, name'),
      upsert: db.prepare(`
        INSERT INTO project_actions (id, project_id, name, icon, type, command, cwd_mode, confirm, shortcut, run_on_worktree_create, send_output, sort, imported)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (COALESCE(project_id, ''), id) DO UPDATE SET
          name = excluded.name, icon = excluded.icon, type = excluded.type, command = excluded.command,
          cwd_mode = excluded.cwd_mode, confirm = excluded.confirm, shortcut = excluded.shortcut,
          run_on_worktree_create = excluded.run_on_worktree_create, send_output = excluded.send_output, imported = excluded.imported`),
      remove: db.prepare("DELETE FROM project_actions WHERE COALESCE(project_id, '') = ? AND id = ?"),
      approve: db.prepare("UPDATE project_actions SET imported = 0 WHERE COALESCE(project_id, '') = ? AND id = ?"),
      count: db.prepare("SELECT COUNT(*) AS n FROM project_actions WHERE COALESCE(project_id, '') = ?"),
      trusted: db.prepare('SELECT 1 FROM trusted_commands WHERE project_id = ? AND command_hash = ?'),
      trust: db.prepare('INSERT OR IGNORE INTO trusted_commands (project_id, command_hash, trusted_at) VALUES (?, ?, ?)'),
    };
  }

  private own(projectRoot: string | null): Array<{ action: ProjectAction; imported: boolean }> {
    return (this.statements.list.all(projectRoot ?? '') as unknown as Row[]).map((row) => ({ action: fromRow(row), imported: row.imported === 1 }));
  }

  /** Every action of yours, in order, per scope (null: global), with whether it came from a settings file and awaits approval. */
  all(): Array<{ projectRoot: string | null; action: ProjectAction; imported: boolean }> {
    return (this.statements.all.all() as unknown as Row[]).map((row) => ({ projectRoot: row.project_id, action: fromRow(row), imported: row.imported === 1 }));
  }

  /** Imported shell actions run only once you've seen and approved their command. */
  private static trustedOwn = (entry: { action: ProjectAction; imported: boolean }) => !entry.imported || entry.action.type !== 'shell';

  /** Reads the repo's shared actions. Invalid entries are reported, not fatal. The file is hand-written, so ids are optional (derived from the name). */
  shared(projectRoot: string): { actions: ProjectAction[]; file: string | null; errors: string[] } {
    const read = readSharedFile(projectRoot);
    if (!read.data && !read.error) return { actions: [], file: null, errors: [] };
    if (read.error) return { actions: [], file: read.file, errors: [read.error] };
    const entries = entriesOf(read.data, 'actions');
    if (!entries) return { actions: [], file: read.file, errors: [`${SHARED_FILE}: expected { "actions": [...] }`] };
    const errors: string[] = [];
    const actions: ProjectAction[] = [];
    for (const [i, entry] of entries.entries()) {
      const candidate = { ...entry, id: sharedId(entry, i) };
      const action = ProjectAction.safeParse(candidate);
      if (action.success) actions.push(action.data);
      else errors.push(`${SHARED_FILE} action ${i + 1}: ${action.error.issues[0]?.message ?? 'invalid'}`);
    }
    return { actions, file: read.file, errors };
  }

  isTrusted(projectRoot: string, command: string): boolean {
    return this.statements.trusted.get(projectRoot, hash(command)) !== undefined;
  }

  trust(projectRoot: string, command: string): void {
    this.statements.trust.run(projectRoot, hash(command), Date.now());
  }

  /** Yours for this project win over shared, which win over your global ones (matched by id). */
  list(projectRoot: string): { actions: ListedAction[]; sharedFile: string | null; errors: string[] } {
    const shared = this.shared(projectRoot);
    const merged = new Map<string, ListedAction>();
    for (const entry of this.own(null)) merged.set(entry.action.id, { ...entry.action, scope: 'global', trusted: ActionStore.trustedOwn(entry) });
    for (const action of shared.actions) merged.set(action.id, { ...action, scope: 'shared', trusted: this.isTrusted(projectRoot, action.command) });
    for (const entry of this.own(projectRoot)) merged.set(entry.action.id, { ...entry.action, scope: 'project', trusted: ActionStore.trustedOwn(entry) });
    return { actions: [...merged.values()], sharedFile: shared.file, errors: shared.errors };
  }

  /** Saves one of your actions at the end of its scope (or in place). Saving from the editor approves it: you've seen the command. */
  save(projectRoot: string | null, action: ProjectAction, previousId?: string, imported = false): void {
    const scope = projectRoot ?? '';
    if (previousId && previousId !== action.id) this.statements.remove.run(scope, previousId);
    const sort = (this.statements.count.get(scope) as { n: number }).n;
    this.statements.upsert.run(
      action.id,
      projectRoot,
      action.name,
      action.icon,
      action.type,
      action.command,
      action.cwd,
      action.confirm ? 1 : 0,
      action.shortcut,
      action.runOnWorktreeCreate ? 1 : 0,
      action.sendOutput ? 1 : 0,
      sort,
      imported ? 1 : 0,
    );
  }

  /**
   * Saves an action in the project's .switchboard.json (in place, or at the end), for everyone on the project once it
   * is committed. `previousId` renames the entry where it is. Keys and entries Switchboard doesn't know stay as they
   * were. You saved the command, so it is approved for you; others approve it once.
   */
  saveShared(projectRoot: string, action: ProjectAction, previousId?: string): void {
    writeSharedFile(projectRoot, (data) => {
      const renamed = previousId && previousId !== action.id ? renameEntry(data, previousId, action.id) : data;
      return upsertEntry(renamed, 'actions', sharedEntry(action), ENTRY_ORDER, sharedId);
    });
    this.trust(projectRoot, action.command);
  }

  /** Takes an action out of the project's .switchboard.json. */
  removeShared(projectRoot: string, id: string): void {
    if (!this.shared(projectRoot).actions.some((a) => a.id === id)) return;
    writeSharedFile(projectRoot, (data) => removeEntry(data, 'actions', id, sharedId));
  }

  /** Approves an imported action of yours (null: global). */
  approve(projectRoot: string | null, id: string): void {
    this.statements.approve.run(projectRoot ?? '', id);
  }

  remove(projectRoot: string | null, id: string): void {
    this.statements.remove.run(projectRoot ?? '', id);
  }
}

/**
 * Starter actions: package.json scripts (with the project's package manager), plus git basics. No "ask Claude to
 * commit" prompt: sent to the session, it has the model read the whole conversation again for a commit message, and
 * the git button's commit writes one from the diff for a few thousand tokens.
 */
export function suggestActions(projectRoot: string): ActionSuggestion[] {
  const suggestions: ActionSuggestion[] = [];
  let scripts: Record<string, unknown> = {};
  try {
    scripts = (JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> }).scripts ?? {};
  } catch {
    // Not a Node project.
  }
  const runner = existsSync(join(projectRoot, 'pnpm-lock.yaml'))
    ? 'pnpm'
    : existsSync(join(projectRoot, 'bun.lock')) || existsSync(join(projectRoot, 'bun.lockb'))
      ? 'bun run'
      : existsSync(join(projectRoot, 'yarn.lock'))
        ? 'yarn'
        : 'npm run';
  const iconFor = (name: string): ActionSuggestion['icon'] =>
    /test|check|lint/.test(name) ? 'flask' : /dev|start|serve/.test(name) ? 'play' : /build|package/.test(name) ? 'package' : /publish|release|deploy/.test(name) ? 'rocket' : 'terminal';
  for (const name of Object.keys(scripts).slice(0, 12)) {
    suggestions.push({ name: name.charAt(0).toUpperCase() + name.slice(1), command: `${runner} ${name}`, type: 'shell', icon: iconFor(name) });
  }
  if (Object.keys(scripts).length > 0) {
    suggestions.push({ name: 'Install', command: runner === 'npm run' ? 'npm install' : `${runner.split(' ')[0]} install`, type: 'shell', icon: 'package' });
  }
  suggestions.push(
    { name: 'Push', command: 'git push', type: 'shell', icon: 'upload' },
    { name: 'Create PR', command: 'gh pr create --web', type: 'shell', icon: 'git-pull-request' },
  );
  return suggestions;
}

/** The shared file with the action `from` given the id `to`, where it is. */
function renameEntry(data: Record<string, unknown>, from: string, to: string): Record<string, unknown> {
  if (!Array.isArray(data.actions)) return data;
  return { ...data, actions: data.actions.map((raw: unknown, i) => (typeof raw === 'object' && raw !== null && !Array.isArray(raw) && sharedId(raw as Record<string, unknown>, i) === from ? { ...(raw as Record<string, unknown>), id: to } : raw)) };
}
