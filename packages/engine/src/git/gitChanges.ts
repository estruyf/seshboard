import { execFile } from 'node:child_process';
import { lstatSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ChangedFile, ChangesBase, GitChanges, GitSyncAction, WorktreeStatus } from '@switchboard/protocol';

const MAX_DIFF_BYTES = 512 * 1024;
/** How much of the untracked files' contents `listChanges` reads in total to count their lines. */
const MAX_UNTRACKED_COUNT_BYTES = 16 * 1024 * 1024;

/**
 * `git diff` with the user's settings that would break parsing turned off: an external diff tool
 * (difftastic and the like), forced colours, and blank context lines written as empty lines.
 */
const DIFF = ['-c', 'diff.suppressBlankEmpty=false', 'diff', '--no-ext-diff', '--no-color'];

export class GitError extends Error {}

/**
 * Settings every git run here gets. On Windows, Git for Windows skips files whose full path is over 260 characters
 * without saying so (they would be missing from Changes) unless `core.longpaths` is on, which it isn't by default.
 */
export const GIT_SETTINGS: readonly string[] = process.platform === 'win32' ? ['-c', 'core.longpaths=true'] : [];

/**
 * Runs git in `cwd`; resolves with stdout. Never goes through a shell. Pathspecs are literal: the paths
 * passed come from the file list, and `app/[id]/page.tsx` or `a*.txt` must not match other files.
 */
export function git(cwd: string, args: string[], options: { env?: Record<string, string>; allowExitCodes?: number[]; timeout?: number } = {}): Promise<string> {
  // Node reports a missing `cwd` as the command not being found ("spawn git ENOENT"), which reads as git not being
  // installed, and a file as `cwd` as "spawn ENOTDIR" (thrown, not passed on). Neither is an allowed exit code.
  const spawnFailed = (error: NodeJS.ErrnoException) => (error.code === 'ENOENT' || error.code === 'ENOTDIR' ? folderProblem(cwd) : null);
  return new Promise((resolvePromise, reject) => {
    try {
      execFile(
        'git',
        [...GIT_SETTINGS, ...args],
        { cwd, env: { ...process.env, ...options.env, GIT_OPTIONAL_LOCKS: '0', GIT_LITERAL_PATHSPECS: '1', LC_ALL: 'C' }, maxBuffer: 32 * 1024 * 1024, timeout: options.timeout ?? 20_000 },
        (error, stdout, stderr) => {
          const problem = error ? spawnFailed(error as NodeJS.ErrnoException) : null;
          if (problem) return reject(new GitError(problem));
          const code = typeof error?.code === 'number' ? error.code : error ? 1 : 0;
          if (error && !options.allowExitCodes?.includes(code)) reject(new GitError(stderr.trim() || error.message));
          else resolvePromise(stdout);
        },
      );
    } catch (error) {
      const problem = spawnFailed(error as NodeJS.ErrnoException);
      reject(problem ? new GitError(problem) : error);
    }
  });
}

/** Why `cwd` can't be worked in: it is gone, or it is a file (or under one). Null for a folder. */
function folderProblem(cwd: string): string | null {
  try {
    const stat = statSync(cwd, { throwIfNoEntry: false });
    if (!stat) return `Folder not found: ${cwd}`;
    return stat.isDirectory() ? null : `Not a folder: ${cwd}`;
  } catch {
    // ENOTDIR: a folder on the way became a file.
    return `Folder not found: ${cwd}`;
  }
}

/** The default branch a project sets for itself, by the folder asked about; the engine fills it in from the project's defaults. */
let projectDefaultBranch: (cwd: string) => string | null = () => null;

/** Lets the engine name a project's own default branch, which `baseBranch` prefers to the remote's. */
export function setProjectDefaultBranch(lookup: (cwd: string) => string | null): void {
  projectDefaultBranch = lookup;
}

/**
 * The branch a worktree or feature branch would merge into: the project's own default branch while it still exists
 * (here or on origin), else origin's default branch, else main/master.
 */
