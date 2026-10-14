// The split view's layout as a tree, and every operation on it. Pure functions only (no window, no stores), so
// they are unit tested next to this file; the sessions store keeps the tree and the view draws it.
//
// A leaf is a pane showing one session, identified by that session's id (a session is open in one pane at most).
// A split lays its children out in a `row` (side by side, left to right) or a `column` (one above the other, top
// to bottom); `sizes` are each child's share of the split along that direction and add up to 1. The tree is
// always kept normal (see `normalize`): a split has two or more children, and never holds a split of its own
// direction, because that one's children could just sit in the parent.

/** `row`: the children sit side by side. `column`: they sit one above the other. */
export type Direction = 'row' | 'column';
/** An edge of a pane, where another pane can dock. */
export type Side = 'left' | 'right' | 'top' | 'bottom';
/** Where on a pane something is dropped: an edge docks beside it, the centre swaps (or replaces). */
export type Zone = Side | 'center';

export interface Leaf {
  /** The session this pane shows. */
  id: string;
}
export interface Split {
  direction: Direction;
  children: Tile[];
  /** Each child's share of the split's length along its direction. Add up to 1. */
  sizes: number[];
}
export type Tile = Leaf | Split;

export const isSplit = (tile: Tile): tile is Split => 'children' in tile;
export const leaf = (id: string): Leaf => ({ id });

/** The direction a split must have for a pane to sit on `side` of another. */
export const sideDirection = (side: Side): Direction => (side === 'left' || side === 'right' ? 'row' : 'column');
/** Docking on this side puts the new pane first (left or above) in the split. */
const comesFirst = (side: Side) => side === 'left' || side === 'top';
export const otherDirection = (direction: Direction): Direction => (direction === 'row' ? 'column' : 'row');

/** The sessions in the tree, in reading order: left to right and top to bottom. */
export function leafIds(tile: Tile | null): string[] {
  if (!tile) return [];
  return isSplit(tile) ? tile.children.flatMap(leafIds) : [tile.id];
}

export const hasLeaf = (tile: Tile | null, id: string): boolean => (tile ? (isSplit(tile) ? tile.children.some((child) => hasLeaf(child, id)) : tile.id === id) : false);

/** The same shape, sizes and sessions (sizes within rounding). */
export function sameTile(a: Tile | null, b: Tile | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (!isSplit(a) || !isSplit(b)) return !isSplit(a) && !isSplit(b) && a.id === b.id;
  return (
    a.direction === b.direction &&
    a.children.length === b.children.length &&
    a.sizes.every((size, i) => Math.abs(size - b.sizes[i]!) < 1e-9) &&
    a.children.every((child, i) => sameTile(child, b.children[i]!))
  );
}

/** `n` equal shares. */
export const equalSizes = (n: number): number[] => Array.from({ length: n }, () => 1 / n);

/** Shares that add up to 1; anything that isn't a usable list of `n` positive numbers becomes equal shares. */
export function toShares(sizes: readonly number[], n: number): number[] {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (sizes.length !== n || !sizes.every((size) => Number.isFinite(size) && size > 0) || !(total > 0)) return equalSizes(n);
  return sizes.map((size) => size / total);
}

/**
 * A split built from children and their shares, put in normal form: children that are gone (null) leave their
 * space to the others in proportion, a split of one child is that child, and a child split with the parent's
 * own direction gives its children to the parent (each keeps its share of the space it had).
 */
function build(direction: Direction, items: ReadonlyArray<readonly [Tile | null, number]>): Tile | null {
  const kept: Array<[Tile, number]> = [];
  for (const [child, size] of items) {
    if (!child) continue;
    if (isSplit(child) && child.direction === direction) child.children.forEach((grandchild, i) => kept.push([grandchild, child.sizes[i]! * size]));
    else kept.push([child, size]);
  }
  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0]![0];
  return { direction, children: kept.map(([child]) => child), sizes: toShares(kept.map(([, size]) => size), kept.length) };
}

/** The tree in normal form (see the top of this file); a split without children is nothing. */
export function normalize(tile: Tile): Tile | null {
  if (!isSplit(tile)) return tile;
  const sizes = toShares(tile.sizes, tile.children.length);
  return build(
    tile.direction,
    tile.children.map((child, i) => [normalize(child), sizes[i]!] as const),
  );
}

/** A pane on `side` of the one showing `targetId`, showing `newId`: the target's space is shared equally. Nothing changes if either is already or not there. */
export function splitLeaf(tree: Tile, targetId: string, newId: string, side: Side): Tile {
  if (!hasLeaf(tree, targetId) || hasLeaf(tree, newId)) return tree;
  const direction = sideDirection(side);
  const wrap = (tile: Tile): Tile => {
    if (isSplit(tile)) return { ...tile, children: tile.children.map(wrap) };
    if (tile.id !== targetId) return tile;
    return { direction, children: comesFirst(side) ? [leaf(newId), tile] : [tile, leaf(newId)], sizes: [0.5, 0.5] };
  };
  return normalize(wrap(tree)) ?? tree;
}

/** The tree without the pane showing `id`: its siblings take the space in proportion, and a split left with one child dissolves. Null when nothing is left. */
export function removeLeaf(tree: Tile, id: string): Tile | null {
  if (!hasLeaf(tree, id)) return tree;
  const prune = (tile: Tile): Tile | null => {
    if (!isSplit(tile)) return tile.id === id ? null : tile;
    return build(
      tile.direction,
      tile.children.map((child, i) => [prune(child), tile.sizes[i]!] as const),
    );
  };
  return prune(tree);
}

