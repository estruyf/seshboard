import type { WorktreeStatus } from '@seshboard/protocol/client';

/** What the session header's git button can do. Commit asks Claude; the others run git in a terminal tab. */
export type GitStep = 'fetch' | 'pull' | 'commit' | 'push' | 'pr';

export interface GitPlan {
  /** The step the button offers on its face: the next thing the checkout needs (possibly blocked, see `blocked`), else Fetch. */
  primary: GitStep;
  /** Why each step can't run now, or null when it can. */
  blocked: Record<GitStep, string | null>;
  /** A warning for the menu, such as being behind the upstream. */
  note: string | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Why push and Create PR are off in a session from a fork's pull request Seshboard can't push to. */
export const FORK_READ_ONLY = "From a fork you can't push to.";

/**
 * Works out which git steps make sense for a checkout. `busy`: Claude is working in this session. `readOnly`: the
 * session works on a fork's pull request Seshboard can't push back, so push and Create PR are off.
 */
export function planGit(status: WorktreeStatus, busy: boolean, readOnly = false): GitPlan {
  const behind = status.behindUpstream ?? 0;
  const noRemote = !status.hasRemote ? 'No remote' : null;
  const detached = !status.branch ? 'HEAD is detached' : null;
  const pullFirst = behind > 0 ? 'Behind upstream. Pull first' : null;
  const onBase = status.branch !== null && status.branch === status.baseBranch;

  const blocked: Record<GitStep, string | null> = {
    fetch: noRemote,
    commit: status.uncommitted === 0 ? 'Nothing to commit' : busy ? 'Claude is working' : null,
    pull: noRemote ?? detached ?? (!status.upstream ? 'No upstream branch yet' : behind === 0 ? `Up to date with ${status.upstream}` : busy ? 'Claude is working in this folder' : null),
    push: noRemote ?? (readOnly ? FORK_READ_ONLY : null) ?? detached ?? pullFirst ?? (status.upstream && status.unpushed === 0 ? 'Nothing to push' : null),
    pr:
      noRemote ??
      (readOnly ? FORK_READ_ONLY : null) ??
      detached ??
      (onBase ? `On ${status.branch}, the base branch` : null) ??
      pullFirst ??
      (status.ahead === 0 ? `No commits ahead of ${status.baseBranch ?? 'the base branch'}` : null),
  };

  // The order a branch usually goes through: catch up, commit, push, then open a pull request.
  // A pull request is for a worktree or a branch other than the base one, once it has commits to offer.
  const wants: Record<Exclude<GitStep, 'fetch'>, boolean> = {
    pull: behind > 0,
    commit: status.uncommitted > 0,
    push: !readOnly && status.hasRemote && (status.upstream ? (status.unpushed ?? 0) > 0 : !onBase && status.ahead > 0),
    pr: !readOnly && status.hasRemote && (status.isWorktree || !onBase) && status.ahead > 0,
  };
  const order = ['pull', 'commit', 'push', 'pr'] as const;
  // Nothing to do: fetching shows whether the upstream moved on.
  const primary: GitStep = order.find((step) => wants[step]) ?? 'fetch';

  const note = behind > 0 ? `Behind upstream by ${plural(behind, 'commit', 'commits')}. Pull before you push.` : null;
  return { primary, blocked, note };
}

/** The number next to a step on the button's face (↓2 to pull, 3 files to commit, ↑1 to push), or null. */
export function stepCount(status: WorktreeStatus, step: GitStep): number | null {
  if (step === 'pull') return status.behindUpstream ?? null;
  if (step === 'commit') return status.uncommitted;
  if (step === 'push') return status.unpushed ?? status.ahead;
  return null;
}

/** The line under the branch name in the git menu: "↓2 behind · ↑0 ahead · 3 changed files". */
export function gitSummary(status: WorktreeStatus): string {
  const sync = status.upstream
    ? `↓${status.behindUpstream ?? 0} behind · ↑${status.unpushed ?? 0} ahead`
    : status.hasRemote
      ? `Not pushed yet · ↑${status.ahead} ahead of ${status.baseBranch ?? 'base'}`
      : 'No remote';
  return `${sync} · ${plural(status.uncommitted, 'changed file', 'changed files')}`;
}

/**
 * The open pull request the button's face shows instead of its step: once the branch has one, when the next step
 * would be to create it, or there is nothing to do. Pull, commit and push still come first (pushing updates it).
 */
export function showsViewPr<T extends { state: string }>(primary: GitStep, pr: T | null): T | null {
  return pr && pr.state === 'open' && (primary === 'pr' || primary === 'fetch') ? pr : null;
}

export const STEP_LABEL: Record<GitStep, string> = { fetch: 'Fetch', commit: 'Commit', pull: 'Pull', push: 'Push', pr: 'Create PR' };

/**
 * What "Sync with remote" runs: pull when the upstream is ahead, else push what hasn't been pushed (or
 * publish a branch that has commits), else fetch to see whether the upstream moved on.
 */
export function syncStep(status: WorktreeStatus, busy: boolean, readOnly = false): 'pull' | 'push' | 'fetch' {
  const plan = planGit(status, busy, readOnly);
  if ((status.behindUpstream ?? 0) > 0 && plan.blocked.pull === null) return 'pull';
  const unpushed = status.upstream ? (status.unpushed ?? 0) > 0 : status.branch !== status.baseBranch && status.ahead > 0;
  if (unpushed && plan.blocked.push === null) return 'push';
  return 'fetch';
}

/**
 * What New session's git button offers on its face: pull when the upstream is ahead, else fetch to see
 * whether it moved on. No session has worked in the checkout yet, so there is nothing to commit or push.
 */
export function catchUpStep(status: WorktreeStatus): 'pull' | 'fetch' {
  return planGit(status, false).blocked.pull === null ? 'pull' : 'fetch';
}
