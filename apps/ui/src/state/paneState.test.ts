import { describe, expect, it } from 'vitest';
import {
  closeOthers,
  closePane,
  closeSessions,
  commitLayout,
  drop,
  dropResult,
  flipActive,
  focusNext,
  focusPane,
  focusWay,
  NO_PANES,
  openBeside,
  showSession,
  swapWithNext,
  type PaneState,
} from './paneState.ts';
import { isSplit, leaf, leafIds, type Direction, type Tile } from './tiling.ts';
import { fits } from './tilingGeometry.ts';

const L = leaf;
const split = (direction: Direction, children: Tile[], sizes?: number[]): Tile => ({ direction, children, sizes: sizes ?? children.map(() => 1 / children.length) });
const row = (children: Tile[], sizes?: number[]) => split('row', children, sizes);
const col = (children: Tile[], sizes?: number[]) => split('column', children, sizes);
const at = (layout: Tile | null, active: string | null): PaneState => ({ layout, active });
const BIG = { width: 2400, height: 1400 };

/** Open sessions in reading order and the active one, in a line that is easy to compare. */
const view = (s: PaneState) => `${leafIds(s.layout).join(',') || '-'} @${s.active ?? '-'}`;

describe('showSession', () => {
  it('opens a lone pane from nothing', () => {
    expect(view(showSession(NO_PANES, 'a'))).toBe('a @a');
  });

  it('puts the session in the active pane, or focuses the pane already showing it', () => {
    const s = at(row([L('a'), L('b')]), 'b');
    expect(view(showSession(s, 'c'))).toBe('a,c @c');
    expect(view(showSession(s, 'a'))).toBe('a,b @a');
    expect(showSession(s, 'b')).toBe(s);
  });

  it('keeps the layout when only the active pane changes, and shows Home for null', () => {
    const s = at(row([L('a'), L('b')]), 'b');
    expect(showSession(s, 'a').layout).toBe(s.layout);
    expect(showSession(s, null)).toEqual(NO_PANES);
  });

  it('replaces a pane in place, keeping its size', () => {
    const s = at(row([L('a'), L('b')], [0.3, 0.7]), 'a');
    expect(showSession(s, 'z').layout).toEqual(row([L('z'), L('b')], [0.3, 0.7]));
  });
});

describe('openBeside', () => {
  it('opens a third pane next to the active one', () => {
    let s = showSession(NO_PANES, 'a');
    s = openBeside(s, 'b', BIG).state;
    s = openBeside(s, 'c', BIG).state;
    expect(leafIds(s.layout)).toHaveLength(3);
    expect(s.active).toBe('c');
  });

  it('focuses a session that is already open', () => {
    const s = at(row([L('a'), L('b')]), 'a');
    const out = openBeside(s, 'b', BIG);
    expect(out.opened).toBe(true);
    expect(view(out.state)).toBe('a,b @b');
  });

  it('opens it alone when nothing is open', () => {
    expect(view(openBeside(NO_PANES, 'a', BIG).state)).toBe('a @a');
  });

  it('refuses when the area has no room, and changes nothing', () => {
    const s = at(row([L('a'), L('b')]), 'a');
    const out = openBeside(s, 'c', { width: 700, height: 500 });
    expect(out).toEqual({ state: s, opened: false });
    expect(out.state).toBe(s);
  });

  it('caps the panes by what fits at the minimum size', () => {
    const fill = (area: { width: number; height: number }) => {
      let s = showSession(NO_PANES, 's0');
      for (let i = 1; i < 12; i++) {
        const out = openBeside(s, `s${i}`, area);
        if (!out.opened) break;
        s = out.state;
      }
      return s;
    };
    // One row as tall as a pane holds as many as are wide enough: 1100 / 340 = 3.
    expect(leafIds(fill({ width: 1100, height: 360 }).layout)).toHaveLength(3);
    // A column as wide as a pane.
    expect(leafIds(fill({ width: 360, height: 1100 }).layout)).toHaveLength(3);
    // A bigger area: never more than a 3 by 2 grid, and what opened always fits.
    const grid = fill({ width: 1100, height: 700 });
    expect(leafIds(grid.layout).length).toBeGreaterThanOrEqual(4);
    expect(leafIds(grid.layout).length).toBeLessThanOrEqual(6);
    expect(fits(grid.layout!, { width: 1100, height: 700 })).toBe(true);
  });
});

