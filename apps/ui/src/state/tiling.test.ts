import { describe, expect, it } from 'vitest';
import {
  cycleLeaf,
  dockAtEdge,
  equalize,
  flipDirection,
  hasLeaf,
  insertLeaf,
  isSplit,
  leaf,
  leafIds,
  moveLeaf,
  nodeAt,
  normalize,
  parentSplit,
  pathTo,
  removeLeaf,
  removeLeaves,
  replaceLeaf,
  sameTile,
  setSizes,
  splitLeaf,
  swapLeaves,
  toShares,
  type Direction,
  type Tile,
} from './tiling.ts';

const L = leaf;
const split = (direction: Direction, children: Tile[], sizes?: number[]): Tile => ({ direction, children, sizes: sizes ?? children.map(() => 1 / children.length) });
const row = (children: Tile[], sizes?: number[]) => split('row', children, sizes);
const col = (children: Tile[], sizes?: number[]) => split('column', children, sizes);
/** The tree as nested arrays, `r[...]` for a row and `c[...]`, with sizes rounded: easy to read in a failure. */
function show(tile: Tile | null): string {
  if (!tile) return '-';
  if (!isSplit(tile)) return tile.id;
  return `${tile.direction === 'row' ? 'r' : 'c'}[${tile.children.map((child, i) => `${show(child)}${tile.sizes[i]!.toFixed(2).replace(/^0/, '')}`).join(' ')}]`;
}

describe('leafIds and hasLeaf', () => {
  it('list the sessions left to right, top to bottom', () => {
    expect(leafIds(null)).toEqual([]);
    expect(leafIds(L('a'))).toEqual(['a']);
    expect(leafIds(row([L('a'), col([L('b'), L('c')]), L('d')]))).toEqual(['a', 'b', 'c', 'd']);
    expect(hasLeaf(row([L('a'), col([L('b'), L('c')])]), 'c')).toBe(true);
    expect(hasLeaf(row([L('a'), L('b')]), 'x')).toBe(false);
    expect(hasLeaf(null, 'a')).toBe(false);
  });
});

describe('normalize', () => {
  it('dissolves a split with one child and drops empty ones', () => {
    expect(normalize(row([L('a')]))).toEqual(L('a'));
    expect(normalize(row([col([row([L('a')])])]))).toEqual(L('a'));
    expect(normalize(row([]))).toBeNull();
  });

  it('lifts the children of a split with the same direction into its parent, keeping their shares of the space', () => {
    const tree = row([L('a'), row([L('b'), L('c')], [0.25, 0.75])], [0.5, 0.5]);
    expect(show(normalize(tree))).toBe('r[a.50 b.13 c.38]');
  });

  it('keeps a split of the other direction', () => {
    expect(show(normalize(row([L('a'), col([L('b'), L('c')])])))).toBe('r[a.50 c[b.50 c.50].50]');
  });

  it('turns unusable sizes into equal ones', () => {
    expect(show(normalize(row([L('a'), L('b')], [0, 1])))).toBe('r[a.50 b.50]');
    expect(show(normalize(row([L('a'), L('b')], [1, Number.NaN])))).toBe('r[a.50 b.50]');
    expect(show(normalize(row([L('a'), L('b')], [1])))).toBe('r[a.50 b.50]');
    expect(toShares([1, 3], 2)).toEqual([0.25, 0.75]);
  });
});

