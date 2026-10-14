// Where the panes and dividers of a layout tree (`tiling.ts`) go, what fits in a window, and the geometry of
// dragging: which pane and which part of it the pointer is over. Pure functions, unit tested next to this file.

import { isSplit, leafIds, nodeAt, setSizes, splitLeaf, type Direction, type Side, type Tile, type Zone } from './tiling.ts';

/** A pane is never narrower than this: the header with its buttons, and a message box with Send. */
export const MIN_PANE_WIDTH = 340;
/** A pane is never shorter than this: its header, a message box with its chips and a few lines of the conversation above it. */
export const MIN_PANE_HEIGHT = 340;
/** How far one arrow key moves a divider. */
export const DIVIDER_KEY_STEP = 24;
/** A divider dragged this close to the middle of the two panes it sits between lands exactly there. */
export const DIVIDER_SNAP = 12;

export interface Size {
  width: number;
  height: number;
}
/** A rectangle in the units of its area: fractions of it (0 to 1) in a layout, pixels in a drag. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface PaneBox {
  id: string;
  box: Box;
}
export interface DividerBox {
  /** The split this divider belongs to (child indexes from the root) and its place between children `index` and `index + 1`. */
  path: number[];
  index: number;
  direction: Direction;
  /** The whole split, and the divider's position inside it (0 to 1 along its direction): the two panes' shared edge. */
  split: Box;
  boundary: number;
  /** The divider as a line: no width for a vertical one (a row splits left to right), no height for a horizontal one. */
  line: Box;
}
export interface TileLayout {
  panes: PaneBox[];
  dividers: DividerBox[];
}

const WHOLE: Box = { x: 0, y: 0, w: 1, h: 1 };

/** Every pane's rectangle and every divider, as fractions of the area the tree fills. */
export function computeLayout(tree: Tile | null): TileLayout {
  const panes: PaneBox[] = [];
  const dividers: DividerBox[] = [];
  const walk = (tile: Tile, box: Box, path: number[]) => {
    if (!isSplit(tile)) {
      panes.push({ id: tile.id, box });
      return;
    }
    const row = tile.direction === 'row';
    let offset = 0;
    tile.children.forEach((child, i) => {
      const share = tile.sizes[i]!;
      walk(child, row ? { x: box.x + offset * box.w, y: box.y, w: share * box.w, h: box.h } : { x: box.x, y: box.y + offset * box.h, w: box.w, h: share * box.h }, [...path, i]);
      offset += share;
      if (i < tile.children.length - 1) {
        dividers.push({
          path,
          index: i,
          direction: tile.direction,
          split: box,
          boundary: offset,
          line: row ? { x: box.x + offset * box.w, y: box.y, w: 0, h: box.h } : { x: box.x, y: box.y + offset * box.h, w: box.w, h: 0 },
        });
      }
    });
  };
  if (tree) walk(tree, WHOLE, []);
  return { panes, dividers };
}

/** The least room a tree needs: every pane at its minimum, side by side or stacked as the tree says. */
export function minSize(tree: Tile, min: Size = { width: MIN_PANE_WIDTH, height: MIN_PANE_HEIGHT }): Size {
  if (!isSplit(tree)) return min;
  const sizes = tree.children.map((child) => minSize(child, min));
  return tree.direction === 'row'
    ? { width: sizes.reduce((sum, s) => sum + s.width, 0), height: Math.max(...sizes.map((s) => s.height)) }
    : { width: Math.max(...sizes.map((s) => s.width)), height: sizes.reduce((sum, s) => sum + s.height, 0) };
}

/** Every pane has its minimum size in an area this big. Not measured yet (null): assumed to. */
export function fits(tree: Tile, area: Size | null): boolean {
  if (!area) return true;
  const need = minSize(tree);
  return need.width <= area.width && need.height <= area.height;
}

/**
 * Shares for children that must each keep `minsPx` of a split `extent` long: any share under its minimum is
 * raised to it, and the others give up the difference in proportion. When the minimums don't fit at all the
 * shares follow the minimums.
 */