describe('closePane', () => {
  it('lets the neighbours take the space and activates the one that took the place', () => {
    const s = at(row([L('a'), L('b'), L('c')]), 'b');
    expect(view(closePane(s))).toBe('a,c @c');
    expect(view(closePane(at(s.layout, 'c')))).toBe('a,b @b');
    expect(view(closePane(s, 'a'))).toBe('b,c @b');
  });

  it('leaves the active pane alone when another one closes', () => {
    const s = at(row([L('a'), col([L('b'), L('c')])]), 'a');
    const out = closePane(s, 'c');
    expect(view(out)).toBe('a,b @a');
    expect(isSplit(out.layout!)).toBe(true);
  });

  it('keeps a lone pane, and an unknown one', () => {
    const lone = at(L('a'), 'a');
    expect(closePane(lone)).toBe(lone);
    const s = at(row([L('a'), L('b')]), 'a');
    expect(closePane(s, 'x')).toBe(s);
    expect(closePane(NO_PANES)).toBe(NO_PANES);
  });

  it('closes the others and keeps the active one whole', () => {
    expect(closeOthers(at(row([L('a'), col([L('b'), L('c')])]), 'c'))).toEqual(at(L('c'), 'c'));
    const lone = at(L('a'), 'a');
    expect(closeOthers(lone)).toBe(lone);
  });
});

describe('closeSessions', () => {
  it('closes the panes showing archived or deleted sessions', () => {
    const s = at(row([L('a'), L('b'), L('c')]), 'b');
    expect(closeSessions(s, ['x'])).toBe(s);
    expect(view(closeSessions(s, ['a']))).toBe('b,c @b');
    expect(view(closeSessions(s, ['b']))).toBe('a,c @c');
    expect(view(closeSessions(s, ['a', 'c']))).toBe('b @b');
  });

  it('shows Home when none is left', () => {
    expect(closeSessions(at(row([L('a'), L('b')]), 'a'), ['a', 'b'])).toEqual(NO_PANES);
    expect(closeSessions(at(L('d'), 'd'), ['d'])).toEqual(NO_PANES);
    expect(closeSessions(NO_PANES, ['d'])).toBe(NO_PANES);
  });

  it('falls back to the pane before when the active one was the last', () => {
    expect(view(closeSessions(at(row([L('a'), L('b')]), 'b'), ['b']))).toBe('a @a');
  });
});

describe('focus', () => {
  const s = at(row([L('a'), col([L('b'), L('c')])]), 'a');
  it('focuses a pane by session', () => {
    expect(view(focusPane(s, 'c'))).toBe('a,b,c @c');
    expect(focusPane(s, 'a')).toBe(s);
    expect(focusPane(s, 'x')).toBe(s);
  });

  it('moves to the pane next door', () => {
    expect(focusWay(s, 'right').active).toBe('b');
    expect(focusWay(at(s.layout, 'b'), 'down').active).toBe('c');
    expect(focusWay(at(s.layout, 'c'), 'left').active).toBe('a');
    expect(focusWay(s, 'left')).toBe(s);
    expect(focusWay(NO_PANES, 'left')).toBe(NO_PANES);
  });

  it('goes round in reading order', () => {
    expect(focusNext(s).active).toBe('b');
    expect(focusNext(at(s.layout, 'c')).active).toBe('a');
    expect(focusNext(s, -1).active).toBe('c');
    const lone = at(L('a'), 'a');
    expect(focusNext(lone)).toBe(lone);
  });
});

