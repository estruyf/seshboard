import { execFile } from 'node:child_process';
import { existsSync, statSync, type Dirent } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { isSameOrInside, type WorktreeEntry, type WorktreeList, type WorktreePullRequest, type WorktreeRemoveItem, type WorktreeRemoveResult } from '@switchboard/protocol';
import { baseBranch, git, GitError } from './gitChanges.ts';

/** One block of `git worktree list --porcelain`. */
export interface PorcelainWorktree {
  path: string;
  head: string | null;
  /** Full ref (`refs/heads/…`); null when detached. */
  branch: string | null;
  bare: boolean;
  locked: boolean;
  lockReason: string | null;
  prunable: boolean;
}

/** Parses `git worktree list --porcelain`: blocks separated by blank lines, the main checkout first. */
export function parseWorktreeList(output: string): PorcelainWorktree[] {
  const entries: PorcelainWorktree[] = [];
  let current: PorcelainWorktree | null = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice(9), head: null, branch: null, bare: false, locked: false, lockReason: null, prunable: false };
      entries.push(current);
    } else if (!current) continue;
    else if (line.startsWith('HEAD ')) current.head = line.slice(5);
    else if (line.startsWith('branch ')) current.branch = line.slice(7);
    else if (line === 'bare') current.bare = true;
    else if (line === 'locked' || line.startsWith('locked ')) {
      current.locked = true;
      current.lockReason = line.slice(7).trim() || null;
    } else if (line === 'prunable' || line.startsWith('prunable ')) current.prunable = true;
  }
  return entries;
}

/**
 * The checkouts `git worktree list` names, in this platform's form: git prints `C:/…` on Windows, where every
 * other path (and every comparison with one) uses `C:\…`.
 */
export const checkoutsOf = (output: string) =>
  parseWorktreeList(output)
    .filter((w) => !w.bare)
    .map((w) => ({ ...w, path: resolve(w.path) }));

