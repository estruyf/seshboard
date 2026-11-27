import { NAV_RAIL_ITEMS, type NavRailItem } from '@seshboard/protocol/bridge';

/*
 * The nav rail at the window's left edge: which items show, in what order, and what a click on a list does. Pure,
 * with tests. New session (first) and Settings (last) always show and never move, so they are not in these lists.
 */

/** A row of the rail between New session and Settings: an item, the short line after Home, or the space that pushes the rest down. */
export type NavRailEntry = { kind: 'item'; id: NavRailItem } | { kind: 'divider' } | { kind: 'spacer' };

/** The items that apply now: Browser while it is turned on, Computers with Remote or a paired computer, Running with the focus limit. */
export type NavRailAvailable = Record<'browser' | 'computers' | 'running', boolean>;

/** What switches the main area or the panel's list: after Home, a line before the first of these. */
const VIEWS: readonly NavRailItem[] = ['sessions', 'upcoming', 'activity', 'browser'];
/** What sits at the bottom, above Settings, by default: the space goes above the last run of these. */
const BOTTOM: readonly NavRailItem[] = ['projects', 'computers', 'running'];

/**
 * The rail's rows in `order`, without the hidden items and the ones that don't apply. A line follows Home while a view
 * comes right after it; the space sits above the last run of Projects, Computers and Running (at the end without one).
 */
export function navRailEntries(available: NavRailAvailable, hidden: readonly NavRailItem[] = [], order: readonly NavRailItem[] = NAV_RAIL_ITEMS): NavRailEntry[] {
  const applies = (id: NavRailItem) => (id === 'browser' || id === 'computers' || id === 'running' ? available[id] : true);
  const shown = order.filter((id) => applies(id) && !hidden.includes(id));
  let bottom = shown.length;
  while (bottom > 0 && BOTTOM.includes(shown[bottom - 1]!)) bottom--;
  const entries: NavRailEntry[] = [];
  shown.forEach((id, i) => {
    if (i === bottom) entries.push({ kind: 'spacer' });
    entries.push({ kind: 'item', id });
    if (id === 'home' && i + 1 < bottom && VIEWS.includes(shown[i + 1]!)) entries.push({ kind: 'divider' });
  });
  if (bottom === shown.length) entries.push({ kind: 'spacer' });
  return entries;
}

/** The items the rail lists, in order (no lines or space). */
export const navRailIds = (entries: readonly NavRailEntry[]): NavRailItem[] => entries.flatMap((entry) => (entry.kind === 'item' ? [entry.id] : []));

/** What the panel can list, each with its item on the rail (Settings too). */
export type NavList = 'sessions' | 'browser' | 'projects' | 'upcoming' | 'activity' | 'settings' | 'running';

/**
 * A click on an item with a list (every item but New session, Home and Computers): with the panel closed it opens on that list, open
 * on another list it switches, open on this one it closes.
 */
export function navClick(item: NavList, current: { panelOpen: boolean; list: NavList }): 'open' | 'switch' | 'close' {
  if (!current.panelOpen) return 'open';
  return current.list === item ? 'close' : 'switch';
}

/** The hidden items after a check in the Customize menu: hidden again or shown again, in the default order. */
export const toggleNavItem = (hidden: readonly NavRailItem[], item: NavRailItem): NavRailItem[] =>
  NAV_RAIL_ITEMS.filter((id) => (id === item ? !hidden.includes(id) : hidden.includes(id)));

/**
 * The order after `item` moved to `to` among the items the rail shows (`shown`, as `dropIndex` counts): it lands before
 * the shown item that follows it, or after the one before it when it ends up last. Items not on the rail keep their places.
 */
export function moveNavItem(order: readonly NavRailItem[], item: NavRailItem, to: number, shown: readonly NavRailItem[] = order): NavRailItem[] {
  const moved = shown.filter((id) => id !== item);
  moved.splice(Math.max(0, Math.min(to, moved.length)), 0, item);
  const at = moved.indexOf(item);
  const next = moved[at + 1];
  const previous = moved[at - 1];
  const rest = order.filter((id) => id !== item);
  const index = next !== undefined && rest.includes(next) ? rest.indexOf(next) : previous !== undefined && rest.includes(previous) ? rest.indexOf(previous) + 1 : -1;
  return index === -1 ? [...order] : [...rest.slice(0, index), item, ...rest.slice(index)];
}

/** Where ⌥↑ (-1) or ⌥↓ (1) moves an item among the shown `ids`; null at either end (New session and Settings don't move). */
export function stepNavItem(ids: readonly NavRailItem[], item: NavRailItem, step: 1 | -1): number | null {
  const at = ids.indexOf(item);
  const to = at + step;
  return at === -1 || to < 0 || to >= ids.length ? null : to;
}

/** Customize › Reset to default: every item, in the default order. */
export const resetNav = (): { navRailOrder: NavRailItem[]; navRailHidden: NavRailItem[] } => ({ navRailOrder: [...NAV_RAIL_ITEMS], navRailHidden: [] });

/** The names the Customize menu and the tooltips use. */
export const NAV_RAIL_NAMES: Record<NavRailItem, string> = {
  home: 'Home',
  sessions: 'Sessions',
  upcoming: 'Upcoming',
  activity: 'Activity',
  browser: 'Browser',
  projects: 'Projects',
  computers: 'Computers',
  running: 'Running',
};
