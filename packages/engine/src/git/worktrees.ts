import { execFile } from 'node:child_process';
import { existsSync, statSync, type Dirent } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { isSameOrInside, mergeFacts, mergePullRequests, PENDING_FACTS, type WorktreeEntry, type WorktreeFacts, type WorktreeList, type WorktreePullRequest, type WorktreeRemoveItem, type WorktreeRemoveResult } from '@seshboard/protocol';
import { programPath } from '../system/program.ts';
import { baseBranch, git, GitError } from './gitChanges.ts';
import { defaultGh, ghEnv, type GhCommand } from './pullRequest.ts';

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

/** Changed files in a checkout: staged, unstaged and untracked (every untracked file, not just its folder). Renames carry their old path as an extra entry; only entries that start with a status count. */
const readUncommitted = (path: string, timeout?: number): Promise<number | null> =>
  git(path, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { timeout }).then(
    (out) => out.split('\0').filter((e) => /^[ MADRCU?!]{2} /.test(e)).length,
    () => null,
  );

/** The same, for a removal: a status that fails counts as none (`git worktree remove` itself refuses a dirty one). */
export const countUncommitted = async (path: string, timeout?: number) => (await readUncommitted(path, timeout)) ?? 0;

export interface WorktreeOptions {
  sessions?: readonly SessionPlace[];
  pullRequests?: ReadonlyMap<string, WorktreePullRequest> | null;
  /** A worktree's count of changed files from a recent look elsewhere (`GitStatusHub.fresh`), or null to read it. */
  uncommitted?: (path: string) => number | null;
}

/** A session that may be in one of the worktrees. */
export interface SessionPlace {
  id: string;
  cwd: string | null;
  updatedAt: number;
}

/** `git status` in a huge checkout can take minutes; it runs in the background, so it gets time. */
const STATUS_TIMEOUT = 120_000;

/** The worktrees of a repository as the first look finds them, and the way to read each one's slow facts. */
export interface WorktreeListing {
  /** Every entry says `factsPending` (the pull requests are in when `pullRequests` was passed). */
  list: WorktreeList;
  /** Reads one worktree's slow facts: its changes, commits ahead and behind, whether it is merged and what no remote has. */
  facts(path: string): Promise<WorktreeFacts>;
}

/**
 * The first look at the worktrees of the repository at `root`: `git worktree list`, the base branch, every branch's
 * upstream and last commit (one `for-each-ref`) and each folder's change time. A handful of git calls however many
 * worktrees there are; what costs a few calls per worktree comes from `facts`. `sessions` are assigned to the deepest
 * worktree that holds their folder (worktrees under `.claude/worktrees/` sit inside the main checkout).
 * `pullRequests` maps branch names to their newest pull request (null: unknown, `gh` isn't there).
 */