export async function baseBranch(cwd: string): Promise<string | null> {
  const chosen = projectDefaultBranch(cwd);
  if (chosen) {
    const exists = await git(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${chosen}`], { allowExitCodes: [1, 128] }).catch(() => '');
    const onOrigin = exists.trim() ? exists : await git(cwd, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${chosen}`], { allowExitCodes: [1, 128] }).catch(() => '');
    if (onOrigin.trim()) return chosen;
  }
  const remoteHead = await git(cwd, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { allowExitCodes: [1, 128] }).catch(() => '');
  if (remoteHead.trim()) return remoteHead.trim().replace(/^origin\//, '');
  for (const name of ['main', 'master', 'trunk', 'develop']) {
    const exists = await git(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], { allowExitCodes: [1] }).catch(() => '');
    if (exists.trim()) return name;
  }
  return null;
}

/**
 * Local branches, most recently committed first, and the one checked out (null when HEAD is detached).
 * `checkedOutElsewhere` lists the branches checked out in another worktree (Claude Code's `.claude/worktrees/*`,
 * say): git refuses to switch to them here, so the branch menu shows them as not available.
 * `run` is git itself, swapped in tests.
 */
export async function listBranches(cwd: string, run: typeof git = git): Promise<{ current: string | null; branches: string[]; checkedOutElsewhere: string[] }> {
  const [refs, head] = await Promise.all([
    run(cwd, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)%00%(worktreepath)', 'refs/heads']).catch((error: Error) => olderGitRefs(cwd, run, error)),
    run(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowExitCodes: [1, 128] }),
  ]);
  const current = head.trim() || null;
  const branches: string[] = [];
  const checkedOutElsewhere: string[] = [];
  for (const line of refs.split('\n')) {
    const [name, worktree] = line.split('\0');
    if (!name) continue;
    branches.push(name);
    // The branch checked out here has this worktree's path; any other with a path is checked out somewhere else.
    if (worktree && name !== current) checkedOutElsewhere.push(name);
  }
  return { current, branches, checkedOutElsewhere };
}

/** Remote branches, most recently committed first, as `origin/dev`; each remote's `HEAD` is left out. `run` is git itself, swapped in tests. */
export async function listRemoteBranches(cwd: string, run: typeof git = git): Promise<string[]> {
  const refs = await run(cwd, ['for-each-ref', '--sort=-committerdate', '--format=%(refname)', 'refs/remotes']).catch(() => '');
  return refs
    .split('\n')
    .filter((ref) => ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD'))
    .map((ref) => ref.slice('refs/remotes/'.length));
}

/**
 * The same lines as `listBranches` asks for, for a git older than 2.23, which has no `%(worktreepath)` and rejects
 * the whole format. The branches come without it, and their worktrees from `git worktree list` (git 2.7); without
 * that either, no branch is marked. Another failure (the folder is gone) is the first call's error.
 */
async function olderGitRefs(cwd: string, run: typeof git, error: Error): Promise<string> {
  const names = await run(cwd, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads']).catch(() => {
    throw error;
  });
  const listed = await run(cwd, ['worktree', 'list', '--porcelain']).catch(() => '');
  // A worktree's block holds `worktree <path>` and, unless it is detached, `branch refs/heads/<name>`.
  const inWorktree = new Set(
    listed
      .split('\n')
      .filter((line) => line.startsWith('branch refs/heads/'))
      .map((line) => line.slice('branch refs/heads/'.length)),
  );
  return names
    .split('\n')
    .filter(Boolean)
    .map((name) => (inWorktree.has(name) ? `${name}\0worktree` : name))
    .join('\n');
}

/**
 * Checks out an existing local branch, or a remote one as a new tracking branch. Git keeps
 * uncommitted changes that don't conflict and refuses otherwise; nothing is ever discarded.
 */
export async function switchBranch(cwd: string, branch: string): Promise<void> {
  // Never let a branch name be read as an option.
  if (branch.startsWith('-')) throw new GitError(`Not a branch name: ${branch}`);
  const { current } = await listBranches(cwd);
  if (current === branch) return;
  await git(cwd, ['switch', branch]);
}

/** The top folder of the checkout `cwd` is in (a worktree is its own checkout), or null outside git. */
export async function checkoutRoot(cwd: string): Promise<string | null> {
  const root = (await git(cwd, ['rev-parse', '--show-toplevel']).catch(() => '')).trim();
  return root ? resolve(root) : null;
}

