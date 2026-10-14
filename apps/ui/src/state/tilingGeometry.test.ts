import { describe, expect, it } from 'vitest';
import { leaf, leafIds, nodeAt, type Direction, type Tile } from './tiling.ts';
import {
  boundaryOf,
  clampShares,
  computeLayout,
  constrain,
  dividerKey,
  DIVIDER_KEY_STEP,
  DIVIDER_SNAP,
  dragStarted,
  dropRegion,
  dropTarget,
  fits,
  MIN_PANE_HEIGHT,
  MIN_PANE_WIDTH,
  minSize,
  moveDivider,
  moveDividerByKey,
  neighbour,
  planOpen,
  preferredSide,
  snapBoundary,
  stableOrder,
  zoneAt,
  type Box,
  type Rect,
} from './tilingGeometry.ts';

const L = leaf;
const split = (direction: Direction, children: Tile[], sizes?: number[]): Tile => ({ direction, children, sizes: sizes ?? children.map(() => 1 / children.length) });
const row = (children: Tile[], sizes?: number[]) => split('row', children, sizes);
const col = (children: Tile[], sizes?: number[]) => split('column', children, sizes);
const near = (box: Box | undefined, x: number, y: number, w: number, h: number) => {
  expect(box).toBeDefined();
  expect([box!.x, box!.y, box!.w, box!.h].map((n) => Math.round(n * 1000) / 1000)).toEqual([x, y, w, h]);
};

describe('computeLayout', () => {
  it('gives a lone pane the whole area and no dividers', () => {
    const { panes, dividers } = computeLayout(L('a'));
    near(panes[0]?.box, 0, 0, 1, 1);
    expect(dividers).toEqual([]);
    expect(computeLayout(null)).toEqual({ panes: [], dividers: [] });
  });

  it('places a mix of rows and columns by their sizes', () => {
    const tree = row([L('a'), col([L('b'), L('c')], [0.25, 0.75])], [0.4, 0.6]);
    const { panes, dividers } = computeLayout(tree);
    const box = (id: string) => panes.find((p) => p.id === id)?.box;
    near(box('a'), 0, 0, 0.4, 1);
    near(box('b'), 0.4, 0, 0.6, 0.25);
    near(box('c'), 0.4, 0.25, 0.6, 0.75);
    expect(dividers).toHaveLength(2);
    // The one between a and the column: a vertical line full height at x = 0.4.
    const vertical = dividers.find((d) => d.direction === 'row')!;
    expect(vertical.path).toEqual([]);
    expect(vertical.index).toBe(0);
    expect(vertical.boundary).toBeCloseTo(0.4);
    near(vertical.line, 0.4, 0, 0, 1);
    // The one between b and c: a horizontal line over the column only.
    const horizontal = dividers.find((d) => d.direction === 'column')!;
    expect(horizontal.path).toEqual([1]);
    near(horizontal.line, 0.4, 0.25, 0.6, 0);
    near(horizontal.split, 0.4, 0, 0.6, 1);
  });

  it('covers the area exactly once', () => {
    const tree = col([row([L('a'), L('b'), L('c')], [0.2, 0.3, 0.5]), row([L('d'), col([L('e'), L('f')])])], [0.35, 0.65]);
    const { panes } = computeLayout(tree);
    expect(panes.reduce((sum, p) => sum + p.box.w * p.box.h, 0)).toBeCloseTo(1);
    expect(panes.map((p) => p.id)).toEqual(leafIds(tree));
  });
});