export async function readWorktrees(root: string, options: WorktreeOptions = {}): Promise<WorktreeListing> {
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

  // Upstreams and last commits for every branch in one go: `%(upstream:track)` says "[ahead 2]", "[gone]" or nothing when in sync.
  const readRefs = async () => {
    const refs = new Map<string, { upstream: string | null; aheadOfUpstream: boolean; commitAt: number | null }>();
    for (const line of (await git(mainPath, ['for-each-ref', '--format=%(refname)%00%(upstream:short)%00%(upstream:track)%00%(committerdate:unix)', 'refs/heads'])).split('\n')) {
      const [ref, upstream, track, committed] = line.split('\0');
      if (!ref) continue;
      const gone = track?.includes('gone') ?? false;
      refs.set(ref, { upstream: upstream && !gone ? upstream : null, aheadOfUpstream: /ahead/.test(track ?? ''), commitAt: Number(committed) * 1000 || null });
    }
    return refs;
  };
  const refs = await readRefs();
  // The facts may be read after a fetch that moved the upstreams: they read the branches again, once, when the first one starts.
  let laterRefs: ReturnType<typeof readRefs> | null = null;

  /** A commit count, or null when git couldn't give one (an error, a timeout): never read as zero. */
  const count = (args: string[]) =>
    git(mainPath, ['rev-list', '--count', ...args], { allowExitCodes: [128] }).then(
      (out) => (/^\d+$/.test(out.trim()) ? Number(out.trim()) : null),
      () => null,
    );
  const sessions = options.sessions ?? [];
  const paths = raw.map((w) => w.path);
  /** The worktree a folder is in: the longest path that holds it. */
  const ownerOf = (cwd: string) => paths.filter((p) => inside(cwd, p)).sort((a, b) => b.length - a.length)[0] ?? null;
  const claudeDir = join(mainPath, '.claude', 'worktrees');
  const missingOf = new Map(raw.map((w) => [w.path, w.prunable || !existsSync(w.path)]));

  const worktrees = await mapLimit(raw, 6, async (w): Promise<WorktreeEntry> => {
    const isMain = w.path === mainPath;
    const missing = missingOf.get(w.path)!;
    const branch = w.branch ? shortBranch(w.branch) : null;
    const tip = w.branch ?? w.head;
    const own = sessions.filter((s) => s.cwd && ownerOf(s.cwd) === w.path);
    const known = w.branch ? refs.get(w.branch) : undefined;
    // A detached HEAD (or a branch for-each-ref didn't list) has no entry above: ask for its commit.
    const commitAt = known?.commitAt ?? (tip ? Number((await git(mainPath, ['log', '-1', '--format=%ct', tip]).catch(() => '')).trim()) * 1000 || null : null);
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
      ...PENDING_FACTS,
      factsPending: true,
      upstream: known?.upstream ?? null,
      lastActivity: times.length ? Math.max(...times) : null,
      sessions: own.map((s) => s.id),
    };
  });

  const facts = async (path: string): Promise<WorktreeFacts> => {
    const w = raw.find((r) => r.path === path);
    if (!w) throw new GitError('Git no longer lists this worktree.');
    const isMain = w.path === mainPath;
    const tip = w.branch ?? w.head;
    // The changes are the slowest part (the whole folder is walked) and need nothing from the rest: they go side by side.
    const known = options.uncommitted?.(w.path) ?? null;
    const changes = missingOf.get(path) ? Promise.resolve(0) : known !== null ? Promise.resolve(known) : readUncommitted(w.path, STATUS_TIMEOUT);
    const commits = async () => {
      let ahead: number | null = null;
      let behind: number | null = null;
      let merged = false;
      let unpushed = 0;
      // A call that failed leaves a guess behind (nothing ahead, nothing unpushed): the facts say so, and nothing
      // downstream may call the worktree clean, pushed or safe because of it.
      let unreadable = false;
      if (tip && baseRef) {
        // One call for both sides: left is what the base has and the branch hasn't, right the other way round.
        const sides = await git(mainPath, ['rev-list', '--left-right', '--count', `${baseRef}...${tip}`], { allowExitCodes: [128] }).then(
          (out) => out.trim().split(/\s+/).map(Number),
          () => null,
        );
        const answered = sides !== null && sides.length === 2 && sides.every(Number.isFinite);
        if (!answered) unreadable = true;
        [behind, ahead] = answered ? [sides[0]!, sides[1]!] : [0, 0];
        // Commits beyond the base that no remote has: what deleting the branch would lose. None when nothing is beyond the base.
        if (ahead > 0) {
          const lost = await count([tip, `^${baseRef}`, '--not', '--remotes']);
          // Unknown: assume everything beyond the base is unpushed.
          unpushed = lost ?? ahead;
          if (lost === null) unreadable = true;
        }
        // Nothing beyond the base is the same as being an ancestor of it (a failed count above is not one).
        if (!isMain && w.branch && answered && ahead === 0) {
          // A branch that never got a commit of its own is an ancestor too, but "merged" would be news to you: its
          // oldest reflog entry (where it was created) is still its tip. Without a reflog, ancestry decides.
          const reflog = (await git(mainPath, ['reflog', 'show', '--format=%H', w.branch], { allowExitCodes: [128] }).catch(() => '')).trim().split('\n').filter(Boolean);
          const created = reflog.at(-1);
          merged = !(created && created === w.head);
        }
      } else if (tip) {
        const lost = await count([tip, '--not', '--remotes']);
        unpushed = lost ?? 1;
        if (lost === null) unreadable = true;
      }
      return { ahead, behind, merged, unpushed, unreadable };
    };
    const [changed, { ahead, behind, merged, unpushed, unreadable }] = await Promise.all([changes, commits()]);
    const track = w.branch ? (await (laterRefs ??= readRefs().catch(() => refs))).get(w.branch) : undefined;
    // Pushed because every commit beyond the base is on a remote only when that was counted.
    const pushed = (track?.upstream != null && !track.aheadOfUpstream) || (!unreadable && (ahead ?? 0) > 0 && unpushed === 0);
    return { path, head: w.head, upstream: track?.upstream ?? null, uncommitted: changed ?? 0, ahead, behind, merged, unpushed, pushed, unreadable: unreadable || changed === null };
  };

  const list: WorktreeList = { root: mainPath, baseBranch: base, pullRequests: false, worktrees };
  return { list: options.pullRequests ? mergePullRequests(list, options.pullRequests) : list, facts };
}

