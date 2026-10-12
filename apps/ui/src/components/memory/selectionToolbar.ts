/** A box on screen, as `getBoundingClientRect()` and `getClientRects()` give them. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Between the toolbar and the selected line, and between the toolbar and the transcript's edges. */
export const TOOLBAR_GAP = 8;
export const TOOLBAR_MARGIN = 8;

const union = (rects: readonly Rect[]): Rect => ({
  left: Math.min(...rects.map((r) => r.left)),
  top: Math.min(...rects.map((r) => r.top)),
  right: Math.max(...rects.map((r) => r.right)),
  bottom: Math.max(...rects.map((r) => r.bottom)),
});

/** The rects on the same line as `line`: they cross its middle. */
const onLineOf = (rects: readonly Rect[], line: Rect) => {
  const middle = (line.top + line.bottom) / 2;
  return union(rects.filter((r) => r.top <= middle && r.bottom >= middle));
};

/**
 * The selected part of the first and the last line, from a range's `getClientRects()`. A range also gives the
 * whole box of each element it covers entirely (a list item, a paragraph); those are taller than a line and are
 * left out, so the toolbar sits by the text where the selection starts rather than by a block's corner.
 */
export function selectionLines(rects: readonly Rect[]): { first: Rect; last: Rect } | null {
  const boxes = rects.filter((r) => r.right > r.left && r.bottom > r.top);
  if (boxes.length === 0) return null;
  const lineHeight = Math.min(...boxes.map((r) => r.bottom - r.top));
  const lines = boxes.filter((r) => r.bottom - r.top <= lineHeight * 1.8);
  const pool = lines.length ? lines : boxes;
  const top = pool.reduce((a, b) => (b.top < a.top ? b : a));
  const bottom = pool.reduce((a, b) => (b.bottom > a.bottom ? b : a));
  return { first: onLineOf(pool, top), last: onLineOf(pool, bottom) };
}

/**
 * Where the selection toolbar goes: above the first selected line with a gap, centred on its selected part and
 * kept inside the transcript's edges. Without room above (the top of the scroll area, under the header) it goes
 * under the last selected line instead. Either way it never covers the selection.
 */
export function placeToolbar({ first, last, bounds, width, height }: { first: Rect; last: Rect; bounds: Rect; width: number; height: number }): { left: number; top: number; side: 'above' | 'below' } {
  const centre = (first.left + first.right) / 2;
  const min = bounds.left + TOOLBAR_MARGIN;
  const max = bounds.right - TOOLBAR_MARGIN - width;
  const left = Math.round(Math.max(min, Math.min(centre - width / 2, max)));
  const above = first.top - TOOLBAR_GAP - height;
  if (above >= bounds.top) return { left, top: Math.round(above), side: 'above' };
  return { left, top: Math.round(last.bottom + TOOLBAR_GAP), side: 'below' };
}