/** The tree without these panes. */
export function removeLeaves(tree: Tile | null, ids: readonly string[]): Tile | null {
  let next = tree;
  for (const id of ids) next = next ? removeLeaf(next, id) : null;
  return next;
}

/** The two panes trade sessions in place: each keeps its position and size. */
export function swapLeaves(tree: Tile, a: string, b: string): Tile {
  if (a === b || !hasLeaf(tree, a) || !hasLeaf(tree, b)) return tree;
  const swap = (tile: Tile): Tile => (isSplit(tile) ? { ...tile, children: tile.children.map(swap) } : tile.id === a ? leaf(b) : tile.id === b ? leaf(a) : tile);
  return swap(tree);
}

/** The pane showing `oldId` shows `newId` instead (the session isn't open elsewhere in the tree). */
export function replaceLeaf(tree: Tile, oldId: string, newId: string): Tile {
  if (oldId === newId || !hasLeaf(tree, oldId) || hasLeaf(tree, newId)) return tree;
  const replace = (tile: Tile): Tile => (isSplit(tile) ? { ...tile, children: tile.children.map(replace) } : tile.id === oldId ? leaf(newId) : tile);
  return replace(tree);
}

/**
 * Drops the pane showing `id` on `zone` of the pane showing `targetId`: an edge takes the pane out of its place
 * and docks it on that side (the target's space is shared), the centre swaps the two.
 */
export function moveLeaf(tree: Tile, id: string, targetId: string, zone: Zone): Tile {
  if (id === targetId || !hasLeaf(tree, id) || !hasLeaf(tree, targetId)) return tree;
  if (zone === 'center') return swapLeaves(tree, id, targetId);
  const rest = removeLeaf(tree, id);
  return rest ? splitLeaf(rest, targetId, id, zone) : tree;
}

/**
 * Drops a session on `zone` of the pane showing `targetId`. One that is already open moves there (`moveLeaf`);
 * a new one docks beside the target on an edge, and replaces the target's session in the centre.
 */
export function insertLeaf(tree: Tile, newId: string, targetId: string, zone: Zone): Tile {
  if (hasLeaf(tree, newId)) return moveLeaf(tree, newId, targetId, zone);
  return zone === 'center' ? replaceLeaf(tree, targetId, newId) : splitLeaf(tree, targetId, newId, zone);
}

/** The child indexes that lead from the root to the pane showing `id` (empty for a lone pane), or null. */
export function pathTo(tree: Tile | null, id: string): number[] | null {
  if (!tree) return null;
  if (!isSplit(tree)) return tree.id === id ? [] : null;
  for (const [i, child] of tree.children.entries()) {
    const rest = pathTo(child, id);
    if (rest) return [i, ...rest];
  }
  return null;
}

/** The node at a path from the root, or null when the path leads nowhere. */
export function nodeAt(tree: Tile, path: readonly number[]): Tile | null {
  let node: Tile = tree;
  for (const i of path) {
    if (!isSplit(node) || !node.children[i]) return null;
    node = node.children[i]!;
  }
  return node;
}

/** The split that holds the pane showing `id` directly, with its path; null for a lone pane. */
export function parentSplit(tree: Tile | null, id: string): { split: Split; path: number[] } | null {
  const path = pathTo(tree, id);
  if (!tree || !path || path.length === 0) return null;
  const parent = path.slice(0, -1);
  const split = nodeAt(tree, parent);
  return split && isSplit(split) ? { split, path: parent } : null;
}

/** The tree with the node at `path` replaced. */
function replaceAt(tree: Tile, path: readonly number[], next: Tile): Tile {
  if (path.length === 0) return next;
  if (!isSplit(tree)) return tree;
  const [i, ...rest] = path as [number, ...number[]];
  return { ...tree, children: tree.children.map((child, index) => (index === i ? replaceAt(child, rest, next) : child)) };
}

/**
 * The split that holds the pane showing `id` turns the other way (side by side becomes stacked, and back),
 * its children keeping their sizes. It may then join the split above it, which has that direction. A lone
 * pane has no split to turn.
 */
export function flipDirection(tree: Tile, id: string): Tile {
  const parent = parentSplit(tree, id);
  if (!parent) return tree;
  return normalize(replaceAt(tree, parent.path, { ...parent.split, direction: otherDirection(parent.split.direction) })) ?? tree;
}

/** The split at `path` with these sizes (made into shares); anything that isn't a split there changes nothing. */
export function setSizes(tree: Tile, path: readonly number[], sizes: readonly number[]): Tile {
  const node = nodeAt(tree, path);
  if (!node || !isSplit(node)) return tree;
  return replaceAt(tree, path, { ...node, sizes: toShares(sizes, node.children.length) });
}

/** Every child of the split at `path` gets the same share: what double-clicking a divider does. */
export function equalize(tree: Tile, path: readonly number[]): Tile {
  const node = nodeAt(tree, path);
  if (!node || !isSplit(node)) return tree;
  return setSizes(tree, path, equalSizes(node.children.length));
}

/** The next session in reading order after `id`, wrapping round (`step` -1: the one before); null with fewer than two panes. */
export function cycleLeaf(tree: Tile | null, id: string, step: 1 | -1 = 1): string | null {
  const ids = leafIds(tree);
  const at = ids.indexOf(id);
  if (ids.length < 2 || at === -1) return null;
  return ids[(at + step + ids.length) % ids.length]!;
}