export function clampShares(sizes: readonly number[], extent: number, minsPx: readonly number[]): number[] {
  const n = sizes.length;
  if (!(extent > 0)) return [...sizes];
  const mins = minsPx.map((px) => px / extent);
  const needed = mins.reduce((sum, m) => sum + m, 0);
  if (needed >= 1) return mins.map((m) => m / needed);
  const out = [...sizes];
  const fixed = new Array<boolean>(n).fill(false);
  for (let round = 0; round <= n; round++) {
    let raised = false;
    for (let i = 0; i < n; i++) {
      if (!fixed[i] && out[i]! < mins[i]! - 1e-9) {
        out[i] = mins[i]!;
        fixed[i] = true;
        raised = true;
      }
    }
    if (!raised) break;
    const budget = 1 - out.reduce((sum, size, i) => sum + (fixed[i] ? size : 0), 0);
    const free = out.reduce((sum, size, i) => sum + (fixed[i] ? 0 : size), 0);
    for (let i = 0; i < n; i++) if (!fixed[i]) out[i] = free > 0 ? (out[i]! * budget) / free : budget / n;
  }
  return out;
}

/**
 * The tree as it shows in `area`: every split's sizes brought up to what its children's minimums need (a
 * window that shrank since the sizes were set). The saved sizes are not changed. Returns the same tree when
 * nothing needs to.
 */
export function constrain(tree: Tile, area: Size): Tile {
  const walk = (tile: Tile, box: Box): Tile => {
    if (!isSplit(tile)) return tile;
    const row = tile.direction === 'row';
    const extent = (row ? box.w * area.width : box.h * area.height) || 0;
    const mins = tile.children.map((child) => minSize(child)[row ? 'width' : 'height']);
    const sizes = clampShares(tile.sizes, extent, mins);
    let offset = 0;
    const children = tile.children.map((child, i) => {
      const childBox = row ? { x: box.x + offset * box.w, y: box.y, w: sizes[i]! * box.w, h: box.h } : { x: box.x, y: box.y + offset * box.h, w: box.w, h: sizes[i]! * box.h };
      offset += sizes[i]!;
      return walk(child, childBox);
    });
    const same = sizes.every((size, i) => Math.abs(size - tile.sizes[i]!) < 1e-9) && children.every((child, i) => child === tile.children[i]);
    return same ? tile : { ...tile, children, sizes };
  };
  return walk(tree, WHOLE);
}

/** The fractions of a pane's box as pixels in `area`. */
export const boxInArea = (box: Box, area: Size): Box => ({ x: box.x * area.width, y: box.y * area.height, w: box.w * area.width, h: box.h * area.height });

/**
 * Moves the divider after child `index` of the split at `path` so the two panes' shared edge is at `boundary`
 * (0 to 1 along the split). Only those two panes change, and neither goes under its minimum. `extentPx` is how
 * long the split is on screen, which the minimums are measured against.
 */
export function moveDivider(tree: Tile, path: readonly number[], index: number, boundary: number, extentPx: number): Tile {
  const node = nodeAt(tree, path);
  if (!node || !isSplit(node) || index < 0 || index >= node.children.length - 1 || !Number.isFinite(boundary)) return tree;
  const axis = node.direction === 'row' ? 'width' : 'height';
  const before = node.sizes.slice(0, index).reduce((sum, size) => sum + size, 0);
  const pair = node.sizes[index]! + node.sizes[index + 1]!;
  const minBefore = extentPx > 0 ? minSize(node.children[index]!)[axis] / extentPx : 0;
  const minAfter = extentPx > 0 ? minSize(node.children[index + 1]!)[axis] / extentPx : 0;
  const low = before + minBefore;
  const high = before + pair - minAfter;
  const edge = low > high ? before + pair / 2 : Math.min(Math.max(boundary, low), high);
  const sizes = [...node.sizes];
  sizes[index] = edge - before;
  sizes[index + 1] = pair - (edge - before);
  return setSizes(tree, path, sizes);
}

/** Where the divider's edge lands for a drag to `boundary`: exactly in the middle of its two panes when it is within `DIVIDER_SNAP` of it. */
export function snapBoundary(tree: Tile, path: readonly number[], index: number, boundary: number, extentPx: number): number {
  const node = nodeAt(tree, path);
  if (!node || !isSplit(node) || !(extentPx > 0)) return boundary;
  const before = node.sizes.slice(0, index).reduce((sum, size) => sum + size, 0);
  const middle = before + (node.sizes[index]! + node.sizes[index + 1]!) / 2;
  return Math.abs(boundary - middle) * extentPx <= DIVIDER_SNAP ? middle : boundary;
}

