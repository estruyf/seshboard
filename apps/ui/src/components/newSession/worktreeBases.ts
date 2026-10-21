import { branchOfBase, isBranchBase, type BranchBase, type WorktreeBase } from '@switchboard/protocol/client';
import type { Choice } from './ChoiceMenu.tsx';
import { freshBase } from './trayLabels.ts';

export interface BaseMenuInput {
  /** The remote `fresh` starts from (origin when there is one); null without a remote. */
  remote: string | null;
  /** The remote's default branch; null until known. */
  baseBranch: string | null;
  /** The branch checked out now; null when detached or unknown. */
  current: string | null;
  /** Local branches, most recent first. */
  branches: readonly string[];
  /** Remote branches (`origin/dev`), most recent first. */
  remoteBranches: readonly string[];
  /** The base chosen now, which stays listed even when git no longer lists it (a project's default). */
  selected: WorktreeBase;
}

/**
 * The "Branch from" menu of a new worktree: Claude Code's two starting points first, then every other local branch and
 * the remote ones, which Switchboard starts the worktree from itself. The branch checked out and the remote's default
 * branch are left out of that list: `head` and `fresh` already are them.
 */
export function baseChoices({ remote, baseBranch, current, branches, remoteBranches, selected }: BaseMenuInput): Array<Choice<WorktreeBase>> {
  const others: Array<Choice<WorktreeBase>> = [
    ...branches.filter((b) => b !== current).map((b) => ({ value: `refs/heads/${b}` as BranchBase, label: b })),
    ...remoteBranches.filter((b) => !(remote && baseBranch && b === `${remote}/${baseBranch}`)).map((b) => ({ value: `refs/remotes/${b}` as BranchBase, label: b })),
  ];
  if (isBranchBase(selected) && !others.some((c) => c.value === selected)) others.unshift({ value: selected, label: branchOfBase(selected) });
  return [
    { value: 'fresh', label: freshBase(remote, baseBranch), note: 'default', description: "Claude Code's default" },
    { value: 'head', label: current ?? 'HEAD', note: 'local HEAD', description: 'Includes your unpushed commits', separatorAfter: others.length > 0 },
    ...others,
  ];
}
