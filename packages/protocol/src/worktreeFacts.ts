import type { WorktreeEntry, WorktreeFacts, WorktreeList, WorktreePullRequest } from './worktrees.ts';

// Plain TypeScript (no zod), so the engine and the renderer put a list and its late facts together the same way.

/** What a worktree's slow facts read while they are not known: nothing to decide on. */
export const PENDING_FACTS = { uncommitted: 0, ahead: null, behind: null, merged: false, unpushed: 0, pushed: false, pr: null } as const;

/** A list entry with its facts (no longer pending). A fact read at another HEAD than the entry's is not taken. */
export function withFacts(entry: WorktreeEntry, facts: WorktreeFacts): WorktreeEntry {
  if (facts.path !== entry.path || facts.head !== entry.head) return entry;
  const { path: _path, head: _head, ...rest } = facts;
  const { factsPending: _pending, ...known } = entry;
  return { ...known, ...rest };
}

/** The list with `facts` put on the entries they are for; entries without any keep what they had. */
export function mergeFacts(list: WorktreeList, facts: readonly WorktreeFacts[]): WorktreeList {
  if (facts.length === 0) return list;
  const byPath = new Map(facts.map((f) => [f.path, f]));
  return { ...list, worktrees: list.worktrees.map((w) => (byPath.has(w.path) ? withFacts(w, byPath.get(w.path)!) : w)) };
}

/**
 * The list with each branch's pull request. A null map: `gh` couldn't answer, so none are known, and the list stops
 * waiting for them.
 */
export function mergePullRequests(list: WorktreeList, pullRequests: ReadonlyMap<string, WorktreePullRequest> | Readonly<Record<string, WorktreePullRequest>> | null): WorktreeList {
  const { pullRequestsPending: _pending, ...settled } = list;
  if (!pullRequests) return settled;
  const get = (branch: string) => (pullRequests instanceof Map ? pullRequests.get(branch) : (pullRequests as Record<string, WorktreePullRequest>)[branch]);
  return { ...settled, pullRequests: true, worktrees: list.worktrees.map((w) => (w.branch && !w.isMain ? { ...w, pr: get(w.branch) ?? null } : w)) };
}

/** Something in the list is still being read: an entry's facts, or the pull requests. */
export const anyFactsPending = (list: WorktreeList) => list.pullRequestsPending === true || list.worktrees.some((w) => w.factsPending === true);