const shortBranch = (ref: string) => ref.replace(/^refs\/heads\//, '');
/** `path` is `folder` or inside it; on Windows without regard to case or slash. */
const inside = (path: string, folder: string) => isSameOrInside(path, folder);

/** Runs a few promises at a time, keeping the order of `items`. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Changed and new files in a checkout. Renames carry their old path as an extra entry; only entries that start with a status count. */
const countUncommitted = async (path: string) =>
  (await git(path, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).catch(() => '')).split('\0').filter((e) => /^[ MADRCU?!]{2} /.test(e)).length;

/** A session that may be in one of the worktrees. */
export interface SessionPlace {
  id: string;
  cwd: string | null;
  updatedAt: number;
}

/**
 * Every worktree of the repository at `root` with what it takes to decide whether it can go. `sessions` are assigned
 * to the deepest worktree that holds their folder (worktrees under `.claude/worktrees/` sit inside the main checkout).
 * `pullRequests` maps branch names to their newest pull request (null: unknown, `gh` isn't there).
 */
export async function listWorktrees(root: string, options: { sessions?: readonly SessionPlace[]; pullRequests?: ReadonlyMap<string, WorktreePullRequest> | null } = {}): Promise<WorktreeList> {
  const raw = checkoutsOf(await git(root, ['worktree', 'list', '--porcelain']));
  if (raw.length === 0) throw new GitError('No worktrees listed');
  const mainPath = raw[0]!.path;
  const base = await baseBranch(mainPath);
  // Compare with origin's copy of the base when there is one: that is what "merged" means once a PR lands.
  const baseRef = base
    ? (await git(mainPath, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${base}`], { allowExitCodes: [1] }).catch(() => '')).trim()
      ? `refs/remotes/origin/${base}`
      : `refs/heads/${base}`
    : null;

  // Upstreams for every branch in one go: `%(upstream:track)` says "[ahead 2]", "[gone]" or nothing when in sync.
  const upstreams = new Map<string, { upstream: string | null; aheadOfUpstream: boolean }>();
  for (const line of (await git(mainPath, ['for-each-ref', '--format=%(refname)%00%(upstream:short)%00%(upstream:track)', 'refs/heads'])).split('\n')) {
    const [ref, upstream, track] = line.split('\0');
    if (!ref) continue;
    const gone = track?.includes('gone') ?? false;
    upstreams.set(ref, { upstream: upstream && !gone ? upstream : null, aheadOfUpstream: /ahead/.test(track ?? '') });
  }

  const count = async (args: string[]) => Number((await git(mainPath, ['rev-list', '--count', ...args], { allowExitCodes: [128] }).catch(() => '0')).trim() || 0);
  const sessions = options.sessions ?? [];
  const paths = raw.map((w) => w.path);
  /** The worktree a folder is in: the longest path that holds it. */
  const ownerOf = (cwd: string) => paths.filter((p) => inside(cwd, p)).sort((a, b) => b.length - a.length)[0] ?? null;
  const claudeDir = join(mainPath, '.claude', 'worktrees');

  const worktrees = await mapLimit(raw, 6, async (w): Promise<WorktreeEntry> => {
    const isMain = w.path === mainPath;
    const missing = w.prunable || !existsSync(w.path);
    const branch = w.branch ? shortBranch(w.branch) : null;
    const tip = w.branch ?? w.head;
    const own = sessions.filter((s) => s.cwd && ownerOf(s.cwd) === w.path);

    const uncommitted = missing ? 0 : await countUncommitted(w.path);

    let ahead: number | null = null;
    let behind: number | null = null;
    let merged = false;
    let unpushed = 0;
    if (tip && baseRef) {
      [ahead, behind] = await Promise.all([count([`${baseRef}..${tip}`]), count([`${tip}..${baseRef}`])]);
      // Commits beyond the base that no remote has: what deleting the branch would lose.
      unpushed = await count([tip, `^${baseRef}`, '--not', '--remotes']);
      if (!isMain && w.branch) {
        // Exit 0: an ancestor; 1: not one (an error, too, counts as not merged).
        const ancestor = await git(mainPath, ['merge-base', '--is-ancestor', w.branch, baseRef]).then(
          () => true,
          () => false,
        );
        // A branch that never got a commit of its own is an ancestor too, but "merged" would be news to you: its
        // oldest reflog entry (where it was created) is still its tip. Without a reflog, ancestry decides.
        const reflog = (await git(mainPath, ['reflog', 'show', '--format=%H', w.branch], { allowExitCodes: [128] }).catch(() => '')).trim().split('\n').filter(Boolean);
        const created = reflog.at(-1);
        merged = ancestor && !(created && created === w.head);
      }
    } else if (tip) {
      unpushed = await count([tip, '--not', '--remotes']);
    }

    const track = w.branch ? upstreams.get(w.branch) : undefined;
    const upstream = track?.upstream ?? null;
    const pushed = (upstream !== null && !track!.aheadOfUpstream) || ((ahead ?? 0) > 0 && unpushed === 0);

    const commitAt = tip ? Number((await git(mainPath, ['log', '-1', '--format=%ct', tip]).catch(() => '')).trim()) * 1000 || null : null;
    let folderAt: number | null = null;
    try {
      if (!missing) folderAt = statSync(w.path).mtimeMs;
    } catch {
      // Gone between the list and now.
    }
    const times = [commitAt, folderAt, ...own.map((s) => s.updatedAt)].filter((t): t is number => typeof t === 'number' && t > 0);

    return {
      path: w.path,
      name: basename(w.path),
      branch,
      head: w.head,
      isMain,
      isLocked: w.locked,
      lockReason: w.lockReason,
      missing,
      underClaudeDir: !isMain && inside(w.path, claudeDir) && w.path !== claudeDir,
      uncommitted,
      ahead,
      behind,
      merged,
      pr: branch && !isMain ? (options.pullRequests?.get(branch) ?? null) : null,
      upstream,
      unpushed,
      pushed,
      lastActivity: times.length ? Math.max(...times) : null,
      sessions: own.map((s) => s.id),
    };
  });

  return { root: mainPath, baseBranch: base, pullRequests: options.pullRequests != null, worktrees };
}

/** Runs a command; resolves with stdout, or null when it can't run (not installed, signed out, offline). */
function run(command: string, args: string[], cwd: string, env: Record<string, string>, timeout: number): Promise<string | null> {
  return new Promise((resolvePromise) => {
    execFile(command, args, { cwd, env: { ...process.env, ...env }, timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => resolvePromise(error ? null : stdout));
  });
}

/**
 * The newest pull request of each branch, from `gh pr list` in the repository. Null when `gh` isn't installed, isn't
 * signed in, or the repository isn't on GitHub. `env` is the login shell's, so `gh` is on the PATH.
 */
export async function fetchPullRequests(root: string, env: Record<string, string>): Promise<Map<string, WorktreePullRequest> | null> {
  const out = await run('gh', ['pr', 'list', '--state', 'all', '--limit', '200', '--json', 'number,state,headRefName,url'], root, { ...env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' }, 15_000);
  if (out === null) return null;
  try {
    const list = JSON.parse(out) as Array<{ number: number; state: string; headRefName: string; url: string }>;
    const byBranch = new Map<string, WorktreePullRequest>();
    // gh lists the newest first; an open one wins over an older merged or closed one either way.
    for (const pr of list) {
      const state = pr.state.toLowerCase();
      if (state !== 'open' && state !== 'merged' && state !== 'closed') continue;
      const known = byBranch.get(pr.headRefName);
      if (!known || (state === 'open' && known.state !== 'open')) byBranch.set(pr.headRefName, { number: pr.number, state, url: pr.url });
    }
    return byBranch;
  } catch {
    return null;
  }
}

/**
 * A folder's size on disk in bytes (`du -sk`), or null when it can't be measured. Unreadable parts are left out.
 * Windows has no `du`, so there the folder is walked and its files' sizes added up.
 */
export async function measureSize(path: string, platform: string = process.platform): Promise<number | null> {
  if (platform === 'win32') return walkSize(path);
  return new Promise((resolvePromise) => {
    // du exits with 1 when it couldn't read part of the tree, and still prints the total of the rest.
    execFile('du', ['-sk', path], { timeout: 5 * 60_000, maxBuffer: 1024 * 1024 }, (_error, stdout) => {
      const kb = Number(/^(\d+)/.exec(stdout?.trim() ?? '')?.[1]);
      resolvePromise(Number.isFinite(kb) ? kb * 1024 : null);
    });
  });
}

/** The sizes of the files under `path` added up, without following links or junctions; null when it isn't a folder. */
async function walkSize(path: string): Promise<number | null> {
  try {
    if (!(await lstat(path)).isDirectory()) return null;
  } catch {
    return null;
  }
  let total = 0;
  const pending = [path];
  while (pending.length) {
    const dir = pending.pop()!;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const sizes = await Promise.all(
      entries.map(async (entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return pending.push(full), 0;
        if (!entry.isFile()) return 0;
        return lstat(full).then((stat) => stat.size, () => 0);
      }),
    );
    for (const size of sizes) total += size;
  }
  return total;
}

/**
 * Dependencies, build output and caches: ignored, but they come back with an install or a build. Anything else that
 * is ignored (a local `.env`, editor settings) may hold work and is shown before removing.
 */
const REBUILDABLE = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', 'target', 'vendor', 'Pods', 'DerivedData',
  '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', '.parcel-cache', '.vite', '.output', '.vercel', '.expo', '.angular', '.gradle',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.venv', 'venv', '.tox',
  '.DS_Store',
]);

/** The ignored files and folders in a worktree that `git worktree remove` would delete, without rebuildable ones. */
export async function ignoredFiles(path: string, limit = 200): Promise<{ files: string[]; total: number }> {
  const out = await git(path, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '--no-empty-directory', '-z']);
  const files = out
    .split('\0')
    .filter(Boolean)
    .filter((file) => !file.split('/').some((part) => REBUILDABLE.has(part) || /\.tsbuildinfo$|\.pyc$/.test(part)))
    .sort();
  return { files: files.slice(0, limit), total: files.length };
}

/** Removing a worktree was refused before anything happened. */
export class WorktreeRefusal extends GitError {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Why a worktree must not be removed, as far as git can tell (sessions are the caller's), or null. */
export function removalRefusal(entry: WorktreeEntry): WorktreeRefusal | null {
  if (entry.isMain) return new WorktreeRefusal('MAIN', 'The main checkout is never removed.');
  if (entry.isLocked) return new WorktreeRefusal('LOCKED', `This worktree is locked${entry.lockReason ? ` (${entry.lockReason})` : ''}. Unlock it with git worktree unlock first.`);
  if (entry.uncommitted > 0) return new WorktreeRefusal('UNCOMMITTED', `It has ${entry.uncommitted} uncommitted ${entry.uncommitted === 1 ? 'change' : 'changes'}. Commit or revert them first.`);
  return null;
}

/** `refs/switchboard/removed/<branch>-<YYYY-MM-DD>`, with `-2`, `-3`… when that one is taken. */
export async function saveRecoveryRef(root: string, branch: string, sha: string, now: Date): Promise<string> {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  for (let n = 1; n < 100; n++) {
    const ref = `refs/switchboard/removed/${branch}-${day}${n > 1 ? `-${n}` : ''}`;
    const exists = (await git(root, ['rev-parse', '--verify', '--quiet', ref], { allowExitCodes: [1] }).catch(() => '')).trim();
    if (exists) continue;
    // An empty old value: only create it, never move an existing ref.
    await git(root, ['update-ref', ref, sha, '']);
    return ref;
  }
  throw new GitError(`Too many recovery refs for ${branch} today`);
}

/**
 * Removes one worktree: `git worktree remove` (which refuses changes git can see), or `git worktree prune` when its
 * folder is gone. Never deletes a folder any other way. Saves a recovery ref first when asked, and deletes the branch
 * last, only once the worktree is gone. Throws a `WorktreeRefusal` for the main checkout, a locked one or uncommitted changes.
 */
export async function removeWorktreeEntry(
  root: string,
  entry: WorktreeEntry,
  options: { deleteBranch: boolean; recoveryRef: boolean; now?: Date },
): Promise<{ recoveryRef: string | null; branchDeleted: boolean }> {
  const refusal = removalRefusal(entry);
  if (refusal) throw refusal;
  const recoveryRef = options.recoveryRef && entry.branch && entry.head ? await saveRecoveryRef(root, entry.branch, entry.head, options.now ?? new Date()) : null;
  if (entry.missing) await git(root, ['worktree', 'prune']);
  else await git(root, ['worktree', 'remove', entry.path]);
  let branchDeleted = false;
  if (options.deleteBranch && entry.branch) {
    // Never let a branch name be read as an option.
    if (entry.branch.startsWith('-')) throw new GitError(`Not a branch name: ${entry.branch}`);
    await git(root, ['branch', '-D', entry.branch]);
    branchDeleted = true;
  }
  return { recoveryRef, branchDeleted };
}

/** A Claude Code process that may be working in a worktree: one Switchboard runs (`hosted`), or any from the live registry. */
export interface SessionActivity {
  sessionId: string;
  cwd: string | null;
  /** Working or waiting for you (not idle). */
  busy: boolean;
  /** Run by Switchboard, which can stop it; anything else is another app's or a terminal's. */
  hosted: boolean;
}

/**
 * Whether sessions keep a worktree from being removed: refused while one works there, or while another Claude Code
 * process (a terminal, an editor) has one open. Sessions idle in Switchboard don't block; they are returned to stop first.
 */
export function sessionsBlocking(path: string, activity: readonly SessionActivity[]): { refusal: WorktreeRefusal | null; release: string[] } {
  const here = activity.filter((a) => a.cwd && inside(a.cwd, path));
  if (here.some((a) => a.busy)) return { refusal: new WorktreeRefusal('SESSION_BUSY', 'A session is working here. Wait for it to finish, or stop it first.'), release: [] };
  if (here.some((a) => !a.hosted)) return { refusal: new WorktreeRefusal('SESSION_BUSY', 'A Claude Code session is open here in another app or terminal. Close it there first.'), release: [] };
  return { refusal: null, release: [...new Set(here.map((a) => a.sessionId))] };
}

/**
 * Removes several worktrees of the repository at `root`, one after the other (git takes a lock), each judged on a fresh
 * list. `activity` is asked just before each one; `release` stops sessions idle there first. One failure doesn't stop
 * the rest: every item gets its own result.
 */
export async function removeWorktrees(
  root: string,
  items: readonly WorktreeRemoveItem[],
  hooks: { activity(): SessionActivity[] | Promise<SessionActivity[]>; release(sessionIds: string[]): Promise<void>; now?: Date },
): Promise<WorktreeRemoveResult[]> {
  const results: WorktreeRemoveResult[] = [];
  const { worktrees } = await listWorktrees(root);
  for (const item of items) {
    const result: WorktreeRemoveResult = { path: item.path, ok: false, code: null, error: null, removed: false, branchDeleted: false, recoveryRef: null };
    results.push(result);
    try {
      const listed = worktrees.find((w) => w.path === item.path);
      if (!listed) throw new WorktreeRefusal('NOT_FOUND', 'Git no longer lists this worktree.');
      // Files may have changed since the list was read (an earlier removal took a while): count again.
      const entry = listed.missing ? listed : { ...listed, uncommitted: await countUncommitted(listed.path) };
      const refusal = removalRefusal(entry);
      if (refusal) throw refusal;
      if (!entry.missing) {
        const blocking = sessionsBlocking(entry.path, await hooks.activity());
        if (blocking.refusal) throw blocking.refusal;
        if (blocking.release.length) await hooks.release(blocking.release);
      }
      const done = await removeWorktreeEntry(root, entry, { deleteBranch: item.deleteBranch, recoveryRef: item.recoveryRef, now: hooks.now });
      Object.assign(result, { ok: true, removed: true, ...done });
    } catch (error) {
      result.code = error instanceof WorktreeRefusal ? error.code : 'GIT_FAILED';
      result.error = (error as Error).message;
    }
  }
  return results;
}