/**
 * The top folder of the checkout, in this platform's form: git prints `C:/…` on Windows, where every other
 * path (and every comparison with one) uses `C:\…`. Throws outside git.
 */
export async function topLevel(cwd: string): Promise<string> {
  return resolve((await git(cwd, ['rev-parse', '--show-toplevel'])).trim());
}

/** The commit `base` mode compares against: where this branch left the base branch. */
async function mergeBase(cwd: string, base: string): Promise<string | null> {
  for (const ref of [`origin/${base}`, base]) {
    const sha = await git(cwd, ['merge-base', 'HEAD', ref], { allowExitCodes: [1, 128] }).catch(() => '');
    if (sha.trim()) return sha.trim();
  }
  return null;
}

const STATUS: Record<string, ChangedFile['status']> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'added', T: 'modified', U: 'conflicted' };

/** `--numstat -z` output: additions, deletions and path (renames carry two paths). */
function parseNumstat(output: string): Map<string, { additions: number; deletions: number }> {
  const stats = new Map<string, { additions: number; deletions: number }>();
  const parts = output.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i]!;
    if (!line) continue;
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/.exec(line);
    if (!match) continue;
    let path = match[3]!;
    // A rename: the path field is empty and the old and new paths follow.
    if (path === '') {
      i += 2;
      path = parts[i] ?? '';
    }
    stats.set(path, { additions: match[1] === '-' ? 0 : Number(match[1]), deletions: match[2] === '-' ? 0 : Number(match[2]) });
  }
  return stats;
}

interface StatusEntry {
  x: string;
  y: string;
  path: string;
  /** The path a rename or copy came from. */
  from: string | null;
}

/** `status --porcelain=v1 -z`: "XY path", and for a rename or copy (in the index or, with intent-to-add, the worktree) the old path as the next entry. */
function parsePorcelain(output: string): StatusEntry[] {
  const entries: StatusEntry[] = [];
  const parts = output.split('\0').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]!;
    const x = entry[0]!;
    const y = entry[1]!;
    const moved = x === 'R' || x === 'C' || y === 'R' || y === 'C';
    entries.push({ x, y, path: entry.slice(3), from: moved ? (parts[++i] ?? null) : null });
  }
  return entries;
}

