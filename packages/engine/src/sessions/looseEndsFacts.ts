import type { WorktreePullRequest } from '@seshboard/protocol';
import { git } from '../git/gitChanges.ts';
import { defaultGh, type GhCommand } from '../git/pullRequest.ts';
import { fetchFailingChecks, fetchPullRequests, listWorktrees } from '../git/worktrees.ts';
import { programPath } from '../system/program.ts';
import type { RepoFacts } from './looseEnds.ts';

export interface FactsOptions {
  /** The login shell's environment, so gh is on the PATH. */
  env: Record<string, string>;
  gh?: GhCommand;
  /** The pull requests by branch, when the caller keeps them already (the engine reads them every few minutes). */
  pullRequests?: Promise<Map<string, WorktreePullRequest> | null>;
}

/**
 * What one repository has for its loose ends, in one look: `listWorktrees` (every checkout's changes and unpushed
 * commits), the pull requests by branch, and the checks of open ones when a branch here has one. `facts` is null when
 * git couldn't read the repository; `github` is false when gh is there and the repository is on GitHub but gh gave no
 * answer (offline, signed out): unknown, not none.
 */
export async function repoFacts(root: string, options: FactsOptions): Promise<{ facts: RepoFacts | null; github: boolean }> {
  const gh = options.gh ?? defaultGh();
  const prsPromise = options.pullRequests ?? fetchPullRequests(root, options.env, gh);
  const list = await listWorktrees(root).catch(() => null);
  const prs = await prsPromise.catch(() => null);
  if (!list) return { facts: null, github: false };
  const base = list.baseBranch;
  // The checks rollup is heavy for every pull request: read it only for open ones, when a branch here has one.
  const open = prs !== null && list.worktrees.some((w) => w.branch && w.branch !== base && prs.get(w.branch)?.state === 'open');
  const failing = open ? await fetchFailingChecks(root, options.env, gh) : new Map<string, { pr: number; failed: number }>();
  const unknown = (prs === null || failing === null) && programPath(gh.file, { ...process.env, ...options.env }) !== null && /github\.com/i.test(await git(list.root, ['remote', '-v']).catch(() => ''));
  return {
    github: !unknown,
    facts: {
      root: list.root,
      baseBranch: base,
      checkouts: list.worktrees.filter((w) => !w.missing).map((w) => ({ path: w.path, branch: w.branch, uncommitted: w.uncommitted, unpushed: w.unpushed })),
      pullRequests: prs ?? new Map(),
      failing: failing ?? new Map(),
    },
  };
}