/**
 * Every worktree of the repository at `root` with all its facts: what it takes to decide whether it can go. Reads them
 * six worktrees at a time and waits for all (`readWorktrees` is the quick look the overview shows first).
 */
export async function listWorktrees(root: string, options: WorktreeOptions = {}): Promise<WorktreeList> {
  const { list, facts } = await readWorktrees(root, options);
  return mergeFacts(list, await mapLimit(list.worktrees, 6, (w) => facts(w.path)));
}

/** Runs a command; resolves with stdout, or null when it can't run (not installed, signed out, offline). */
function run(command: string, args: string[], cwd: string, env: Record<string, string>, timeout: number): Promise<string | null> {
  const fullEnv = { ...process.env, ...env };
  const file = programPath(command, fullEnv);
  if (!file) return Promise.resolve(null);
  return new Promise((resolvePromise) => {
    execFile(file, args, { cwd, env: fullEnv, timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => resolvePromise(error ? null : stdout));
  });
}

/**
 * The newest pull request of each branch, from `gh pr list` in the repository. Null when `gh` isn't installed, isn't
 * signed in, or the repository isn't on GitHub. `env` is the login shell's, so `gh` is on the PATH.
 */
export async function fetchPullRequests(root: string, env: Record<string, string>, gh: GhCommand = defaultGh()): Promise<Map<string, WorktreePullRequest> | null> {
  const out = await run(gh.file, [...gh.args, 'pr', 'list', '--state', 'all', '--limit', '200', '--json', 'number,state,headRefName,baseRefName,url,isDraft,mergedAt'], root, ghEnv(env), 15_000);
  if (out === null) return null;
  try {
    const list = JSON.parse(out) as Array<{ number: number; state: string; headRefName: string; baseRefName?: string; url: string; isDraft?: boolean; mergedAt?: string | null }>;
    const byBranch = new Map<string, WorktreePullRequest>();
    // gh lists the newest first; an open one wins over an older merged or closed one either way.
    for (const pr of list) {
      const state = pr.state.toLowerCase();
      if (state !== 'open' && state !== 'merged' && state !== 'closed') continue;
      const known = byBranch.get(pr.headRefName);
      const mergedAt = state === 'merged' && pr.mergedAt ? Date.parse(pr.mergedAt) || null : null;
      if (!known || (state === 'open' && known.state !== 'open'))
        byBranch.set(pr.headRefName, { number: pr.number, state, url: pr.url, ...(state === 'open' ? { draft: pr.isDraft === true } : {}), ...(pr.baseRefName ? { base: pr.baseRefName } : {}), ...(state === 'merged' ? { mergedAt } : {}) });
    }
    return byBranch;
  } catch {
    return null;
  }
}

/** A check in `statusCheckRollup`: a check run (`conclusion`) or a commit status (`state`). */
type RollupItem = { __typename?: string; status?: string; conclusion?: string | null; state?: string };

const FAILED = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'CANCELLED']);

