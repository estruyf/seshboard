/** The part of a canvas this needs, so tests can pass a stand-in. */
export interface CanvasLike {
  getContext(kind: 'webgl2'): { getExtension(name: 'WEBGL_lose_context'): { loseContext(): void } | null } | null;
}

/**
 * Frees the WebGL contexts of a terminal's canvases now, instead of when they are garbage collected.
 * The WebGL addon (0.19) disposes its renderer without losing the context, and Chromium keeps only so
 * many alive (16): toggling the terminal fast went past that ("Too many active WebGL contexts").
 *
 * `getContext('webgl2')` on a canvas that already has one returns that same context; on the addon's 2D
 * canvases it returns null, and they are skipped. Returns how many contexts were let go.
 */
export function releaseWebglContexts(canvases: Iterable<CanvasLike>): number {
  let released = 0;
  for (const canvas of canvases) {
    try {
      const lose = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context');
      if (!lose) continue;
      lose.loseContext();
      released++;
    } catch {
      // Already lost, or not a WebGL canvas: nothing to free.
    }
  }
  return released;
}
