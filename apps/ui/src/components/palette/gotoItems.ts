import { fuzzyMatch } from '../../lib/fuzzy.ts';
import type { DraftItem } from '../../state/drafts.ts';
import type { SessionRowData } from '../../state/sessionsStore.ts';
import { sidebarGroups } from '../../state/sidebarOrder.ts';
import { rowStatus, type SessionGroup } from '../../state/sidebarRows.ts';

/** What needs attention first: needs you, then working, then finished and unread, then the rest. */
export function sessionUrgency(row: SessionRowData): number {
  const status = rowStatus(row);
  return status === 'needs-you' ? 0 : status === 'running' ? 1 : status === 'unread' ? 2 : 3;
}

/** Sessions for ⌘P: by urgency, then the most recent first. */
export function orderSessions(rows: readonly SessionRowData[]): SessionRowData[] {
  return [...rows].sort((a, b) => sessionUrgency(a) - sessionUrgency(b) || b.updatedAt - a.updatedAt);
}

export interface Matched<T> {
  item: T;
  /** Letters of the title that matched, to highlight. */
  indices: number[];
}

/**
 * Sessions matching what is typed, by title (or project name, a little lower), the urgent ones first
 * among equals. With nothing typed: the first `limit` in `orderSessions` order.
 */
export function matchSessions(rows: readonly SessionRowData[], query: string, projectName: (root: string) => string, limit: number): Array<Matched<SessionRowData>> {
  if (!query.trim()) return orderSessions(rows).slice(0, limit).map((item) => ({ item, indices: [] }));
  return rows
    .flatMap((row) => {
      const byTitle = fuzzyMatch(query, row.title);
      const byProject = fuzzyMatch(query, projectName(row.projectRoot));
      const projectScore = byProject ? byProject.score - 2 : -Infinity;
      const score = Math.max(byTitle?.score ?? -Infinity, projectScore);
      return score === -Infinity ? [] : [{ item: row, score, indices: byTitle && byTitle.score >= projectScore ? byTitle.indices : [] }];
    })
    .sort((a, b) => b.score - a.score || sessionUrgency(a.item) - sessionUrgency(b.item) || b.item.updatedAt - a.item.updatedAt)
    .slice(0, limit)
    .map(({ item, indices }) => ({ item, indices }));
}

/** Project folders matching what is typed, by name (or path, a little lower); all of them, in the given order, with nothing typed. */
export function matchProjects(roots: readonly string[], query: string, nameOf: (root: string) => string): Array<Matched<string>> {
  if (!query.trim()) return roots.map((item) => ({ item, indices: [] }));
  return roots
    .flatMap((root) => {
      const byName = fuzzyMatch(query, nameOf(root));
      const byPath = fuzzyMatch(query, root);
      const pathScore = byPath ? byPath.score - 2 : -Infinity;
      const score = Math.max(byName?.score ?? -Infinity, pathScore);
      return score === -Infinity ? [] : [{ item: root, score, indices: byName && byName.score >= pathScore ? byName.indices : [] }];
    })
    .sort((a, b) => b.score - a.score)
    .map(({ item, indices }) => ({ item, indices }));
}

/**
 * ⌘P with nothing typed: sessions under the sidebar's own headings, in its order (Needs you, Working,
 * Pinned, Today, Yesterday, Earlier; archived ones left out), so it can stand in for the sidebar while that is
 * closed. At most `limit` sessions; the urgent groups come first, so they are never the ones cut.
 */
export function gotoGroups(rows: readonly SessionRowData[], now: number, archiveAfterDays: number, limit: number): { group: SessionGroup; rows: SessionRowData[] }[] {
  let left = limit;
  return sidebarGroups(rows, { now, archiveAfterDays }).flatMap(({ group, rows: inGroup }) => {
    const shown = inGroup.slice(0, Math.max(0, left));
    left -= shown.length;
    return shown.length ? [{ group, rows: shown }] : [];
  });
}

/**
 * ⌘P with nothing typed and unsent messages: an Unsent group on top (newest first, New session prompts too), then the
 * sidebar's groups without the sessions it lists. A session that needs you stays in Needs you instead (its row has a
 * pen there), so nothing shows twice.
 */
export function gotoWithDrafts(
  rows: readonly SessionRowData[],
  drafts: readonly DraftItem[],
  now: number,
  archiveAfterDays: number,
  limit: number,
): { unsent: DraftItem[]; groups: { group: SessionGroup; rows: SessionRowData[] }[] } {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const unsent = drafts.filter((item) => {
    if (item.kind === 'new') return true;
    const row = byId.get(item.sessionId);
    return !row || rowStatus(row) !== 'needs-you';
  });
  const listed = new Set(unsent.flatMap((item) => (item.kind === 'session' ? [item.sessionId] : [])));
  return { unsent, groups: gotoGroups(rows.filter((row) => !listed.has(row.id)), now, archiveAfterDays, limit) };
}
