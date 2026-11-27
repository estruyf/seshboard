import { describe, expect, it } from 'vitest';
import { NAV_RAIL_ITEMS } from '@seshboard/protocol/bridge';
import { moveNavItem, navClick, navRailEntries, navRailIds, resetNav, stepNavItem, toggleNavItem, type NavRailEntry } from './navRail.ts';

const ALL = { browser: true, computers: true, running: true };
/** The rows as short text: ids, `|` for the line after Home, `~` for the space. */
const rows = (entries: NavRailEntry[]) => entries.map((e) => (e.kind === 'item' ? e.id : e.kind === 'divider' ? '|' : '~'));

describe('navRailEntries', () => {
  it('lists every item in the default order, a line after Home and the space above Projects', () => {
    expect(rows(navRailEntries(ALL))).toEqual(['home', '|', 'sessions', 'upcoming', 'activity', 'browser', '~', 'projects', 'computers', 'running']);
  });

  it('leaves out hidden items', () => {
    expect(rows(navRailEntries(ALL, ['activity', 'computers']))).toEqual(['home', '|', 'sessions', 'upcoming', 'browser', '~', 'projects', 'running']);
  });

  it('leaves out what does not apply: Browser off, no Remote, no focus limit', () => {
    expect(rows(navRailEntries({ browser: false, computers: false, running: false }))).toEqual(['home', '|', 'sessions', 'upcoming', 'activity', '~', 'projects']);
  });

  it('draws the line only while Home and a view are both shown, Home first', () => {
    expect(rows(navRailEntries(ALL, ['home']))).toEqual(['sessions', 'upcoming', 'activity', 'browser', '~', 'projects', 'computers', 'running']);
    expect(rows(navRailEntries(ALL, ['sessions', 'upcoming', 'activity', 'browser']))).toEqual(['home', '~', 'projects', 'computers', 'running']);
    const homeLast = ['sessions', 'upcoming', 'activity', 'browser', 'home', 'projects', 'computers', 'running'] as const;
    expect(rows(navRailEntries(ALL, [], homeLast))).toEqual(['sessions', 'upcoming', 'activity', 'browser', 'home', '~', 'projects', 'computers', 'running']);
  });

  it('puts the space at the end when nothing of the bottom comes last', () => {
    const order = ['home', 'projects', 'computers', 'running', 'sessions', 'upcoming', 'activity', 'browser'] as const;
    expect(rows(navRailEntries(ALL, [], order))).toEqual(['home', 'projects', 'computers', 'running', 'sessions', 'upcoming', 'activity', 'browser', '~']);
  });

  it('lists the ids alone', () => {
    expect(navRailIds(navRailEntries(ALL, ['home']))).toEqual(['sessions', 'upcoming', 'activity', 'browser', 'projects', 'computers', 'running']);
  });
});

describe('navClick', () => {
  it('opens the closed panel on that list', () => {
    expect(navClick('sessions', { panelOpen: false, list: 'sessions' })).toBe('open');
    expect(navClick('browser', { panelOpen: false, list: 'sessions' })).toBe('open');
  });

  it('switches to the list when the panel shows the other', () => {
    expect(navClick('browser', { panelOpen: true, list: 'sessions' })).toBe('switch');
    expect(navClick('sessions', { panelOpen: true, list: 'browser' })).toBe('switch');
    expect(navClick('projects', { panelOpen: true, list: 'sessions' })).toBe('switch');
  });

  it('closes the panel when it shows this list', () => {
    expect(navClick('sessions', { panelOpen: true, list: 'sessions' })).toBe('close');
    expect(navClick('browser', { panelOpen: true, list: 'browser' })).toBe('close');
    expect(navClick('projects', { panelOpen: true, list: 'projects' })).toBe('close');
  });
});

describe('customizing', () => {
  it('hides and shows items, in the default order', () => {
    expect(toggleNavItem([], 'activity')).toEqual(['activity']);
    expect(toggleNavItem(['running', 'home'], 'sessions')).toEqual(['home', 'sessions', 'running']);
    expect(toggleNavItem(['home', 'activity'], 'home')).toEqual(['activity']);
  });

  it('moves an item among the shown ones, the hidden ones keeping their places', () => {
    const order = [...NAV_RAIL_ITEMS];
    expect(moveNavItem(order, 'browser', 1)).toEqual(['home', 'browser', 'sessions', 'upcoming', 'activity', 'projects', 'computers', 'running']);
    expect(moveNavItem(order, 'home', 7)).toEqual(['sessions', 'upcoming', 'activity', 'browser', 'projects', 'computers', 'running', 'home']);
    // Upcoming is hidden: Browser moved up one place on the rail lands before Activity, Upcoming stays where it was.
    const shown = order.filter((id) => id !== 'upcoming');
    expect(moveNavItem(order, 'browser', 2, shown)).toEqual(['home', 'sessions', 'upcoming', 'browser', 'activity', 'projects', 'computers', 'running']);
  });

  it('steps an item up or down, not past either end', () => {
    const ids = ['home', 'sessions', 'upcoming'] as const;
    expect(stepNavItem(ids, 'sessions', -1)).toBe(0);
    expect(stepNavItem(ids, 'sessions', 1)).toBe(2);
    expect(stepNavItem(ids, 'home', -1)).toBeNull();
    expect(stepNavItem(ids, 'upcoming', 1)).toBeNull();
    expect(stepNavItem(ids, 'browser', 1)).toBeNull();
  });

  it('resets to every item in the default order', () => {
    expect(resetNav()).toEqual({ navRailOrder: [...NAV_RAIL_ITEMS], navRailHidden: [] });
  });
});