describe('minSize and fits', () => {
  it('adds the minimums side by side and stacked', () => {
    expect(minSize(L('a'))).toEqual({ width: MIN_PANE_WIDTH, height: MIN_PANE_HEIGHT });
    expect(minSize(row([L('a'), L('b'), L('c')]))).toEqual({ width: 3 * MIN_PANE_WIDTH, height: MIN_PANE_HEIGHT });
    expect(minSize(col([L('a'), L('b')]))).toEqual({ width: MIN_PANE_WIDTH, height: 2 * MIN_PANE_HEIGHT });
    expect(minSize(row([L('a'), col([L('b'), row([L('c'), L('d')])])]))).toEqual({ width: 3 * MIN_PANE_WIDTH, height: 2 * MIN_PANE_HEIGHT });
  });

  it('says whether an area holds a tree at the minimums', () => {
    const grid = row([col([L('a'), L('b')]), col([L('c'), L('d')])]);
    expect(fits(grid, { width: 680, height: 680 })).toBe(true);
    expect(fits(grid, { width: 679, height: 680 })).toBe(false);
    expect(fits(grid, { width: 680, height: 679 })).toBe(false);
    expect(fits(grid, null)).toBe(true);
  });
});

describe('clampShares and constrain', () => {
  it('raises a share under its minimum and takes the difference from the others in proportion', () => {
    const out = clampShares([0.05, 0.45, 0.5], 1500, [340, 340, 340]);
    expect(out[0]).toBeCloseTo(340 / 1500);
    expect(out.reduce((s, n) => s + n, 0)).toBeCloseTo(1);
    expect(out[1]! / out[2]!).toBeCloseTo(0.45 / 0.5);
  });

  it('leaves shares that already fit, and follows the minimums when there is no room at all', () => {
    expect(clampShares([0.5, 0.5], 1000, [340, 340])).toEqual([0.5, 0.5]);
    expect(clampShares([0.9, 0.1], 500, [340, 340])).toEqual([0.5, 0.5]);
    expect(clampShares([0.5, 0.5], 0, [340, 340])).toEqual([0.5, 0.5]);
  });

  it('keeps panes at their minimum after a window shrank, down the tree, and returns the same tree when it fits', () => {
    const tree = row([L('a'), col([L('b'), L('c')], [0.1, 0.9])], [0.5, 0.5]);
    const roomy = row([L('a'), col([L('b'), L('c')], [0.4, 0.6])], [0.5, 0.5]);
    expect(constrain(roomy, { width: 1400, height: 1000 })).toBe(roomy);
    const shown = constrain(tree, { width: 800, height: 700 });
    const panes = computeLayout(shown).panes;
    for (const p of panes) {
      expect(p.box.w * 800).toBeGreaterThanOrEqual(MIN_PANE_WIDTH - 1e-6);
      expect(p.box.h * 700).toBeGreaterThanOrEqual(MIN_PANE_HEIGHT - 1e-6);
    }
    // The saved sizes are untouched.
    expect(tree).toMatchObject({ sizes: [0.5, 0.5] });
  });

  it('respects what a nested split needs along the parent direction', () => {
    // The column holds a row of two, so it needs two panes' width.
    const tree = row([L('a'), col([L('b'), row([L('c'), L('d')])])], [0.8, 0.2]);
    const shown = computeLayout(constrain(tree, { width: 1200, height: 800 })).panes;
    expect(shown.find((p) => p.id === 'b')!.box.w * 1200).toBeGreaterThanOrEqual(2 * MIN_PANE_WIDTH - 1e-6);
  });
});

