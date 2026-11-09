/**
 * Where you were reading in each session, so switching back opens it there instead of at the end.
 *
 * A session's view is unmounted when another one takes its pane, and its rows come back at an estimated height, so a
 * plain scrollTop would land somewhere else. The spot is kept as the row at the top of the view (its key, which stays
 * the same while the conversation grows) and how far into that row the view starts, plus the row heights measured so
 * far, which make the list its real height again before anything renders.
 *
 * Only in memory, for this window: a session you left at its end has no spot and opens at its end, following new output.
 */

/** The row at the top of the view and the distance from its top to the view's top. */
export type ScrollSpot = { key: string; offset: number; sizes: ReadonlyMap<string, number> };

/** Enough for every session someone switches between; the oldest spot goes first. */
export const MAX_SPOTS = 50;

const spots = new Map<string, ScrollSpot>();

/** Keeps the spot for `sessionId`, or forgets it (`null`, left at the end). */
export function rememberScroll(sessionId: string, spot: ScrollSpot | null): void {
  spots.delete(sessionId);
  if (!spot) return;
  spots.set(sessionId, spot);
  while (spots.size > MAX_SPOTS) spots.delete(spots.keys().next().value!);
}

/** The spot `sessionId` was left at, if it wasn't at its end. */
export function recallScroll(sessionId: string): ScrollSpot | null {
  return spots.get(sessionId) ?? null;
}

/** The row that holds `scrollTop` (the last that starts at or above it), from rows in order with their starts. */
export function anchorAt(rows: readonly { key: string | number | bigint; start: number }[], scrollTop: number): { key: string; offset: number } | null {
  let low = 0;
  let high = rows.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (rows[mid]!.start <= scrollTop) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  if (found === -1) return rows.length > 0 ? { key: String(rows[0]!.key), offset: 0 } : null;
  const row = rows[found]!;
  return { key: String(row.key), offset: scrollTop - row.start };
}
