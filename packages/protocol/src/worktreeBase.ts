import { isBranchName } from './githubRepo.ts';

/** A branch a new worktree starts from, as its full ref: a local branch or a remote one. */
export type BranchBase = `refs/heads/${string}` | `refs/remotes/${string}`;

/**
 * Where a new worktree starts. `fresh`: origin's default branch (Claude Code's default); `head`: the local HEAD.
 * Claude Code makes those two itself. Any other branch is a `BranchBase`, which the engine makes the worktree from
 * itself, in the same place and with the same branch name as Claude Code would. Full refs, so a branch called `head`
 * stays a branch.
 */
export type WorktreeBase = 'fresh' | 'head' | BranchBase;

/** `refs/heads/<branch>`, or `refs/remotes/<remote>/<branch>` (a remote's name has no slash here). */
const BRANCH_REF = /^refs\/(?:heads\/|remotes\/[A-Za-z0-9._][A-Za-z0-9._-]{0,99}\/)(.+)$/;

export function isBranchBase(value: unknown): value is BranchBase {
  if (typeof value !== 'string') return false;
  const branch = BRANCH_REF.exec(value)?.[1];
  return branch !== undefined && isBranchName(branch);
}

export function isWorktreeBase(value: unknown): value is WorktreeBase {
  return value === 'fresh' || value === 'head' || isBranchBase(value);
}

/** The branch as people read it: `dev` for `refs/heads/dev`, `origin/dev` for `refs/remotes/origin/dev`. */
export function branchOfBase(base: BranchBase): string {
  return base.replace(/^refs\/(heads|remotes)\//, '');
}

/**
 * What `session.create` takes for a base: Claude Code's two as they are, a branch as `{ branch }` (a local one) or
 * `{ branch, remote }` (the remote's copy), which the engine makes the worktree from itself.
 */
export function worktreeRequestBase(base: WorktreeBase): 'fresh' | 'head' | { branch: string; remote?: string } {
  if (base === 'fresh' || base === 'head') return base;
  if (base.startsWith('refs/heads/')) return { branch: base.slice('refs/heads/'.length) };
  const rest = base.slice('refs/remotes/'.length);
  const slash = rest.indexOf('/');
  return { remote: rest.slice(0, slash), branch: rest.slice(slash + 1) };
}

/**
 * The branch a project's pull requests go into, from its defaults: its own default branch, else the branch it checks
 * out, else the branch its worktrees start from (a remote one without the remote's name: `origin/dev` is `dev`). Null
 * when the project names none, so the remote's default branch applies.
 */
export function projectPrBase(defaults: { defaultBranch?: string | null; branch?: string | null; baseRef?: WorktreeBase | null }): string | null {
  if (defaults.defaultBranch) return defaults.defaultBranch;
  if (defaults.branch) return defaults.branch;
  const base = defaults.baseRef;
  if (!isBranchBase(base)) return null;
  const remote = /^refs\/remotes\/[^/]+\/(.+)$/.exec(base);
  return remote ? remote[1]! : base.slice('refs/heads/'.length);
}