describe('moveDivider', () => {
  const area = 2400;
  const tree = row([L('a'), L('b'), L('c')], [0.3, 0.4, 0.3]);
  const sizes = (t: Tile, path: number[] = []) => (nodeAt(t, path) as { sizes: number[] }).sizes.map((n) => Math.round(n * 1000) / 1000);

  it('moves one edge and changes only the two panes beside it', () => {
    expect(sizes(moveDivider(tree, [], 0, 0.4, area))).toEqual([0.4, 0.3, 0.3]);
    expect(sizes(moveDivider(tree, [], 1, 0.6, area))).toEqual([0.3, 0.3, 0.4]);
  });

  it('never takes a pane under its minimum', () => {
    expect(sizes(moveDivider(tree, [], 0, 0, area))).toEqual([0.142, 0.558, 0.3]);
    expect(sizes(moveDivider(tree, [], 0, 1, area))).toEqual([0.558, 0.142, 0.3]);
  });

  it('measures a nested split by what its children need', () => {
    const nested = row([L('a'), col([L('b'), L('c')], [0.5, 0.5])]);
    // The column's divider (horizontal): the split is 600 tall here, 340 is the least for each.
    expect(sizes(moveDivider(nested, [1], 0, 0.99, 700), [1])).toEqual([0.514, 0.486]);
  });

  it('ignores a path or index that leads nowhere', () => {
    expect(moveDivider(tree, [], 5, 0.5, area)).toBe(tree);
    expect(moveDivider(tree, [0], 0, 0.5, area)).toBe(tree);
    expect(moveDivider(tree, [], 0, Number.NaN, area)).toBe(tree);
    expect(moveDivider(L('a'), [], 0, 0.5, area)).toEqual(L('a'));
  });

  it('snaps to the middle of the two panes it sits between', () => {
    const unequal = row([L('a'), L('b')], [0.4, 0.6]);
    expect(snapBoundary(unequal, [], 0, 0.5 + (DIVIDER_SNAP - 1) / 1000, 1000)).toBeCloseTo(0.5);
    expect(snapBoundary(unequal, [], 0, 0.5 + (DIVIDER_SNAP + 2) / 1000, 1000)).toBeCloseTo(0.5 + (DIVIDER_SNAP + 2) / 1000);
    expect(snapBoundary(tree, [], 1, 0.66, 1000)).toBeCloseTo(0.3 + 0.7 / 2);
  });

  it('reads where an edge is', () => {
    expect(boundaryOf(tree, [], 0)).toBeCloseTo(0.3);
    expect(boundaryOf(tree, [], 1)).toBeCloseTo(0.7);
    expect(boundaryOf(tree, [], 2)).toBeNull();
    expect(boundaryOf(L('a'), [], 0)).toBeNull();
  });
});

describe('keys on a divider', () => {
  const tree = row([L('a'), L('b')]);
  const stacked = col([L('a'), L('b')]);
  it('moves a vertical divider with ← → and a horizontal one with ↑ ↓', () => {
    expect(dividerKey('row', 'ArrowLeft')).toBe(-DIVIDER_KEY_STEP);
    expect(dividerKey('row', 'ArrowRight')).toBe(DIVIDER_KEY_STEP);
    expect(dividerKey('row', 'ArrowUp')).toBeNull();
    expect(dividerKey('column', 'ArrowUp')).toBe(-DIVIDER_KEY_STEP);
    expect(dividerKey('column', 'ArrowDown')).toBe(DIVIDER_KEY_STEP);
    expect(dividerKey('column', 'ArrowLeft')).toBeNull();
    expect(dividerKey('row', 'Home')).toBe('start');
    expect(dividerKey('row', 'End')).toBe('end');
    expect(dividerKey('row', 'a')).toBeNull();
  });

  it('steps by a fixed number of pixels', () => {
    const next = moveDividerByKey(tree, [], 0, 'ArrowRight', 1000) as { sizes: number[] };
    expect(next.sizes[0]).toBeCloseTo(0.5 + DIVIDER_KEY_STEP / 1000);
    const up = moveDividerByKey(stacked, [], 0, 'ArrowUp', 1000) as { sizes: number[] };
    expect(up.sizes[0]).toBeCloseTo(0.5 - DIVIDER_KEY_STEP / 1000);
  });

  it('goes as far as the minimums allow with Home and End, and ignores other keys', () => {
    const start = moveDividerByKey(tree, [], 0, 'Home', 1000) as { sizes: number[] };
    expect(start.sizes[0]).toBeCloseTo(0.34);
    const end = moveDividerByKey(tree, [], 0, 'End', 1000) as { sizes: number[] };
    expect(end.sizes[0]).toBeCloseTo(0.66);
    expect(moveDividerByKey(tree, [], 0, 'ArrowUp', 1000)).toBe(tree);
    expect(moveDividerByKey(tree, [], 0, 'x', 1000)).toBe(tree);
  });
});

