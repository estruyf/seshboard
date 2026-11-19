/**
 * Zoom and pan of a diagram in its overlay, as maths on a view: the content is moved by (`x`, `y`) pixels from the top left
 * of the viewport, then scaled by `scale` (transform origin at its own top left). Pure, for testing.
 */
export interface DiagramView {
  scale: number;
  x: number;
  y: number;
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;
/** A step of the + and − buttons and keys. */
export const ZOOM_STEP = 1.25;

export const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

/** Zooms by `factor` keeping the point (`px`, `py`) of the viewport where it is, so the zoom goes where the pointer is. */
export function zoomAt(view: DiagramView, factor: number, px: number, py: number): DiagramView {
  const scale = clampScale(view.scale * factor);
  const real = scale / view.scale;
  return { scale, x: px - (px - view.x) * real, y: py - (py - view.y) * real };
}

/** The view that shows all of the content in the viewport, centred, with `margin` around it; never larger than `maxScale` (a tiny diagram isn't blown up). */
export function fitView(content: { width: number; height: number }, box: { width: number; height: number }, margin = 24, maxScale = 2): DiagramView {
  const scale = clampScale(Math.min(maxScale, Math.max(1, box.width - margin * 2) / content.width, Math.max(1, box.height - margin * 2) / content.height));
  return { scale, x: (box.width - content.width * scale) / 2, y: (box.height - content.height * scale) / 2 };
}

/** The content at its own size, centred. */
export function actualSize(content: { width: number; height: number }, box: { width: number; height: number }): DiagramView {
  return { scale: 1, x: (box.width - content.width) / 2, y: (box.height - content.height) / 2 };
}

export const panBy = (view: DiagramView, dx: number, dy: number): DiagramView => ({ ...view, x: view.x + dx, y: view.y + dy });

/**
 * The zoom factor of a wheel turn: a mouse wheel's notches (pixel deltas of about 100) and a trackpad's pinch (small deltas,
 * sent with ctrl) both come out as a smooth exponential.
 */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-Math.max(-200, Math.min(200, pixels)) * 0.0025);
}
