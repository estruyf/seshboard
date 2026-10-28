/**
 * The sessions drawer's swipes: where an edge swipe starts, how far the drawer follows the finger, and whether it
 * snaps open or closed when the finger lifts. Pure, with tests; `SessionsDrawer.tsx` and `useEdgeSwipe` use it.
 */

/** An edge swipe starts this close to the left edge. */
export const EDGE = 20;
/** Past this far (to the right to open, to the left to close), the drawer goes the whole way. */
export const DISTANCE = 40;
/** A flick this fast (px/ms) decides by itself, whatever the distance. */
export const FLICK = 0.4;
/** The drawer's share of the screen's width. */
export const DRAWER_SHARE = 0.86;
/** At most this wide: on an iPad whose sidebar folded away, 86% would cover nearly everything. */
export const DRAWER_MAX = 400;

/** Whether a touch starts an edge swipe: near the left edge, and only on a screen where the drawer is closed. */
export const startsEdgeSwipe = (x: number) => x >= 0 && x <= EDGE;

/**
 * How far the drawer is open, in px from closed (0) to open (`width`), while a finger drags it: from closed it
 * follows the finger to the right, from open to the left; it never goes past either end.
 */
export function dragPosition(from: 'open' | 'closed', dx: number, width: number): number {
  const start = from === 'open' ? width : 0;
  return Math.min(width, Math.max(0, start + dx));
}

/**
 * Open or closed once the finger lifts. A flick decides by itself; otherwise the drawer goes the whole way once it
 * was dragged more than `DISTANCE` the right way, and back where it was before that.
 */
export function settle(from: 'open' | 'closed', dx: number, velocity: number): 'open' | 'closed' {
  const toggled = from === 'open' ? 'closed' : 'open';
  // Positive: towards the other state.
  const toward = from === 'closed' ? 1 : -1;
  if (velocity * toward >= FLICK) return toggled;
  if (velocity * toward <= -FLICK) return from;
  return dx * toward > DISTANCE ? toggled : from;
}

/** The drawer's width on a screen this wide. */
export const drawerWidth = (screen: number) => Math.min(DRAWER_MAX, Math.round(screen * DRAWER_SHARE));

/** "Menu", "Sessions, 1 needs you", "Sessions, 2 need you": the menu button's label says what waits. */
export function drawerLabel(needsYou: number): string {
  if (needsYou <= 0) return 'Menu';
  return `Sessions, ${needsYou} ${needsYou === 1 ? 'needs' : 'need'} you`;
}

/**
 * Where the drawer's Home row goes. A wide screen has Home, the view next to the sidebar. A phone has one home, the
 * first screen: the list.
 */
export const homeRoute = (wide: boolean): { kind: 'home' } | { kind: 'list' } => (wide ? { kind: 'home' } : { kind: 'list' });

/** What waits on you in the other sessions: the open one's prompt is on screen already. */
export function needsYouElsewhere(sessions: readonly { id: string; status: string }[], openId: string | null): number {
  return sessions.filter((s) => s.status === 'needs-you' && s.id !== openId).length;
}

/** A place at the top of the drawer, as a row with an icon. */
export type DrawerPlace = { id: 'home' } | { id: 'new' } | { id: 'upcoming'; count: number };

/**
 * The drawer's places: Home and New session always (so a session doesn't have to go back to Home to start another),
 * Upcoming only with the computer's queue to show (`queued`, null while the remote contract has none), so a row never
 * leads to a page that can't say anything.
 */
export function drawerPlaces(queued: number | null): DrawerPlace[] {
  const always: DrawerPlace[] = [{ id: 'home' }, { id: 'new' }];
  return queued === null ? always : [...always, { id: 'upcoming', count: queued }];
}

/** How many sessions Recent shows in the drawer before All sessions. */
export const RECENT = 8;

/**
 * The drawer's Recent: the sessions in the order of their groups (what needs you, what works, then the newest), the
 * first `limit` of them, and whether there are more for All sessions.
 */
export function recentOf<S>(groups: readonly { sessions: readonly S[] }[], limit = RECENT): { sessions: S[]; more: boolean } {
  const all = groups.flatMap((g) => g.sessions);
  return { sessions: all.slice(0, limit), more: all.length > limit };
}