describe('swapWithNext and flipActive', () => {
  it('swaps the active pane with the next one and keeps the active session where it goes', () => {
    const s = at(row([L('a'), L('b')]), 'a');
    const out = swapWithNext(s);
    expect(view(out)).toBe('b,a @a');
    expect(swapWithNext(out)).toEqual(s);
    const lone = at(L('a'), 'a');
    expect(swapWithNext(lone)).toBe(lone);
  });

  it('flips the split above the active pane', () => {
    const s = at(row([L('a'), L('b')]), 'a');
    const flipped = flipActive(s, BIG);
    expect(flipped.ok).toBe(true);
    expect(flipped.state.layout).toMatchObject({ direction: 'column' });
    expect(flipActive(flipped.state, BIG).state).toEqual(s);
    const lone = at(L('a'), 'a');
    expect(flipActive(lone, BIG)).toEqual({ state: lone, ok: true });
  });

  it('refuses a flip that would not fit the window', () => {
    // Three side by side need 1020 wide and 340 tall; stacked they need 1020 tall.
    const three = at(row([L('a'), L('b'), L('c')]), 'b');
    expect(flipActive(three, { width: 1100, height: 700 })).toEqual({ state: three, ok: false });
    expect(flipActive(three, { width: 1100, height: 1100 }).ok).toBe(true);
    expect(flipActive(three, null).ok).toBe(true);
  });
});

describe('drop', () => {
  const s = at(row([L('a'), L('b'), L('c')]), 'a');

  it('docks a pane on an edge of another and makes it active', () => {
    const out = drop(s, 'a', 'c', 'bottom', BIG);
    expect(out.ok).toBe(true);
    expect(view(out.state)).toBe('b,c,a @a');
    expect(out.state.layout).toMatchObject({ direction: 'row' });
  });

  it('swaps in the centre', () => {
    const out = drop(s, 'a', 'c', 'center', BIG);
    expect(view(out.state)).toBe('c,b,a @a');
  });

  it('opens a session from the sidebar beside a pane, or in place of it', () => {
    expect(view(drop(s, 'n', 'b', 'left', BIG).state)).toBe('a,n,b,c @n');
    expect(view(drop(s, 'n', 'b', 'center', BIG).state)).toBe('a,n,c @n');
  });

  it('refuses a layout that would not fit, onto itself, or onto nothing', () => {
    const tight = { width: 1100, height: 400 };
    expect(drop(s, 'a', 'c', 'bottom', tight)).toEqual({ state: s, ok: false });
    expect(drop(s, 'a', 'a', 'left', BIG).ok).toBe(false);
    expect(drop(s, 'a', 'x', 'left', BIG).ok).toBe(false);
    expect(drop(NO_PANES, 'a', 'b', 'left', BIG).ok).toBe(false);
  });

  it('says what a drop would make without making it', () => {
    expect(dropResult(s.layout, 'a', 'c', 'right', BIG)).not.toBeNull();
    expect(dropResult(s.layout, 'a', 'c', 'bottom', { width: 1100, height: 400 })).toBeNull();
    expect(dropResult(s.layout, 'a', 'a', 'left', BIG)).toBeNull();
    expect(dropResult(null, 'a', 'c', 'left', BIG)).toBeNull();
  });
});

describe('commitLayout', () => {
  it('takes new sizes for the same sessions', () => {
    const s = at(row([L('a'), L('b')]), 'a');
    const resized = row([L('a'), L('b')], [0.3, 0.7]);
    expect(commitLayout(s, resized).layout).toBe(resized);
    expect(commitLayout(s, row([L('a'), L('b')]))).toBe(s);
  });

  it('ignores a layout of other sessions', () => {
    const s = at(row([L('a'), L('b')]), 'a');
    expect(commitLayout(s, row([L('a'), L('z')], [0.3, 0.7]))).toBe(s);
    expect(commitLayout(s, L('a'))).toBe(s);
    expect(commitLayout(NO_PANES, L('a'))).toBe(NO_PANES);
  });
});