describe('splitLeaf', () => {
  it('splits a lone pane in the direction of the side, the new one on that side', () => {
    expect(show(splitLeaf(L('a'), 'a', 'b', 'right'))).toBe('r[a.50 b.50]');
    expect(show(splitLeaf(L('a'), 'a', 'b', 'left'))).toBe('r[b.50 a.50]');
    expect(show(splitLeaf(L('a'), 'a', 'b', 'bottom'))).toBe('c[a.50 b.50]');
    expect(show(splitLeaf(L('a'), 'a', 'b', 'top'))).toBe('c[b.50 a.50]');
  });

  it('shares only the target pane, in a split of the same direction', () => {
    const tree = row([L('a'), L('b')], [0.7, 0.3]);
    expect(show(splitLeaf(tree, 'a', 'c', 'right'))).toBe('r[a.35 c.35 b.30]');
    expect(show(splitLeaf(tree, 'b', 'c', 'left'))).toBe('r[a.70 c.15 b.15]');
  });

  it('nests a split of the other direction around the target', () => {
    expect(show(splitLeaf(row([L('a'), L('b')]), 'b', 'c', 'bottom'))).toBe('r[a.50 c[b.50 c.50].50]');
    expect(show(splitLeaf(col([L('a'), L('b')]), 'a', 'c', 'left'))).toBe('c[r[c.50 a.50].50 b.50]');
  });

  it('changes nothing when the target is missing or the session is already open', () => {
    const tree = row([L('a'), L('b')]);
    expect(splitLeaf(tree, 'x', 'c', 'right')).toBe(tree);
    expect(splitLeaf(tree, 'a', 'b', 'right')).toBe(tree);
  });

  it('does not change its input', () => {
    const tree = row([L('a'), L('b')]);
    const copy = JSON.stringify(tree);
    splitLeaf(tree, 'a', 'c', 'bottom');
    expect(JSON.stringify(tree)).toBe(copy);
  });
});

describe('removeLeaf', () => {
  it('gives the space to the pane before it, or to the one after for the first (as VS Code does)', () => {
    const tree = row([L('a'), L('b'), L('c')], [0.5, 0.3, 0.2]);
    expect(show(removeLeaf(tree, 'c'))).toBe('r[a.50 b.50]');
    expect(show(removeLeaf(tree, 'b'))).toBe('r[a.80 c.20]');
    expect(show(removeLeaf(tree, 'a'))).toBe('r[b.80 c.20]');
  });

  it('makes everyone equal again when they were all the same size', () => {
    expect(show(removeLeaf(row([L('a'), L('b'), L('c'), L('d')]), 'b'))).toBe('r[a.33 c.33 d.33]');
    expect(show(removeLeaf(row([L('a'), L('b'), L('c')], [0.335, 0.333, 0.332]), 'a'))).toBe('r[b.50 c.50]');
  });

  it('gives a dissolved split its share of the space above', () => {
    // The column took 60% of the row; its last pane goes, so the one left keeps the 60%.
    expect(show(removeLeaf(row([L('a'), col([L('b'), L('c')])], [0.4, 0.6]), 'b'))).toBe('r[a.40 c.60]');
  });

  it('dissolves a split left with one child, which may then join the split above', () => {
    const tree = row([L('a'), col([L('b'), L('c')])], [0.4, 0.6]);
    expect(show(removeLeaf(tree, 'c'))).toBe('r[a.40 b.60]');
    expect(show(removeLeaf(tree, 'a'))).toBe('c[b.50 c.50]');
    const deep = col([row([L('a'), col([L('b'), L('c')])]), L('d')]);
    expect(show(removeLeaf(deep, 'c'))).toBe('c[r[a.50 b.50].50 d.50]');
  });

  it('leaves nothing when the last pane goes, and ignores an unknown one', () => {
    expect(removeLeaf(L('a'), 'a')).toBeNull();
    const tree = row([L('a'), L('b')]);
    expect(removeLeaf(tree, 'x')).toBe(tree);
    expect(show(removeLeaves(row([L('a'), L('b'), L('c')]), ['a', 'c']))).toBe('b');
    expect(removeLeaves(row([L('a'), L('b')]), ['a', 'b'])).toBeNull();
    expect(removeLeaves(null, ['a'])).toBeNull();
  });
});