/** The divider's edge now, 0 to 1 along its split. */
export function boundaryOf(tree: Tile, path: readonly number[], index: number): number | null {
  const node = nodeAt(tree, path);
  if (!node || !isSplit(node) || index < 0 || index >= node.children.length - 1) return null;
  return node.sizes.slice(0, index + 1).reduce((sum, size) => sum + size, 0);
}

/**
 * What a key does to a divider: the pixels to move it (arrows along its direction: ← → for the divider between
 * side-by-side panes, ↑ ↓ for the one between stacked panes), `start` or `end` for Home and End (as far as the
 * minimums allow), or null for any other key.
 */
export function dividerKey(direction: Direction, key: string): number | 'start' | 'end' | null {
  if (key === 'Home') return 'start';
  if (key === 'End') return 'end';
  const [less, more] = direction === 'row' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
  return key === less ? -DIVIDER_KEY_STEP : key === more ? DIVIDER_KEY_STEP : null;
}

/** The divider after a key (see `dividerKey`); the tree itself when the key doesn't move it. */
export function moveDividerByKey(tree: Tile, path: readonly number[], index: number, key: string, extentPx: number): Tile {
  const node = nodeAt(tree, path);
  const move = node && isSplit(node) ? dividerKey(node.direction, key) : null;
  const now = boundaryOf(tree, path, index);
  if (move === null || now === null || !(extentPx > 0)) return tree;
  return moveDivider(tree, path, index, move === 'start' ? 0 : move === 'end' ? 1 : now + move / extentPx, extentPx);
}

export type Way = 'left' | 'right' | 'up' | 'down';

/**
 * The pane next to `id` in a direction: among those whose edge lies that way and that share some of its height
 * (or width), the nearest, and of those the one whose middle is closest to this pane's. Null at the edge.
 */
export function neighbour(tree: Tile | null, id: string, way: Way): string | null {
  const { panes } = computeLayout(tree);
  const here = panes.find((pane) => pane.id === id)?.box;
  if (!here) return null;
  const eps = 1e-6;
  const horizontal = way === 'left' || way === 'right';
  const overlap = (a: Box, b: Box) => (horizontal ? Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) : Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const gap = (b: Box) => (way === 'left' ? here.x - (b.x + b.w) : way === 'right' ? b.x - (here.x + here.w) : way === 'up' ? here.y - (b.y + b.h) : b.y - (here.y + here.h));
  const centre = (b: Box) => (horizontal ? b.y + b.h / 2 : b.x + b.w / 2);
  const candidates = panes.filter((pane) => pane.id !== id && gap(pane.box) > -eps && overlap(here, pane.box) > eps);
  candidates.sort((a, b) => gap(a.box) - gap(b.box) || Math.abs(centre(a.box) - centre(here)) - Math.abs(centre(b.box) - centre(here)));
  return candidates[0]?.id ?? null;
}

/** Which side a pane of this size splits towards for a new neighbour: a pane at least as wide as it is tall gets one beside it, a taller one gets one below. */
export const preferredSide = (size: Size): Side => (size.width >= size.height ? 'right' : 'bottom');
const otherSide = (side: Side): Side => (side === 'right' ? 'bottom' : 'right');

/**
 * Opens `newId` next to the pane showing `activeId`, in an `area` that may not be measured (null). The new pane
 * goes on the side that suits the active pane's shape (`preferredSide`); when the tree then wouldn't fit, the
 * other way is tried. Null when neither fits: the window has no room for another pane.
 */
export function planOpen(tree: Tile, activeId: string, newId: string, area: Size | null): { tree: Tile; side: Side } | null {
  const pane = area ? computeLayout(constrain(tree, area)).panes.find((p) => p.id === activeId) : null;
  const first: Side = pane && area ? preferredSide({ width: pane.box.w * area.width, height: pane.box.h * area.height }) : 'right';
  for (const side of [first, otherSide(first)]) {
    const next = splitLeaf(tree, activeId, newId, side);
    if (next !== tree && fits(next, area)) return { tree: next, side };
  }
  return null;
}

