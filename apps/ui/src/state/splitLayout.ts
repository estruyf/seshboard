import type { Pane } from './sessionsStore.ts';

/** How two panes sit: side by side (two columns) or one above the other (two rows). */
export type SplitOrientation = 'side' | 'stacked';

export const DEFAULT_ORIENTATION: SplitOrientation = 'side';

/** A stored orientation, or the default for anything else (a missing key, an older version). */
export function parseOrientation(value: unknown): SplitOrientation {
  const stored = value && typeof value === 'object' && 'orientation' in value ? (value as { orientation: unknown }).orientation : null;
  return stored === 'stacked' ? 'stacked' : DEFAULT_ORIENTATION;
}

export const otherOrientation = (orientation: SplitOrientation): SplitOrientation => (orientation === 'side' ? 'stacked' : 'side');

/**
 * The least height a stacked pane needs: its header, a message box with its chips and a few lines of the
 * conversation above it. A pane any shorter has the message box eating the whole view.
 */
export const STACKED_MIN_PANE_HEIGHT = 340;

/** The area for the panes is too short to stack them; `areaHeight` null: not measured yet. */
export function stackedBlocked(areaHeight: number | null): boolean {
  return areaHeight !== null && areaHeight < 2 * STACKED_MIN_PANE_HEIGHT;
}

/** How the panes show: the wanted orientation, but side by side while the area is too short to stack them. */
export const shownOrientation = (preferred: SplitOrientation, blocked: boolean): SplitOrientation => (preferred === 'stacked' && blocked ? 'side' : preferred);

/** `shownOrientation` for an area `areaHeight` tall. */
export const effectiveOrientation = (preferred: SplitOrientation, areaHeight: number | null): SplitOrientation => shownOrientation(preferred, stackedBlocked(areaHeight));

/** The panes as the store keeps them: the first (left or top) one, the second one, and which is active. */
export interface PaneSlots {
  mainId: string | null;
  splitId: string | null;
  activePane: Pane;
}

/**
 * The two sessions trade places. The active pane stays with the same session, so what you were working in
 * is still the active one. Nothing changes without a second pane.
 */
export function swapSlots(slots: PaneSlots): PaneSlots {
  if (!slots.splitId) return slots;
  return { mainId: slots.splitId, splitId: slots.mainId, activePane: slots.activePane === 'main' ? 'split' : 'main' };
}

/**
 * The panes in the order the DOM keeps them: by session id, whichever pane each is in. A swap then only
 * changes each pane's position (CSS `order`), so React never moves a pane's element, and moving an element
 * would reset its scroll position and focus. `position` is 0 for the first pane and 1 for the second.
 */
export function paneElements(mainId: string | null, splitId: string | null): Array<{ id: string; pane: Pane | null; position: 0 | 1 }> {
  if (!mainId) return [];
  if (!splitId || splitId === mainId) return [{ id: mainId, pane: null, position: 0 }];
  const both: Array<{ id: string; pane: Pane; position: 0 | 1 }> = [
    { id: mainId, pane: 'main', position: 0 },
    { id: splitId, pane: 'split', position: 1 },
  ];
  return both.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Point {
  x: number;
  y: number;
}

/** How far the pointer moves before a press on a pane's header becomes a drag, so a click is never one. */
export const DRAG_THRESHOLD = 6;

/** The press has moved far enough to be a drag. */
export const dragStarted = (from: Point, to: Point): boolean => Math.hypot(to.x - from.x, to.y - from.y) >= DRAG_THRESHOLD;

/** The pane under a point, or null outside both. */
export function paneAt(point: Point, rects: Record<Pane, Rect>): Pane | null {
  for (const pane of ['main', 'split'] as const) {
    const r = rects[pane];
    if (point.x >= r.left && point.x < r.right && point.y >= r.top && point.y < r.bottom) return pane;
  }
  return null;
}

/** Where a drag of the `from` pane would land: the other pane when the pointer is over it, else nowhere. */
export function dropTarget(from: Pane, point: Point, rects: Record<Pane, Rect>): Pane | null {
  const over = paneAt(point, rects);
  return over && over !== from ? over : null;
}
