import { existsSync } from 'node:fs';
import { joinPath, type WorktreeBranchBase } from '@switchboard/protocol';
import { git, GitError } from './gitChanges.ts';
import { firstUsefulLine } from './pullRequest.ts';

/** git (or a check before it) refused to make the worktree: what to say, in one line. */
export class WorktreeFromError extends Error {}

/** Where a worktree named `name` goes: the place Claude Code's `--worktree` uses, so Switchboard treats it like one. */
export const worktreePath = (root: string, name: string) => joinPath(root, `.claude/worktrees/${name}`);

/** The folder a branch is checked out in (the main checkout or another worktree), or null. */
async function checkedOutAt(root: string, branch: string): Promise<string | null> {
  const out = await git(root, ['worktree', 'list', '--porcelain']).catch(() => '');
  let path: string | null = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) path = line.slice('worktree '.length);
    else if (line === `branch refs/heads/${branch}`) return path;
  }
  return null;
}

/**
 * Makes a worktree from a branch, the way Claude Code would make one (session linking's "start from its branch", and
 * New session from a pull request), in `<root>/.claude/worktrees/<name>`. Claude Code's own worktree setting only knows
 * origin's default branch and HEAD, so the engine runs `git worktree add` itself and the session starts in the folder.
 *
 * - A pull request (`pullRequest`): its latest commit is fetched into its branch first (`pull/<n>/head`, which works
 *   for forks too, without adding a remote), and the worktree works on that branch. One from this repository then
 *   tracks the branch on the remote, so a push updates the pull request.
 * - Any other branch: the worktree gets a branch of its own, `worktree-<name>`, started from it (fetched first when
 *   only the remote has it).
 *
 * Refuses (WorktreeFromError, git's first useful line) when the folder is taken, the branch is checked out somewhere
 * else, or git says no. Nothing is pushed.
 */
export async function makeWorktreeFrom(root: string, name: string, base: WorktreeBranchBase & { fork?: boolean }, options: { env?: Record<string, string>; remote?: string } = {}): Promise<{ path: string; branch: string }> {
  const path = worktreePath(root, name);
  if (existsSync(path)) throw new WorktreeFromError(`There is a worktree named ${name} already. Give this one another name.`);
  const env = { ...options.env, GIT_TERMINAL_PROMPT: '0' };
  const remote = options.remote ?? 'origin';
  const run = async (args: string[], timeout = 20_000) => {
    try {
      return await git(root, args, { env, timeout });
    } catch (error) {
      const message = error instanceof GitError ? error.message : String(error);
      throw new WorktreeFromError(firstUsefulLine(message) || message);
    }
  };
  const exists = (ref: string) => git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { allowExitCodes: [1, 128] }).then((out) => out.trim() !== '', () => false);

  if (base.pullRequest) {
    const elsewhere = await checkedOutAt(root, base.branch);
    if (elsewhere) throw new WorktreeFromError(`${base.branch} is checked out in ${elsewhere}. Work on it there, or switch that folder to another branch first.`);
    // Without `+`: a local branch with commits the pull request doesn't have is never overwritten.
    await run(['fetch', '--quiet', remote, `pull/${base.pullRequest}/head:${base.branch}`], 120_000);
    await run(['worktree', 'add', '--quiet', path, base.branch]);
    if (!base.fork) {
      // Track the branch on the remote, so pushing goes back to the pull request. A branch that isn't there is fine.
      const fetched = await git(root, ['fetch', '--quiet', remote, `refs/heads/${base.branch}:refs/remotes/${remote}/${base.branch}`], { env, timeout: 60_000 }).then(() => true, () => false);
      if (fetched) await git(root, ['branch', `--set-upstream-to=${remote}/${base.branch}`, base.branch]).catch(() => '');
    }
    return { path, branch: base.branch };
  }

  let from = base.branch;
  if (!(await exists(`refs/heads/${from}`))) {
    // Only the remote has it: fetch it, and start from the remote's copy.
    await git(root, ['fetch', '--quiet', remote, from], { env, timeout: 120_000 }).catch(() => '');
    if (!(await exists(`refs/remotes/${remote}/${from}`))) throw new WorktreeFromError(`There is no branch ${from} here or on ${remote}.`);
    from = `${remote}/${from}`;
  }
  const branch = `worktree-${name}`;
  await run(['worktree', 'add', '--quiet', '-b', branch, path, from]);
  return { path, branch };
}