describe('swapLeaves and replaceLeaf', () => {
  it('trade sessions in place, each place keeping its size', () => {
    const tree = row([L('a'), col([L('b'), L('c')], [0.3, 0.7])], [0.6, 0.4]);
    expect(show(swapLeaves(tree, 'a', 'c'))).toBe('r[c.60 c[b.30 a.70].40]');
    expect(swapLeaves(tree, 'a', 'a')).toBe(tree);
    expect(swapLeaves(tree, 'a', 'x')).toBe(tree);
  });

  it('puts another session in a pane, unless it is already open', () => {
    const tree = row([L('a'), L('b')]);
    expect(show(replaceLeaf(tree, 'a', 'z'))).toBe('r[z.50 b.50]');
    expect(replaceLeaf(tree, 'a', 'b')).toBe(tree);
    expect(replaceLeaf(tree, 'x', 'z')).toBe(tree);
  });
});

describe('moveLeaf', () => {
  it('docks a pane on the edge of another: everyone equal again if they were, else the target shares its space', () => {
    const tree = row([L('a'), L('b'), L('c')]);
    expect(show(moveLeaf(tree, 'a', 'c', 'right'))).toBe('r[b.33 c.33 a.33]');
    expect(show(moveLeaf(row([L('a'), L('b'), L('c')], [0.5, 0.3, 0.2]), 'a', 'c', 'right'))).toBe('r[b.80 c.10 a.10]');
    expect(show(moveLeaf(tree, 'a', 'c', 'bottom'))).toBe('r[b.50 c[c.50 a.50].50]');
    expect(show(moveLeaf(tree, 'c', 'a', 'top'))).toBe('r[c[c.50 a.50].50 b.50]');
  });

  it('swaps in the centre, and does nothing onto itself', () => {
    const tree = row([L('a'), col([L('b'), L('c')])]);
    expect(show(moveLeaf(tree, 'a', 'c', 'center'))).toBe('r[c.50 c[b.50 a.50].50]');
    expect(moveLeaf(tree, 'a', 'a', 'left')).toBe(tree);
    expect(moveLeaf(tree, 'a', 'x', 'left')).toBe(tree);
  });

  it('keeps every session, once', () => {
    const tree = row([L('a'), col([L('b'), L('c')]), L('d')]);
    for (const id of ['a', 'b', 'c', 'd']) {
      for (const target of ['a', 'b', 'c', 'd']) {
        for (const zone of ['left', 'right', 'top', 'bottom', 'center'] as const) {
          expect(leafIds(moveLeaf(tree, id, target, zone)).sort(), `${id} onto ${target} ${zone}`).toEqual(['a', 'b', 'c', 'd']);
        }
      }
    }
  });
});

describe('splitLeaf sizes (VS Code auto sizing)', () => {
  it('makes a same-direction split equal when all its panes were', () => {
    expect(show(splitLeaf(row([L('a'), L('b'), L('c')]), 'b', 'd', 'right'))).toBe('r[a.25 b.25 d.25 c.25]');
    expect(show(splitLeaf(row([L('a'), L('b')]), 'a', 'c', 'left'))).toBe('r[c.33 a.33 b.33]');
  });

  it('shares the target only when the panes had been resized by hand', () => {
    expect(show(splitLeaf(row([L('a'), L('b'), L('c')], [0.5, 0.3, 0.2]), 'b', 'd', 'right'))).toBe('r[a.50 b.15 d.15 c.20]');
  });

  it('inserts a sibling at that position in the same-direction split, not a nested split', () => {
    const out = splitLeaf(row([L('a'), L('b'), L('c')]), 'b', 'x', 'left');
    expect(leafIds(out)).toEqual(['a', 'x', 'b', 'c']);
    expect(isSplit(out) && out.children.every((child) => !isSplit(child))).toBe(true);
  });
});