describe('neighbour', () => {
  //  a | b
  //  a | c | d
  const tree = row([L('a'), col([L('b'), row([L('c'), L('d')])])]);
  it('finds the pane next door in each direction', () => {
    expect(neighbour(tree, 'a', 'right')).toBe('b');
    expect(neighbour(tree, 'b', 'left')).toBe('a');
    expect(neighbour(tree, 'b', 'down')).toBe('c');
    expect(neighbour(tree, 'c', 'up')).toBe('b');
    expect(neighbour(tree, 'c', 'right')).toBe('d');
    expect(neighbour(tree, 'd', 'left')).toBe('c');
    expect(neighbour(tree, 'c', 'left')).toBe('a');
  });

  it('is null at an edge, for a lone pane and for an unknown one', () => {
    expect(neighbour(tree, 'a', 'left')).toBeNull();
    expect(neighbour(tree, 'a', 'up')).toBeNull();
    expect(neighbour(tree, 'd', 'right')).toBeNull();
    expect(neighbour(L('a'), 'a', 'right')).toBeNull();
    expect(neighbour(tree, 'x', 'right')).toBeNull();
    expect(neighbour(null, 'a', 'right')).toBeNull();
  });

  it('prefers the neighbour closest to the middle of the pane it leaves', () => {
    // From the tall pane a, right goes to whichever of b, c sits at the middle of a's height.
    const t = row([L('a'), col([L('b'), L('c'), L('d')], [0.2, 0.6, 0.2])]);
    expect(neighbour(t, 'a', 'right')).toBe('c');
    // Going down from the wide pane over two panes picks the one under its middle.
    const u = col([L('x'), row([L('y'), L('z')], [0.3, 0.7])]);
    expect(neighbour(u, 'x', 'down')).toBe('z');
  });
});

describe('planOpen', () => {
  const area = { width: 1200, height: 800 };
  it('picks a side by the shape of the pane: wide goes beside, tall goes below', () => {
    expect(preferredSide({ width: 800, height: 700 })).toBe('right');
    expect(preferredSide({ width: 700, height: 700 })).toBe('right');
    expect(preferredSide({ width: 600, height: 700 })).toBe('bottom');
  });

  it('splits a lone pane in the area beside it', () => {
    const plan = planOpen(L('a'), 'a', 'b', area);
    expect(plan?.side).toBe('right');
    expect(leafIds(plan?.tree ?? null)).toEqual(['a', 'b']);
  });

  it('stacks the new one under a tall pane', () => {
    const plan = planOpen(row([L('a'), L('b')]), 'a', 'c', { width: 1200, height: 800 });
    expect(plan?.side).toBe('bottom');
    expect(leafIds(plan?.tree ?? null)).toEqual(['a', 'c', 'b']);
  });

  it('tries the other side when the preferred one does not fit', () => {
    // Wide pane, but only 700 wide in total and 800 tall: side by side needs 680 and fits, so shrink the width.
    const narrow = { width: 600, height: 800 };
    const plan = planOpen(L('a'), 'a', 'b', narrow);
    expect(plan?.side).toBe('bottom');
    const short = { width: 1400, height: 600 };
    expect(planOpen(L('a'), 'a', 'b', short)?.side).toBe('right');
  });

  it('opens nothing when the window has no room for another pane', () => {
    expect(planOpen(L('a'), 'a', 'b', { width: 600, height: 600 })).toBeNull();
    const full = row([col([L('a'), L('b')]), col([L('c'), L('d')])]);
    expect(planOpen(full, 'a', 'e', { width: 700, height: 700 })).toBeNull();
    expect(planOpen(full, 'a', 'e', { width: 1100, height: 700 })).not.toBeNull();
  });

  it('assumes there is room until the area is measured, and ignores a session already open', () => {
    expect(planOpen(L('a'), 'a', 'b', null)?.side).toBe('right');
    expect(planOpen(row([L('a'), L('b')]), 'a', 'b', area)).toBeNull();
  });
});

