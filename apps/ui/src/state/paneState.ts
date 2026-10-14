// The panes and which one is active, and what each thing people do does to them. Pure functions on a plain value
// (no stores, no window), so they are unit tested next to this file; the sessions store applies them.

import {
  cycleLeaf,
  flipDirection,
  hasLeaf,
  insertLeaf,
  leaf,
  leafIds,
  removeLeaf,
  removeLeaves,
  replaceLeaf,
  sameTile,
  swapLeaves,
  type Tile,
  type Zone,
} from './tiling.ts';
import { fits, neighbour, planOpen, type Size, type Way } from './tilingGeometry.ts';

/** The layout (null: no session is open, Home shows) and the session in the active pane, which is always one of its leaves. */
export interface PaneState {
  layout: Tile | null;
  active: string | null;
}

export const NO_PANES: PaneState = { layout: null, active: null };

/** A layout with an active pane: `active` if it is still there, else the first pane. */
function settled(layout: Tile | null, active: string | null): PaneState {
  const ids = leafIds(layout);
  return { layout, active: active && ids.includes(active) ? active : (ids[0] ?? null) };
}

/**
 * The pane to make active after panes were removed: the active one if it is still there, else the next one in
 * reading order that stays (the one that took its place), else the one before.
 */
function activeAfter(before: readonly string[], active: string | null, after: Tile | null): string | null {
  const ids = leafIds(after);
  if (active && ids.includes(active)) return active;
  const at = active ? before.indexOf(active) : -1;
  if (at === -1) return ids[0] ?? null;
  return before.slice(at + 1).find((id) => ids.includes(id)) ?? before.slice(0, at).reverse().find((id) => ids.includes(id)) ?? null;
}

/** Shows a session: the pane already showing it becomes active; else it takes the active pane (or the whole view when nothing is open). */
export function showSession(state: PaneState, id: string | null): PaneState {
  if (id === null) return NO_PANES;
  if (!state.layout) return settled(leaf(id), id);
  if (hasLeaf(state.layout, id)) return state.active === id ? state : settled(state.layout, id);
  return settled(replaceLeaf(state.layout, state.active ?? leafIds(state.layout)[0]!, id), id);
}

/**
 * Opens a session in a new pane next to the active one (see `planOpen` for the side). A session that is already
 * open just becomes active. `opened` is false when the area has no room for another pane: nothing changes then.
 */
export function openBeside(state: PaneState, id: string, area: Size | null): { state: PaneState; opened: boolean } {
  if (!state.layout || hasLeaf(state.layout, id)) return { state: showSession(state, id), opened: true };
  const plan = planOpen(state.layout, state.active ?? leafIds(state.layout)[0]!, id, area);
  return plan ? { state: settled(plan.tree, id), opened: true } : { state, opened: false };
}

/**
 * Drops a session on `zone` of the pane showing `targetId` (see `insertLeaf`): an open session moves, a new one
 * docks or replaces. `ok` is false when the result would not fit the area (nothing changes then). The dropped
 * session becomes active.
 */
export function drop(state: PaneState, id: string, targetId: string, zone: Zone, area: Size | null): { state: PaneState; ok: boolean } {
  if (!state.layout || !hasLeaf(state.layout, targetId) || id === targetId) return { state, ok: false };
  const next = insertLeaf(state.layout, id, targetId, zone);
  if (next === state.layout || !fits(next, area)) return { state, ok: false };
  return { state: settled(next, id), ok: true };
}

/** What dropping would make, for deciding whether to offer the drop; null when it changes nothing or does not fit. */
export function dropResult(layout: Tile | null, id: string, targetId: string, zone: Zone, area: Size | null): Tile | null {
  if (!layout || !hasLeaf(layout, targetId) || id === targetId) return null;
  const next = insertLeaf(layout, id, targetId, zone);
  return next !== layout && fits(next, area) ? next : null;
}

/** Closes the pane showing `id` (the active one by default); its neighbours take the space. A lone pane stays: closing the session is another thing. */
export function closePane(state: PaneState, id: string | null = state.active): PaneState {
  if (!state.layout || !id || !hasLeaf(state.layout, id) || leafIds(state.layout).length < 2) return state;
  const before = leafIds(state.layout);
  const layout = removeLeaf(state.layout, id);
  return settled(layout, activeAfter(before, state.active, layout));
}

/** Closes every pane except the active one, which takes the whole view. */
export function closeOthers(state: PaneState): PaneState {
  return state.layout && state.active && leafIds(state.layout).length > 1 ? settled(leaf(state.active), state.active) : state;
}

/** Closes the panes showing any of these sessions (they were archived or deleted); with none left, Home shows. */
export function closeSessions(state: PaneState, ids: readonly string[]): PaneState {
  const before = leafIds(state.layout);
  if (!before.some((id) => ids.includes(id))) return state;
  const layout = removeLeaves(state.layout, ids);
  return settled(layout, activeAfter(before, state.active, layout));
}

/** Makes the pane showing `id` the active one. */
export function focusPane(state: PaneState, id: string): PaneState {
  return state.active === id || !hasLeaf(state.layout, id) ? state : settled(state.layout, id);
}

/** Makes the pane next door in a direction active; nothing at the edge. */
export function focusWay(state: PaneState, way: Way): PaneState {
  const next = state.active ? neighbour(state.layout, state.active, way) : null;
  return next ? focusPane(state, next) : state;
}

/** Makes the next pane in reading order active, wrapping round. */
export function focusNext(state: PaneState, step: 1 | -1 = 1): PaneState {
  const next = state.active ? cycleLeaf(state.layout, state.active, step) : null;
  return next ? focusPane(state, next) : state;
}

/** The active pane and the next one in reading order trade sessions; the active one stays with its session, so it is now in the other place. */
export function swapWithNext(state: PaneState): PaneState {
  const next = state.active ? cycleLeaf(state.layout, state.active) : null;
  return state.layout && state.active && next ? settled(swapLeaves(state.layout, state.active, next), state.active) : state;
}

/**
 * The split holding the active pane turns the other way (side by side becomes stacked, and back). `ok` is false
 * when the turned layout would not fit the area (three panes side by side may need more width than there is,
 * once stacked more height): nothing changes then. A lone pane has nothing to turn, which is not a failure.
 */
export function flipActive(state: PaneState, area: Size | null): { state: PaneState; ok: boolean } {
  if (!state.layout || !state.active) return { state, ok: true };
  const next = flipDirection(state.layout, state.active);
  if (sameTile(next, state.layout)) return { state, ok: true };
  return fits(next, area) ? { state: settled(next, state.active), ok: true } : { state, ok: false };
}

/** A new layout of the same sessions (divider sizes); anything with other sessions is ignored. */
export function commitLayout(state: PaneState, layout: Tile): PaneState {
  const same = state.layout && leafIds(layout).length === leafIds(state.layout).length && leafIds(layout).every((id) => hasLeaf(state.layout, id));
  return same && !sameTile(layout, state.layout) ? settled(layout, state.active) : state;
}