export interface Point {
  x: number;
  y: number;
}
/** A rectangle in pixels on screen. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** How far the pointer moves before a press on a pane's header becomes a drag, so a click is never one. */
export const DRAG_THRESHOLD = 6;

/** The press has moved far enough to be a drag. */
export const dragStarted = (from: Point, to: Point): boolean => Math.hypot(to.x - from.x, to.y - from.y) >= DRAG_THRESHOLD;

/** How much of each edge of a pane is that edge's drop zone; what is left in the middle is the centre. */
export const EDGE_ZONE = 0.25;

/** The part of a pane the point is over, or null outside it. A corner belongs to the edge it is nearest, in proportion to the pane's size. */
export function zoneAt(point: Point, rect: Rect): Zone | null {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  if (!(width > 0 && height > 0) || point.x < rect.left || point.x >= rect.right || point.y < rect.top || point.y >= rect.bottom) return null;
  const x = (point.x - rect.left) / width;
  const y = (point.y - rect.top) / height;
  const edges: Array<[Zone, number]> = [
    ['left', x],
    ['right', 1 - x],
    ['top', y],
    ['bottom', 1 - y],
  ];
  const [zone, distance] = edges.reduce((best, edge) => (edge[1] < best[1] ? edge : best));
  return distance < EDGE_ZONE ? zone : 'center';
}

/**
 * Where a drop lands: a part of a pane (an edge docks beside it, the centre swaps or replaces), or along a whole
 * edge of the layout, which docks as a new cell as long (or as tall) as the window.
 */
export type DropTarget = { kind: 'pane'; id: string; zone: Zone } | { kind: 'edge'; side: Side };

/** The band along each edge of the layout that docks across the whole window: this much of the length, but between ROOT_EDGE_MIN and ROOT_EDGE_MAX pixels and never more than a quarter. */
export const ROOT_EDGE_SHARE = 0.06;
export const ROOT_EDGE_MIN = 40;
export const ROOT_EDGE_MAX = 72;

/** How thick the window-edge band is along a side of `length` pixels. */
export const edgeBand = (length: number): number => Math.min(Math.max(length * ROOT_EDGE_SHARE, ROOT_EDGE_MIN), ROOT_EDGE_MAX, length / 4);

/**
 * The window-edge band the point is in, or null. In a corner it is the band the point is deepest in, in
 * proportion to its thickness (left and right win a tie, as zones in a pane do).
 */
export function edgeAt(point: Point, area: Rect): Side | null {
  const width = area.right - area.left;
  const height = area.bottom - area.top;
  if (!(width > 0 && height > 0) || point.x < area.left || point.x >= area.right || point.y < area.top || point.y >= area.bottom) return null;
  const bandX = edgeBand(width);
  const bandY = edgeBand(height);
  const depths: Array<[Side, number]> = [
    ['left', (point.x - area.left) / bandX],
    ['right', (area.right - point.x) / bandX],
    ['top', (point.y - area.top) / bandY],
    ['bottom', (area.bottom - point.y) / bandY],
  ];
  const [side, depth] = depths.reduce((best, d) => (d[1] < best[1] ? d : best));
  return depth < 1 ? side : null;
}

/**
 * What a point over the layout would drop on, ignoring the pane being dragged (`from`, null when a session comes
 * from the sidebar). The window-edge bands come first, over the zones of the panes in them; anything else is the
 * pane under the point and its zone. Panes tile the whole area, so everywhere in it is a target (except the
 * dragged pane's own middle).
 */
export function dropAt(from: string | null, point: Point, panes: ReadonlyArray<{ id: string; rect: Rect }>, area: Rect): DropTarget | null {
  const side = edgeAt(point, area);
  if (side) return { kind: 'edge', side };
  for (const pane of panes) {
    if (pane.id === from) continue;
    const zone = zoneAt(point, pane.rect);
    if (zone) return { kind: 'pane', id: pane.id, zone };
  }
  return null;
}

/** The ids of a tree's panes, as the DOM keeps them: in a fixed order whatever their place, so a move never moves an element. */
export const stableOrder = (tree: Tile | null): string[] => leafIds(tree).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
