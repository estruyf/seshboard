import type { RemoteBranches } from './remote.ts';
import { branchOfBase, isBranchBase, type BranchBase, type WorktreeBase } from './worktreeBase.ts';

/**
 * New session on another computer or a phone: where a new worktree starts there (`REMOTE_FEATURE_WORKTREE_BASE`),
 * picked from the branches that computer lists. Plain TypeScript (no zod), shared by the app and the remote app.
 */

/** A choice in the "Branch from" menu. */
export interface RemoteBaseChoice {
  value: WorktreeBase;
  label: string;
  note?: string;
  description?: string;
  separatorAfter?: boolean;
}

/** What `fresh` starts from, as the menu names it: `origin/main`, else the remote's or the default branch in words. */
export function remoteFreshBase(branches: Pick<RemoteBranches, 'remote' | 'baseBranch'>): string {
  const remote = branches.remote ?? null;
  const base = branches.baseBranch ?? null;
  if (!base) return remote ? `${remote}'s default branch` : 'the default branch';
  return remote ? `${remote}/${base}` : base;
}

/** A base as the chip names it: the branch, the branch checked out for `head`, or what `fresh` starts from. */
export function remoteBaseName(base: WorktreeBase, branches: Pick<RemoteBranches, 'remote' | 'baseBranch' | 'current'>): string {
  if (isBranchBase(base)) return branchOfBase(base);
  return base === 'head' ? (branches.current ?? 'HEAD') : remoteFreshBase(branches);
}

/**
 * The "Branch from" menu, as on the computer: the remote's default branch and the local HEAD first, then every other
 * local branch and the remote ones. The branch checked out and the remote's default branch are left out of that list:
 * `head` and `fresh` already are them. The base picked stays listed even when that computer no longer lists it.
 */
export function remoteBaseChoices(branches: RemoteBranches, selected: WorktreeBase): RemoteBaseChoice[] {
  const { current, remote, baseBranch } = branches;
  const others: RemoteBaseChoice[] = [
    ...branches.branches.filter((b) => b !== current).map((b) => ({ value: `refs/heads/${b}` as BranchBase, label: b })),
    ...(branches.remoteBranches ?? []).filter((b) => !(remote && baseBranch && b === `${remote}/${baseBranch}`)).map((b) => ({ value: `refs/remotes/${b}` as BranchBase, label: b })),
  ];
  if (isBranchBase(selected) && !others.some((c) => c.value === selected)) others.unshift({ value: selected, label: branchOfBase(selected) });
  return [
    { value: 'fresh', label: remoteFreshBase(branches), note: 'default', description: "Claude Code's default" },
    { value: 'head', label: current ?? 'HEAD', note: 'local HEAD', description: 'Includes unpushed commits', separatorAfter: others.length > 0 },
    ...others,
  ];
}

/** Whether that computer still lists a base: `fresh` and `head` always, a branch while it is there. */
export function remoteBaseListed(base: WorktreeBase, branches: Pick<RemoteBranches, 'branches' | 'remoteBranches'>): boolean {
  if (!isBranchBase(base)) return true;
  if (base.startsWith('refs/heads/')) return branches.branches.includes(base.slice('refs/heads/'.length));
  return (branches.remoteBranches ?? []).includes(base.slice('refs/remotes/'.length));
}