/** Renamed files in the index or worktree: new path → the path it had in HEAD. */
async function renames(root: string): Promise<Map<string, string>> {
  const entries = parsePorcelain(await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=no']));
  return new Map(entries.flatMap((e) => (e.from && (e.x === 'R' || e.y === 'R') ? [[e.path, e.from] as const] : [])));
}

/** Whether HEAD has the file (false on a branch without commits). */
const inHead = (root: string, rel: string) => git(root, ['cat-file', '-e', `HEAD:${rel}`]).then(() => true, () => false);
/** Whether the index has the file. */
const inIndex = async (root: string, rel: string) => (await git(root, ['ls-files', '--error-unmatch', '--', rel], { allowExitCodes: [1] })).trim() !== '';
const hasHead = async (root: string) => (await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'], { allowExitCodes: [1] })).trim() !== '';

/**
 * Lines in a new file, as `git diff --numstat` would count them: 0 for a binary file (a NUL byte in
 * its first 8000 bytes, git's own test), 1 for a symbolic link (its target).
 */
export function countNewLines(path: string): { lines: number; bytes: number } {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return { lines: 1, bytes: 0 };
  if (!stat.isFile() || stat.size >= MAX_DIFF_BYTES) return { lines: 0, bytes: 0 };
  const data = readFileSync(path);
  if (data.subarray(0, 8000).includes(0)) return { lines: 0, bytes: data.length };
  let lines = 0;
  for (let at = data.indexOf(10); at !== -1; at = data.indexOf(10, at + 1)) lines++;
  if (data.length > 0 && data[data.length - 1] !== 10) lines++;
  return { lines, bytes: data.length };
}

/**
 * What changed in a checkout. `uncommitted`: the working tree and index against HEAD,
 * plus untracked files. `branch`: everything since the branch left its base (commits and
 * uncommitted work together), which is what a merge or PR would contain.
 */
export async function listChanges(cwd: string, base: ChangesBase): Promise<GitChanges> {
  const root = await topLevel(cwd);
  const branch = (await git(root, ['branch', '--show-current'])).trim() || null;
  const baseName = await baseBranch(root);
  const files = new Map<string, ChangedFile>();

  if (base === 'branch') {
    const from = baseName ? await mergeBase(root, baseName) : null;
    if (!from) return { root, branch, baseBranch: baseName, base, files: [], error: baseName ? `No common history with ${baseName}` : 'No base branch found' };
    const names = await git(root, [...DIFF, '--name-status', '-z', '-M', from]);
    const parts = names.split('\0').filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const code = parts[i]!;
      const path = code.startsWith('R') || code.startsWith('C') ? parts[(i += 2)]! : parts[++i]!;
      files.set(path, { path, status: STATUS[code[0]!] ?? 'modified', additions: 0, deletions: 0, staged: false });
    }
    for (const [path, stat] of parseNumstat(await git(root, [...DIFF, '--numstat', '-z', '-M', from]))) {
      const file = files.get(path);
      if (file) Object.assign(file, stat);
    }
  } else {
    for (const { x, y, path } of parsePorcelain(await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']))) {
      const kind = x === '?' ? 'untracked' : x === 'U' || y === 'U' ? 'conflicted' : (STATUS[x !== ' ' ? x : y] ?? 'modified');
      files.set(path, { path, status: kind, additions: 0, deletions: 0, staged: x !== ' ' && x !== '?' && y === ' ' });
    }
    if (await hasHead(root)) {
      for (const [path, stat] of parseNumstat(await git(root, [...DIFF, 'HEAD', '--numstat', '-z', '-M']))) {
        const file = files.get(path);
        if (file) Object.assign(file, stat);
      }
    }
    // Untracked files count as all-new lines (only text files of a sensible size). Counted here rather than
    // with one git process per file, which with thousands of new files ran past the request's timeout.
    let budget = MAX_UNTRACKED_COUNT_BYTES;
    for (const file of files.values()) {
      if (file.status !== 'untracked' || budget <= 0) continue;
      try {
        const { lines, bytes } = countNewLines(join(root, file.path));
        file.additions = lines;
        budget -= bytes;
      } catch {
        // Unreadable; leave the count at 0.
      }
    }
  }
  return { root, branch, baseBranch: baseName, base, files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)), error: null };
}

/** Keeps a path inside the repository (no absolute paths, no `..` escapes). */
export function insideRepo(root: string, path: string): string {
  const full = resolve(root, path);
  const rel = relative(root, full);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new GitError(`Not a path inside the repository: ${path}`);
  return rel;
}

/** One file's unified diff, for the mode the list was made in. Large diffs are cut off. */
export async function fileDiff(cwd: string, base: ChangesBase, path: string): Promise<{ diff: string; truncated: boolean }> {
  const root = await topLevel(cwd);
  const rel = insideRepo(root, path);
  let diff: string;
  if (base === 'branch') {
    const name = await baseBranch(root);
    const from = name ? await mergeBase(root, name) : null;
    if (!from) return { diff: '', truncated: false };
    diff = await git(root, [...DIFF, '-M', from, '--', rel]);
  } else if (await inHead(root, rel)) {
    // Also a file whose deletion is staged: it is no longer in the index, but HEAD still has it.
    diff = await git(root, [...DIFF, 'HEAD', '-M', '--', rel]);
  } else if ((await hasHead(root)) && (await inIndex(root, rel))) {
    // Added, or the new name of a rename: diff it with its old path so a rename shows as one.
    const from = (await renames(root)).get(rel);
    diff = await git(root, [...DIFF, 'HEAD', '-M', '--', ...(from ? [from] : []), rel]);
  } else {
    diff = await git(root, [...DIFF, '--no-index', '--', '/dev/null', rel], { allowExitCodes: [1] });
  }
  const truncated = diff.length > MAX_DIFF_BYTES;
  return { diff: truncated ? diff.slice(0, MAX_DIFF_BYTES) : diff, truncated };
}

export async function stage(cwd: string, paths: string[], staged: boolean): Promise<void> {
  const root = await topLevel(cwd);
  const rels = paths.map((p) => insideRepo(root, p));
  if (rels.length === 0) return;
  if (staged) await git(root, ['add', '--', ...rels]);
  else if (await hasHead(root)) await git(root, ['restore', '--staged', '--', ...rels]);
  // Without a first commit there is nothing to restore from: unstaging means taking the files out of the index.
  else await git(root, ['rm', '--cached', '--quiet', '--', ...rels]);
}

