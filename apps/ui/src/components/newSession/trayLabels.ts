import { branchOfBase, isBranchBase, type WorktreeBase } from '@seshboard/protocol/client';

/** What the branch dropdown under the composer needs to know to name itself. */
export interface BranchRoute {
  worktree: boolean;
  /** `fresh`: branch the worktree from the remote's default branch; `head`: from the local HEAD; or from a branch. */
  baseRef: WorktreeBase;
  /** The remote `fresh` branches from (origin when there is one); null without a remote. */
  remote: string | null;
  /** The remote's default branch (origin/HEAD, else main or master); null until known. */
  baseBranch: string | null;
  /** The branch checked out now; null when detached or unknown. */
  current: string | null;
  /** The branch to check out before the session starts, when it isn't the current one. */
  checkoutBranch: string | null;
  /** False for a folder that isn't a git repository; null while it is being checked. */
  isGitRepo: boolean | null;
}

/** `origin/main`: the remote branch a fresh worktree starts from, or the bare branch without a remote. */
export function freshBase(remote: string | null, baseBranch: string | null): string {
  if (!baseBranch) return remote ? `${remote}'s default branch` : 'the default branch';
  return remote ? `${remote}/${baseBranch}` : baseBranch;
}

/** The branch a new worktree starts from, as the menu names it: `origin/main`, the current branch, or `dev`. */
export function baseName(base: WorktreeBase, route: Pick<BranchRoute, 'remote' | 'baseBranch' | 'current'>): string {
  if (isBranchBase(base)) return branchOfBase(base);
  return base === 'head' ? (route.current ?? 'HEAD') : freshBase(route.remote, route.baseBranch);
}

/** The branch dropdown's label: the branch to work on, or (for a new worktree) the one it starts from. */
export function branchLabel(route: BranchRoute): string {
  if (route.isGitRepo === false) return 'no git';
  if (route.worktree) return `From ${baseName(route.baseRef, route)}`;
  return route.checkoutBranch ?? route.current ?? '…';
}

/** The muted note next to a local branch in the branch menu: `current`, with `↓3` when the upstream is ahead. */
export function branchNote(branch: string, current: string | null, behindUpstream: number | null): string | undefined {
  if (branch !== current) return undefined;
  return behindUpstream ? `current · ↓${behindUpstream}` : 'current';
}