describe('drop zones', () => {
  const rect: Rect = { left: 100, top: 100, right: 500, bottom: 300 };
  it('says which part of a pane a point is over', () => {
    expect(zoneAt({ x: 300, y: 200 }, rect)).toBe('center');
    expect(zoneAt({ x: 110, y: 200 }, rect)).toBe('left');
    expect(zoneAt({ x: 490, y: 200 }, rect)).toBe('right');
    expect(zoneAt({ x: 300, y: 110 }, rect)).toBe('top');
    expect(zoneAt({ x: 300, y: 290 }, rect)).toBe('bottom');
  });

  it('gives a corner to the nearer edge, in proportion to the pane', () => {
    // 5% in across a 400 wide pane (20px) and 10% down a 200 tall one (20px): the nearer in proportion is left.
    expect(zoneAt({ x: 120, y: 120 }, rect)).toBe('left');
    expect(zoneAt({ x: 150, y: 105 }, rect)).toBe('top');
  });

  it('is nothing outside the pane or for an empty one', () => {
    expect(zoneAt({ x: 99, y: 200 }, rect)).toBeNull();
    expect(zoneAt({ x: 500, y: 200 }, rect)).toBeNull();
    expect(zoneAt({ x: 300, y: 300 }, rect)).toBeNull();
    expect(zoneAt({ x: 1, y: 1 }, { left: 1, top: 1, right: 1, bottom: 1 })).toBeNull();
  });

  it('shows the region a drop would give: that half, or the whole pane to swap', () => {
    expect(dropRegion(rect, 'left')).toEqual({ left: 100, top: 100, right: 300, bottom: 300 });
    expect(dropRegion(rect, 'right')).toEqual({ left: 300, top: 100, right: 500, bottom: 300 });
    expect(dropRegion(rect, 'top')).toEqual({ left: 100, top: 100, right: 500, bottom: 200 });
    expect(dropRegion(rect, 'bottom')).toEqual({ left: 100, top: 200, right: 500, bottom: 300 });
    expect(dropRegion(rect, 'center')).toEqual(rect);
  });

  it('finds the pane under the pointer, never the one being dragged', () => {
    const panes = [
      { id: 'a', rect: { left: 0, top: 0, right: 400, bottom: 400 } },
      { id: 'b', rect: { left: 400, top: 0, right: 800, bottom: 400 } },
    ];
    expect(dropTarget('a', { x: 600, y: 200 }, panes)).toEqual({ id: 'b', zone: 'center' });
    expect(dropTarget('a', { x: 410, y: 200 }, panes)).toEqual({ id: 'b', zone: 'left' });
    expect(dropTarget('a', { x: 100, y: 200 }, panes)).toBeNull();
    expect(dropTarget(null, { x: 100, y: 200 }, panes)).toEqual({ id: 'a', zone: 'center' });
    expect(dropTarget('a', { x: 900, y: 200 }, panes)).toBeNull();
  });

  it('starts a drag only after a few pixels', () => {
    expect(dragStarted({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(false);
    expect(dragStarted({ x: 0, y: 0 }, { x: 6, y: 0 })).toBe(true);
  });
});

describe('stableOrder', () => {
  it('lists the sessions by id whatever their places, so the elements never move', () => {
    expect(stableOrder(row([L('c'), L('a'), col([L('b'), L('d')])]))).toEqual(['a', 'b', 'c', 'd']);
    expect(stableOrder(row([L('a'), L('c'), col([L('d'), L('b')])]))).toEqual(['a', 'b', 'c', 'd']);
    expect(stableOrder(null)).toEqual([]);
  });
});
