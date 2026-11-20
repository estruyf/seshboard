import { anyFactsPending, mergeFacts, mergePullRequests, type WorktreeFacts, type WorktreeList, type WorktreePullRequest } from '@seshboard/protocol/client';

// The late facts of a project's worktrees (`worktrees.facts`, `worktrees.pullRequests`) without React or the store. An
// event can reach us before the answer of the `worktrees.list` call that started it; what comes in while a list is
// being read is kept and put on it once it is here.

/** Facts and pull requests that arrived while a list was being read. `pullRequests` is left out until they did. */
export interface EarlyFacts {
  facts: WorktreeFacts[];
  pullRequests?: Readonly<Record<string, WorktreePullRequest>> | null;
}

/** A list this recent is shown without asking again (opening a tab, the Projects view). */
export const FRESH_MS = 30_000;
/** A list whose facts are still not all in after this long is read again: one of them may have been lost. */
export const PENDING_STALE_MS = 15_000;

/** Whether a list read at `loadedAt` is shown as it is. One still waiting for facts goes stale much sooner. */
export function listIsFresh(loadedAt: number, list: WorktreeList | null, now: number): boolean {
  return now - loadedAt < (list && anyFactsPending(list) ? PENDING_STALE_MS : FRESH_MS);
}

/** What was kept, with one more event. */
export function addEarly(early: EarlyFacts | undefined, event: { facts?: readonly WorktreeFacts[]; pullRequests?: EarlyFacts['pullRequests'] }): EarlyFacts {
  const next: EarlyFacts = { facts: [...(early?.facts ?? []), ...(event.facts ?? [])] };
  if (early && 'pullRequests' in early) next.pullRequests = early.pullRequests;
  if ('pullRequests' in event) next.pullRequests = event.pullRequests;
  return next;
}

/** How many entries still wait for their facts: it goes down as they arrive, which is what a stuck list doesn't do. */
export const pendingCount = (list: WorktreeList | null | undefined) => (list ? list.worktrees.filter((w) => w.factsPending).length + (list.pullRequestsPending ? 1 : 0) : 0);

/** The list with what arrived early on it. */
export function applyEarly(list: WorktreeList, early: EarlyFacts | undefined): WorktreeList {
  if (!early) return list;
  const withFacts = mergeFacts(list, early.facts);
  return 'pullRequests' in early ? mergePullRequests(withFacts, early.pullRequests ?? null) : withFacts;
}
