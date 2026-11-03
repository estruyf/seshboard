/**
 * "PR merged moves to Done" (session triage): which sessions a merged pull request moves to Done. Pure, so every case
 * can be tested; the engine applies it after a look at loose ends (`looseEndsWatcher.ts`), with no window open too.
 *
 * Whose is the pull request: the newest session on its branch, as for loose ends (`looseEnds.ts`), or the session a
 * pipeline run started from. A run row of its own is left alone (it has no session flags).
 */
import type { RepoFacts } from './looseEnds.ts';

/** A session of the repository, with what decides whether a merge may move it. */
export interface MergeCandidate {
  id: string;
  branch: string | null;
  updatedAt: number;
  /** In the main list now (not in Done already). */
  listed: boolean;
  pinned: boolean;
  working: boolean;
  /** Needs you, or failed. */
  attention: boolean;
  /** Running in Seshboard. */
  openInApp: boolean;
  restoredAt: number | null;
  /** The pull request whose merge moved it before: that merge is handled. */
  donePr: number | null;
  /** It still has loose ends (files not committed, say): work not finished, so it stays where it is. */
  looseEnds: boolean;
}

export interface MergedMove {
  sessionId: string;
  pr: number;
}

/**
 * The sessions to move to Done for the merged pull requests in `repo`. Left alone: pinned, working, waiting or failed,
 * running in Seshboard, with loose ends left, already in Done, reopened by you after the merge or active since, and a merge already handled
 * (its number in `donePr`), so Reopen sticks.
 */
export function mergedMoves(repo: Pick<RepoFacts, 'baseBranch' | 'pullRequests'>, sessions: readonly MergeCandidate[], ownerOf: (sessionId: string) => string = (id) => id): MergedMove[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const moves = new Map<string, number>();
  for (const [branch, pr] of repo.pullRequests ?? []) {
    if (pr.state !== 'merged' || branch === repo.baseBranch || !pr.mergedAt) continue;
    const mergedAt = pr.mergedAt;
    const newest = sessions.filter((s) => s.branch === branch).reduce<MergeCandidate | null>((best, s) => (!best || s.updatedAt > best.updatedAt ? s : best), null);
    if (!newest) continue;
    const owner = byId.get(ownerOf(newest.id));
    if (!owner || moves.has(owner.id)) continue;
    if (owner.donePr === pr.number || !owner.listed) continue;
    if (owner.pinned || owner.working || owner.attention || owner.openInApp || owner.looseEnds) continue;
    if ((owner.restoredAt !== null && owner.restoredAt >= mergedAt) || owner.updatedAt > mergedAt) continue;
    moves.set(owner.id, pr.number);
  }
  return [...moves].map(([sessionId, pr]) => ({ sessionId, pr }));
}