/**
 * Puts files HEAD has back as they are there (index and working tree), deleted ones included. Files HEAD
 * doesn't have are taken out of the index and returned for the caller to move to the Trash, so nothing is
 * deleted outright. Reverting the new name of a rename also brings back the old one.
 */
export async function revert(cwd: string, paths: string[]): Promise<{ root: string; untracked: string[] }> {
  const root = await topLevel(cwd);
  const rels = paths.map((p) => insideRepo(root, p));
  const renamed = await renames(root);
  const tracked = new Set<string>();
  const untracked: string[] = [];
  for (const rel of rels) {
    const from = renamed.get(rel);
    if (from && (await inHead(root, from))) tracked.add(from);
    // HEAD decides, not the index: a staged deletion is no longer in the index but must come back.
    if (await inHead(root, rel)) tracked.add(rel);
    else {
      // Added but never committed: unstage it, then it's an untracked file.
      if (await inIndex(root, rel)) await git(root, ['rm', '--cached', '--quiet', '--', rel]);
      untracked.push(join(root, rel));
    }
  }
  if (tracked.size) await git(root, ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...tracked]);
  return { root, untracked };
}

/** Where a worktree stands before finishing it: what a merge, PR or removal would involve. */
export async function worktreeStatus(cwd: string): Promise<WorktreeStatus> {
  const path = await topLevel(cwd);
  const commonDir = resolve(path, (await git(path, ['rev-parse', '--git-common-dir'])).trim());
  const root = commonDir.endsWith(`${sep}.git`) ? commonDir.slice(0, -5) : commonDir;
  const isWorktree = root !== path;
  const branch = (await git(path, ['branch', '--show-current'])).trim() || null;
  const base = await baseBranch(path);
  const count = async (range: string) => Number((await git(path, ['rev-list', '--count', range], { allowExitCodes: [128] }).catch(() => '0')).trim() || 0);
  // Renames carry their old path as an extra entry; count only the entries that start with a status.
  const uncommitted = (await git(path, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).split('\0').filter((e) => /^[ MADRCU?!]{2} /.test(e)).length;
  const upstream = (await git(path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { allowExitCodes: [128] }).catch(() => '')).trim() || null;
  const remotes = (await git(path, ['remote'])).split('\n').filter(Boolean);
  const mainBranch = isWorktree ? (await git(root, ['branch', '--show-current']).catch(() => '')).trim() || null : null;
  const mainDirty = isWorktree ? (await git(root, ['status', '--porcelain=v1', '--untracked-files=no']).catch(() => '')).trim() !== '' : false;
  return {
    path,
    root,
    isWorktree,
    branch,
    baseBranch: base,
    ahead: base && branch ? await count(`${base}..${branch}`) : 0,
    behind: base && branch ? await count(`${branch}..${base}`) : 0,
    uncommitted,
    upstream,
    unpushed: upstream ? await count(`${upstream}..HEAD`) : null,
    behindUpstream: upstream ? await count(`HEAD..${upstream}`) : null,
    hasRemote: remotes.length > 0,
    pushRemote: remotes.includes('origin') ? 'origin' : (remotes[0] ?? null),
    mainCheckout: { branch: mainBranch, dirty: mainDirty },
  };
}

/**
 * The shell command for a fetch, pull or push on the checked-out branch, or why it can't run. A branch without an
 * upstream is pushed with `-u` to `pushRemote`. `quote` comes from the shell that runs it (`UserShell`).
 */
export function syncCommand(status: WorktreeStatus, action: GitSyncAction, quote: (value: string) => string): { command: string } | { code: string; message: string } {
  // Fetching needs a remote, not a branch: it works on a detached HEAD too.
  if (action === 'fetch') return status.hasRemote ? { command: 'git fetch' } : { code: 'NO_REMOTE', message: 'This repository has no remote.' };
  if (!status.branch) return { code: 'DETACHED', message: 'HEAD is detached; check out a branch first.' };
  if (!status.hasRemote || !status.pushRemote) return { code: 'NO_REMOTE', message: 'This repository has no remote.' };
  if (action === 'pull') {
    if (!status.upstream) return { code: 'NO_UPSTREAM', message: `${status.branch} has no upstream branch to pull from. Push it first.` };
    return { command: 'git pull' };
  }
  return { command: status.upstream ? 'git push' : `git push -u ${quote(status.pushRemote)} ${quote(status.branch)}` };
}

/** A pull that can't fast-forward: the branch and its upstream both have commits the other lacks. */
export class DivergedError extends GitError {}

/**
 * Fetches, or pulls the upstream into the checked-out branch, without a terminal (New session has none).
 * The pull only fast-forwards: merging or rebasing can stop on conflicts, which need a terminal to sort
 * out (`--no-rebase` so a `pull.rebase` setting can't override that). `env` is the login shell's, so ssh-agent and credential helpers work; nothing can ask for a
 * password, so a remote that wants one fails instead of waiting. Check `syncCommand` first.
 */
export async function updateCheckout(cwd: string, action: 'fetch' | 'pull', env: Record<string, string>): Promise<void> {
  const options = { env: { ...env, GIT_TERMINAL_PROMPT: '0' }, timeout: 120_000 };
  if (action === 'fetch') {
    await git(cwd, ['fetch', '--quiet'], options);
    return;
  }
  try {
    await git(cwd, ['pull', '--ff-only', '--no-rebase', '--quiet'], options);
  } catch (error) {
    if (/fast-forward/i.test((error as Error).message)) throw new DivergedError('This branch and its upstream have both moved on. Pull in a session to merge them.');
    throw error;
  }
}

/**
 * Gets a checkout ready for `git commit`: what is staged is committed, and with nothing staged every
 * change is staged first (like VS Code's smart commit). Returns how many files the commit takes.
 */
export async function stageForCommit(cwd: string): Promise<number> {
  const root = await topLevel(cwd);
  const staged = () => git(root, ['diff', '--cached', '--name-only', '-z']).then((out) => out.split('\0').filter(Boolean).length);
  const already = await staged();
  if (already > 0) return already;
  await git(root, ['add', '-A']);
  return staged();
}

/** The last lines of a failed commit's output that come back to the phone: enough to read a hook's complaint. */
const COMMIT_OUTPUT_LINES = 20;

/**
 * Commits every change in the checkout without a terminal (for the remote app, which can't see one): stages
 * everything, runs `git commit` with the user's environment so hooks find their tools, and returns the new commit's
 * hash, or the last lines of what git and its hooks printed when it failed. Never pushes.
 */
export async function commitAll(cwd: string, message: string, env: Record<string, string>): Promise<{ ok: true; sha: string; files: number } | { ok: false; output: string }> {
  const root = await topLevel(cwd);
  await git(root, ['add', '-A']);
  const files = (await git(root, ['diff', '--cached', '--name-only', '-z'])).split('\0').filter(Boolean).length;
  if (files === 0) return { ok: false, output: 'There is nothing to commit.' };
  const output = await new Promise<{ code: number; text: string }>((resolvePromise) => {
    execFile(
      'git',
      [...GIT_SETTINGS, 'commit', '-m', message],
      { cwd: root, env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }, maxBuffer: 8 * 1024 * 1024, timeout: 300_000 },
      (error, stdout, stderr) => resolvePromise({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, text: `${stdout}${stderr}` }),
    );
  });
  if (output.code !== 0) {
    const lines = output.text.replace(/\u001b\[[0-9;]*m/g, '').trimEnd().split('\n');
    return { ok: false, output: lines.slice(-COMMIT_OUTPUT_LINES).join('\n') || 'git commit failed.' };
  }
  return { ok: true, sha: (await git(root, ['rev-parse', 'HEAD'])).trim(), files };
}

/** Removes a worktree (refuses with uncommitted changes) and optionally its branch. */
export async function removeWorktree(status: WorktreeStatus, deleteBranch: boolean): Promise<void> {
  if (!status.isWorktree) throw new GitError('This folder is not a worktree');
  await git(status.root, ['worktree', 'remove', status.path]);
  if (deleteBranch && status.branch) await git(status.root, ['branch', '-D', status.branch]);
}