describe('dockAtEdge', () => {
  /** A on the left, B over C on the right: half and half, and B over C half and half. */
  const layout = () => row([L('a'), col([L('b'), L('c')])]);

  it('turns A | (B over C) into three equal columns when C is docked on the right edge', () => {
    const out = dockAtEdge(layout(), 'c', 'right');
    expect(show(out)).toBe('r[a.33 b.33 c.33]');
    expect(leafIds(out)).toEqual(['a', 'b', 'c']);
  });

  it('docks on every edge of a root split of the same direction, as a new cell the whole length', () => {
    const wide = row([L('a'), L('b')]);
    expect(show(dockAtEdge(wide, 'n', 'left'))).toBe('r[n.33 a.33 b.33]');
    expect(show(dockAtEdge(wide, 'n', 'right'))).toBe('r[a.33 b.33 n.33]');
    const tall = col([L('a'), L('b')]);
    expect(show(dockAtEdge(tall, 'n', 'top'))).toBe('c[n.33 a.33 b.33]');
    expect(show(dockAtEdge(tall, 'n', 'bottom'))).toBe('c[a.33 b.33 n.33]');
  });

  it('wraps the whole old layout as one cell when the root runs the other way', () => {
    const wide = row([L('a'), L('b')], [0.4, 0.6]);
    expect(show(dockAtEdge(wide, 'n', 'top'))).toBe('c[n.50 r[a.40 b.60].50]');
    expect(show(dockAtEdge(wide, 'n', 'bottom'))).toBe('c[r[a.40 b.60].50 n.50]');
    const tall = col([L('a'), L('b')]);
    expect(show(dockAtEdge(tall, 'n', 'left'))).toBe('r[n.50 c[a.50 b.50].50]');
    expect(show(dockAtEdge(tall, 'n', 'right'))).toBe('r[c[a.50 b.50].50 n.50]');
  });

  it('wraps a lone pane, half each', () => {
    expect(show(dockAtEdge(L('a'), 'n', 'right'))).toBe('r[a.50 n.50]');
    expect(show(dockAtEdge(L('a'), 'n', 'top'))).toBe('c[n.50 a.50]');
  });

  it('keeps the proportions of resized panes and gives the new cell a 1/(n+1) share', () => {
    expect(show(dockAtEdge(row([L('a'), L('b')], [0.7, 0.3]), 'n', 'right'))).toBe('r[a.47 b.20 n.33]');
  });

  it('takes an open pane out of its place first: the space goes to its neighbours and a split of one dissolves', () => {
    // Taking B out of the column leaves C alone in it, which takes the column's whole space.
    const out = dockAtEdge(row([L('a'), col([L('b'), L('c')])], [0.3, 0.7]), 'b', 'left');
    expect(show(out)).toBe('r[b.33 a.20 c.47]');
    expect(leafIds(out)).toEqual(['b', 'a', 'c']);
    expect(isSplit(out) && out.children.every((child) => !isSplit(child))).toBe(true);
  });

  it('moves a pane that is the only other child of a split out of it, dissolving the split', () => {
    const out = dockAtEdge(layout(), 'b', 'bottom');
    // A | C stay side by side and B spans the whole bottom.
    expect(show(out)).toBe('c[r[a.50 c.50].50 b.50]');
  });

  it('does nothing for a lone pane, and adds a new session at the edge', () => {
    const lone = L('a');
    expect(dockAtEdge(lone, 'a', 'right')).toBe(lone);
    expect(show(dockAtEdge(row([L('a'), L('b')]), 'z', 'left'))).toBe('r[z.33 a.33 b.33]');
  });

  it('keeps every session exactly once whichever edge', () => {
    for (const id of ['a', 'b', 'c']) {
      for (const side of ['left', 'right', 'top', 'bottom'] as const) {
        expect(leafIds(dockAtEdge(layout(), id, side)).sort(), `${id} ${side}`).toEqual(['a', 'b', 'c']);
      }
    }
  });
});

describe('insertLeaf', () => {
  it('docks a new session on an edge and replaces the target in the centre', () => {
    const tree = row([L('a'), L('b')]);
    expect(show(insertLeaf(tree, 'n', 'a', 'bottom'))).toBe('r[c[a.50 n.50].50 b.50]');
    expect(show(insertLeaf(tree, 'n', 'a', 'center'))).toBe('r[n.50 b.50]');
  });

  it('moves a session that is already open instead of opening it twice', () => {
    const tree = row([L('a'), L('b'), L('c')]);
    expect(show(insertLeaf(tree, 'a', 'c', 'bottom'))).toBe('r[b.50 c[c.50 a.50].50]');
    expect(show(insertLeaf(tree, 'a', 'c', 'center'))).toBe('r[c.33 b.33 a.33]');
  });
});

