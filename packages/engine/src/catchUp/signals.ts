import { isAbsolutePath, pathInside, type CatchUp, type CatchUpTests, type GitChanges } from '@switchboard/protocol';
import { isTestCommand, parseTestCounts } from './testCommands.ts';
import { EDIT_TOOLS, oneLine, type ToolCall, type Turn } from './turn.ts';

/** The trust signals of a turn, worked out from its tool calls and git; no model is involved. */
export type Signals = CatchUp['signals'];

/** The last test command of the turn that came back, and how it went. */
export function testsSignal(tools: readonly ToolCall[]): CatchUpTests {
  const run = tools.filter((t) => t.command !== null && t.exitCode !== null && !t.declined && isTestCommand(t.command)).at(-1);
  if (!run) return { state: 'notRun' };
  const counts = parseTestCounts(run.output);
  return {
    state: run.exitCode === 0 ? 'passed' : 'failed',
    ...(counts ? { passed: counts.passed, failed: counts.failed } : {}),
    command: oneLine(run.command!, 120),
  };
}

/** Paths with `/` only, without `./` in front or a separator at the end, for comparing. */
const tidy = (path: string) =>
  path
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '');

/** A file name with an extension, or a path with a folder in it. */
const PATH_LIKE = /(?:^|[\s`'"(\[<*])((?:\.{1,2}\/|~\/|\/)?[\w@.+-]+(?:\/[\w@.+-]+)+\/?|[\w@+-][\w@.+-]*\.[A-Za-z][A-Za-z0-9]{0,7})(?=$|[\s`'")\],:;!?>*]|\.(?:\s|$))/g;

/** Whether a path (relative to the checkout) is there; without it, every path that looks like one counts. */
export type Exists = (relative: string) => boolean;

/**
 * The files and folders a text names (a plan, or your prompt), relative to `root` where they are inside it. Web
 * addresses and version numbers are left out, and so is prose with a slash in it ("and/or", "chaos/monkey testing"):
 * a path without a file extension only counts when its first folder is in the checkout (`exists`).
 */
export function namedPaths(text: string, root: string | null, exists?: Exists): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(PATH_LIKE)) {
    // A full stop after a path ends the sentence, not the path.
    let path = match[1]!.replace(/\.+$/, '');
    if (/^\d+(\.\d+)+$/.test(path) || /^(https?|www)\b/.test(path) || text.slice(Math.max(0, match.index! - 8), match.index! + 1).includes('://')) continue;
    if (isAbsolutePath(path) && root) {
      const inside = pathInside(path, root);
      // Somewhere else on the computer: it can't be a scope for the project's files.
      if (inside === null) continue;
      path = inside;
    }
    const clean = tidy(path);
    if (!clean || clean === '.' || clean.startsWith('..')) continue;
    const hasExtension = /\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(clean.split('/').at(-1)!);
    if (!hasExtension && exists && !exists(clean.split('/')[0]!)) continue;
    found.add(clean);
  }
  return [...found];
}

/** Whether a changed file (relative to the checkout) is covered by one of the scope's paths. */
export function inScope(file: string, scope: readonly string[]): boolean {
  const path = tidy(file);
  const name = path.split('/').at(-1)!;
  return scope.some((entry) => {
    const s = tidy(entry);
    // A bare file name ("sidebarRows.ts") stands for that file wherever it is.
    if (!s.includes('/')) return s === name || path === s || path.startsWith(`${s}/`);
    return path === s || path.startsWith(`${s}/`);
  });
}

export interface ScopeResult {
  outOfScope: string[];
  /** The one path to name in "2 files outside apps/ui", or null. */
  label: string | null;
}

/**
 * The files the turn changed that its scope doesn't cover. The scope is the plan's files and folders (with a plan), else
 * the paths your prompt names; without either, only files outside the checkout count. A file outside the checkout is
 * always out of scope. `root` is the checkout (a worktree's own folder); null outside git, where the session's folder
 * stands in.
 */
export function scopeCheck(turn: Turn, root: string | null, exists?: Exists): ScopeResult {
  const scope = namedPaths(turn.plan ?? turn.ask, root, exists);
  const edited = [...new Set(turn.tools.filter((t) => EDIT_TOOLS.has(t.name) && t.file && !t.declined && t.exitCode === 0).map((t) => t.file!))];
  const out: string[] = [];
  for (const file of edited) {
    const inside = root ? (isAbsolutePath(file) ? pathInside(file, root) : file) : file;
    if (inside === null) out.push(file);
    else if (scope.length > 0 && !inScope(inside, scope)) out.push(tidy(inside));
  }
  return { outOfScope: out, label: scope.length === 1 ? scope[0]! : null };
}

/**
 * The checkout's uncommitted changes against HEAD, plus new files, counted as the Changes panel counts them. A new file
 * only counts when the turn made it: one that was lying around before isn't this turn's work.
 */
export function diffSignal(changes: GitChanges | null, turn: Turn): Signals['diff'] {
  if (!changes || changes.error) return null;
  const made = new Set(turn.tools.filter((t) => EDIT_TOOLS.has(t.name) && t.file).map((t) => tidy(pathInside(t.file!, changes.root) ?? t.file!)));
  const files = changes.files.filter((f) => f.status !== 'untracked' || made.has(tidy(f.path)));
  return { files: files.length, add: files.reduce((n, f) => n + f.additions, 0), del: files.reduce((n, f) => n + f.deletions, 0) };
}

/** All signals of a finished turn. `planDeviated`: the summary said Claude didn't stick to the plan. */
export function signalsOf(turn: Turn, changes: GitChanges | null, cwd: string | null, planDeviated = false, exists?: Exists): Signals {
  const { outOfScope, label } = scopeCheck(turn, changes?.root ?? cwd, exists);
  return {
    tests: testsSignal(turn.tools),
    diff: diffSignal(changes, turn),
    outOfScope,
    scope: label,
    plan: turn.plan === null ? null : outOfScope.length > 0 || planDeviated ? 'deviated' : 'followed',
  };
}