/** How many checks in a rollup failed (a cancelled run counts: the work isn't verified). */
export const failedInRollup = (rollup: readonly RollupItem[] | null | undefined): number =>
  (rollup ?? []).filter((c) => FAILED.has(String(c.conclusion ?? c.state ?? '').toUpperCase())).length;

/**
 * The open pull requests with failing checks, by branch, from one `gh pr list --state open` with the checks rollup.
 * Only open ones: the rollup makes the list heavy, and a closed pull request's checks are no loose end. Null when gh
 * can't answer.
 */
export async function fetchFailingChecks(root: string, env: Record<string, string>, gh: GhCommand = defaultGh()): Promise<Map<string, { pr: number; failed: number }> | null> {
  const out = await run(gh.file, [...gh.args, 'pr', 'list', '--state', 'open', '--limit', '50', '--json', 'number,headRefName,statusCheckRollup'], root, ghEnv(env), 15_000);
  if (out === null) return null;
  try {
    const list = JSON.parse(out) as Array<{ number: number; headRefName: string; statusCheckRollup?: RollupItem[] | null }>;
    const failing = new Map<string, { pr: number; failed: number }>();
    for (const pr of list) {
      const failed = failedInRollup(pr.statusCheckRollup);
      if (failed > 0 && !failing.has(pr.headRefName)) failing.set(pr.headRefName, { pr: pr.number, failed });
    }
    return failing;
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
  // Never judge on placeholders: the caller counts the changes first.
  if (entry.factsPending) return new WorktreeRefusal('FACTS_PENDING', 'The changes in this worktree are not read yet.');
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

/**
 * Unlocks a worktree (`git worktree unlock`), so it can be removed. Refuses the main checkout and paths git doesn't
 * list. Claude Code locks the worktrees it makes while a session runs, and a crashed one leaves the lock behind.
 */
export async function unlockWorktree(root: string, path: string): Promise<void> {
  const { worktrees } = (await readWorktrees(root)).list;
  const entry = worktrees.find((w) => w.path === path);
  if (!entry) throw new WorktreeRefusal('NOT_FOUND', 'Git no longer lists this worktree.');
  if (entry.isMain) throw new WorktreeRefusal('MAIN', 'The main checkout is never locked.');
  if (!entry.isLocked) return;
  await git(root, ['worktree', 'unlock', entry.path]);
}

/** A Claude Code process that may be working in a worktree: one Seshboard runs (`hosted`), or any from the live registry. */
export interface SessionActivity {
  sessionId: string;
  cwd: string | null;
  /** Working or waiting for you (not idle). */
  busy: boolean;
  /** Run by Seshboard, which can stop it; anything else is another app's or a terminal's. */
  hosted: boolean;
}

/**
 * Whether sessions keep a worktree from being removed: refused while one works there, or while another Claude Code
 * process (a terminal, an editor) has one open. Sessions idle in Seshboard don't block; they are returned to stop first.
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
  // Only the quick look: what it takes to remove one (its path, branch, lock) is in it, and the changes are counted
  // again below, just before each removal, so the slow facts of a list of dozens of worktrees aren't waited for.
  const { worktrees } = (await readWorktrees(root)).list;
  for (const item of items) {
    const result: WorktreeRemoveResult = { path: item.path, ok: false, code: null, error: null, removed: false, branchDeleted: false, recoveryRef: null };
    results.push(result);
    try {
      const listed = worktrees.find((w) => w.path === item.path);
      if (!listed) throw new WorktreeRefusal('NOT_FOUND', 'Git no longer lists this worktree.');
      // Files may have changed since the list was read (an earlier removal took a while): count again.
      const entry = { ...listed, uncommitted: listed.missing ? 0 : await countUncommitted(listed.path), factsPending: undefined };
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