describe('paths and parents', () => {
  const tree = row([L('a'), col([L('b'), L('c')])]);
  it('find a pane and the split above it', () => {
    expect(pathTo(tree, 'a')).toEqual([0]);
    expect(pathTo(tree, 'c')).toEqual([1, 1]);
    expect(pathTo(tree, 'x')).toBeNull();
    expect(pathTo(L('a'), 'a')).toEqual([]);
    expect(parentSplit(tree, 'c')?.path).toEqual([1]);
    expect(parentSplit(tree, 'c')?.split.direction).toBe('column');
    expect(parentSplit(tree, 'a')?.path).toEqual([]);
    expect(parentSplit(L('a'), 'a')).toBeNull();
    expect(nodeAt(tree, [1, 0])).toEqual(L('b'));
    expect(nodeAt(tree, [3])).toBeNull();
    expect(nodeAt(tree, [0, 0])).toBeNull();
  });
});

describe('flipDirection', () => {
  it('turns the split above a pane the other way, keeping the sizes', () => {
    expect(show(flipDirection(row([L('a'), L('b')], [0.3, 0.7]), 'a'))).toBe('c[a.30 b.70]');
    const tree = row([L('a'), col([L('b'), L('c')])]);
    expect(show(flipDirection(tree, 'b'))).toBe('r[a.50 b.25 c.25]');
  });

  it('joins the split above when it then has the same direction', () => {
    const tree = col([row([L('a'), L('b')]), L('c')]);
    expect(show(flipDirection(tree, 'a'))).toBe('c[a.25 b.25 c.50]');
  });

  it('does nothing to a lone pane', () => {
    expect(flipDirection(L('a'), 'a')).toEqual(L('a'));
  });
});

describe('sizes', () => {
  const tree = row([L('a'), col([L('b'), L('c')], [0.2, 0.8]), L('d')], [0.5, 0.3, 0.2]);
  it('sets the sizes of one split', () => {
    expect(show(setSizes(tree, [1], [1, 1]))).toBe('r[a.50 c[b.50 c.50].30 d.20]');
    expect(show(setSizes(tree, [], [2, 1, 1]))).toBe('r[a.50 c[b.20 c.80].25 d.25]');
    expect(setSizes(tree, [0], [1, 1])).toBe(tree);
  });

  it('equalizes one split', () => {
    expect(show(equalize(tree, []))).toBe('r[a.33 c[b.20 c.80].33 d.33]');
    expect(show(equalize(tree, [1]))).toBe('r[a.50 c[b.50 c.50].30 d.20]');
  });
});

describe('cycleLeaf and sameTile', () => {
  it('goes round the panes in reading order', () => {
    const tree = row([L('a'), col([L('b'), L('c')])]);
    expect(cycleLeaf(tree, 'a')).toBe('b');
    expect(cycleLeaf(tree, 'c')).toBe('a');
    expect(cycleLeaf(tree, 'a', -1)).toBe('c');
    expect(cycleLeaf(L('a'), 'a')).toBeNull();
    expect(cycleLeaf(tree, 'x')).toBeNull();
    expect(cycleLeaf(null, 'a')).toBeNull();
  });

  it('compares shape, sessions and sizes', () => {
    expect(sameTile(row([L('a'), L('b')]), row([L('a'), L('b')]))).toBe(true);
    expect(sameTile(row([L('a'), L('b')]), row([L('b'), L('a')]))).toBe(false);
    expect(sameTile(row([L('a'), L('b')]), col([L('a'), L('b')]))).toBe(false);
    expect(sameTile(row([L('a'), L('b')], [0.4, 0.6]), row([L('a'), L('b')]))).toBe(false);
    expect(sameTile(null, null)).toBe(true);
    expect(sameTile(L('a'), null)).toBe(false);
    expect(sameTile(L('a'), row([L('a'), L('b')]))).toBe(false);
  });
});
