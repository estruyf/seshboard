/**
 * Claude's inline visuals: in the Claude desktop app, Claude can put a diagram, a mockup or a widget with sliders and
 * buttons in its reply through the `visualize` tools. The transcript has them as ordinary tool calls: `read_me` calls
 * (setup, nothing to show) and a `show_widget` call whose input holds the HTML or SVG. Plain TypeScript, for the
 * engine, main and the renderer.
 */

/** The call that holds a visual: `{ widget_code, title, loading_messages }`. */
export const VISUAL_TOOL = 'mcp__visualize__show_widget';

/** Setup before a visual: it stays a step. */
export const VISUAL_GUIDE_TOOL = 'mcp__visualize__read_me';

/**
 * The scheme main serves a visual's frame page from. A page of its own rather than a `srcdoc`, which would inherit the
 * app's Content-Security-Policy and run no script; the frame page has its own, which allows inline scripts and the CDNs.
 * The renderer's policy lets frames load it (`frame-src` in `apps/desktop/electron.vite.config.ts`).
 */
export const VISUAL_SCHEME = 'seshboard-visual';

/** The frame page every visual loads; the code comes after, by `postMessage`. */
export const VISUAL_FRAME_URL = `${VISUAL_SCHEME}://frame/`;

/** Where a visual may load scripts, styles and fonts from, as the desktop app allows. */
export const VISUAL_CDNS = ['https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net', 'https://unpkg.com', 'https://esm.sh'] as const;
