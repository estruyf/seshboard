import type { RemoteBranches } from '@seshboard/protocol/remote-client';

/**
 * The branches New session offers for a project's folder: the one checked out there first, then the most recent.
 * Not those checked out in another worktree: git won't check them out in the folder too.
 */
export function branchChoices({ current, branches, checkedOutElsewhere }: RemoteBranches): string[] {
  const free = branches.filter((b) => b !== current && !checkedOutElsewhere.includes(b));
  return current ? [current, ...free] : free;
}

/**
 * The branch `session.create` checks out first: only another one than is checked out, only in the project's folder,
 * and only one the computer still lists. Null starts on what is checked out.
 */
export function checkoutBranch(picked: string | null, branches: RemoteBranches | null, worktree: boolean): string | null {
  if (worktree || !picked || !branches || picked === branches.current) return null;
  return branches.branches.includes(picked) ? picked : null;
}
