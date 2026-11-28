/*
 * The canvases' pages (docs/canvases.md), one `<webview>` per session and canvas, kept at the end of the window's body
 * rather than in the panel, as the browser's pages are (`webPreviewPages.ts`): Electron drops a `<webview>`'s page when
 * it is removed, and the panel is removed whenever another panel or session comes to the front. Each page is drawn over
 * its panel's slot, in fixed position, and parked off screen while the slot isn't on show. So what you typed in a
 * canvas is still there when you come back to it.
 */

/** The slice of Electron's `<webview>` the pages use. */
export interface CanvasWebview extends HTMLElement {
  reload(): void;
}

interface CanvasPage {
  element: CanvasWebview;
  url: string;
  partition: string;
  slot: HTMLElement | null;
  frame: number | null;
  /** When it was last on show: the pages kept are the ones shown most recently. */
  shownAt: number;
}

/** Where a page goes while its slot isn't on show: still running, out of sight. */
const PARKED = { left: '-100000px', top: '0px', width: '800px', height: '600px' };
/** At most this many pages stay alive in a window; the one shown longest ago goes first. */
export const CANVAS_PAGES_KEPT = 6;

const pages = new Map<string, CanvasPage>();

/** A page's key: the session that shows it and the canvas. */
export const canvasPageKey = (sessionId: string, canvasId: string): string => `${sessionId}\n${canvasId}`;

/** Which pages go when there are more than `kept`: the parked ones shown longest ago. Pure, for its test. */
export function pagesToDrop(all: ReadonlyArray<{ key: string; shown: boolean; shownAt: number }>, kept = CANVAS_PAGES_KEPT): string[] {
  const over = all.length - kept;
  if (over <= 0) return [];
  return all
    .filter((page) => !page.shown)
    .sort((a, b) => a.shownAt - b.shownAt)
    .slice(0, over)
    .map((page) => page.key);
}

function place(page: CanvasPage): void {
  const slot = page.slot;
  const rect = slot?.isConnected && slot.checkVisibility({ visibilityProperty: true }) ? slot.getBoundingClientRect() : null;
  const next = rect && rect.width > 0 && rect.height > 0 ? { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` } : PARKED;
  const style = page.element.style;
  if (style.left !== next.left || style.top !== next.top || style.width !== next.width || style.height !== next.height) Object.assign(style, next);
}

/** Follows the slot while it is on show: a dragged panel edge, the log opening under the page, a resized window. */
function follow(page: CanvasPage): void {
  if (page.frame !== null) cancelAnimationFrame(page.frame);
  const step = () => {
    place(page);
    page.frame = page.slot ? requestAnimationFrame(step) : null;
  };
  step();
}

/**
 * Shows the canvas's page over `slot`, making it when there is none (or when the canvas now serves another address).
 * Returns what to call when the slot goes: the page is parked, not dropped.
 */
export function showCanvasPage(key: string, canvasId: string, url: string, partition: string, slot: HTMLElement): () => void {
  let page = pages.get(key);
  if (page && (page.url !== url || page.partition !== partition)) {
    dropCanvasPage(key);
    page = undefined;
  }
  if (!page) {
    const element = document.createElement('webview') as CanvasWebview;
    // The partition before the address, which attaches it. Main checks both (`webviewAllowed`).
    element.setAttribute('partition', partition);
    element.setAttribute('src', url);
    element.dataset.canvasPage = canvasId;
    // White under the page whatever the theme, as a browser draws it: a page without a background of its own expects that.
    Object.assign(element.style, { position: 'fixed', background: 'white', ...PARKED });
    document.body.append(element);
    page = { element, url, partition, slot: null, frame: null, shownAt: 0 };
    pages.set(key, page);
  }
  const shown = page;
  shown.slot = slot;
  shown.shownAt = Date.now();
  follow(shown);
  for (const old of pagesToDrop([...pages].map(([k, p]) => ({ key: k, shown: p.slot !== null, shownAt: p.shownAt })))) dropCanvasPage(old);
  return () => {
    if (shown.slot !== slot) return;
    shown.slot = null;
    place(shown);
  };
}

export const canvasPageElement = (key: string): CanvasWebview | null => pages.get(key)?.element ?? null;

/** Removes a page: its canvas closed, stopped or changed. */
export function dropCanvasPage(key: string): void {
  const page = pages.get(key);
  if (!page) return;
  if (page.frame !== null) cancelAnimationFrame(page.frame);
  page.slot = null;
  page.element.remove();
  pages.delete(key);
}

/** Removes the pages of canvases no session has open any more. */
export function keepCanvasPages(open: ReadonlySet<string>): void {
  for (const key of [...pages.keys()]) if (!open.has(key)) dropCanvasPage(key);
}
