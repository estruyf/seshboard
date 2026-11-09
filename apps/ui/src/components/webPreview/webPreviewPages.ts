import { create } from 'zustand';
import { WEB_PREVIEW_PARTITION } from '@seshboard/protocol/client';
import { useWebPreview } from '../../state/webPreviewStore.ts';

/*
 * The web previews' pages, one `<webview>` per session, kept at the end of the window's body rather than in the
 * session's panel: the session view unmounts when you switch to another session, and Electron drops a `<webview>`'s
 * page when it is removed or moved. Each page is drawn over its panel's slot (`registerSlot`), in fixed position, and
 * parked off screen while the slot isn't on show (another tab in front, another session, a hidden pane).
 */

/** The slice of Electron's `<webview>` element the pages use. Its methods throw until the page is attached. */
interface WebviewElement extends HTMLElement {
  loadURL(url: string): Promise<void>;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  getWebContentsId(): number;
}

/** A failed load: where, and Chromium's words for why. */
export interface LoadFailure {
  url: string;
  description: string;
}

/** What a session's page is doing, for its panel's toolbar. */
export interface PageState {
  loading: boolean;
  back: boolean;
  forward: boolean;
  failure: LoadFailure | null;
}

const IDLE: PageState = { loading: false, back: false, forward: false, failure: null };

/** Chromium's code for a load that something else cut short (a new navigation): not a failure. */
const ERR_ABORTED = -3;

/** Where a page goes while its slot isn't on show: still running, out of sight. */
const PARKED = { left: '-100000px', top: '0px', width: '800px', height: '600px' };

export const usePreviewPages = create<{ pages: ReadonlyMap<string, PageState> }>()(() => ({ pages: new Map() }));

/** A session's page as its toolbar shows it. */
export function usePageState(sessionId: string): PageState {
  return usePreviewPages((s) => s.pages.get(sessionId)) ?? IDLE;
}

const setState = (sessionId: string, change: Partial<PageState>) =>
  usePreviewPages.setState((s) => ({ pages: new Map(s.pages).set(sessionId, { ...(s.pages.get(sessionId) ?? IDLE), ...change }) }));

class PreviewPage {
  readonly element: WebviewElement;
  ready = false;
  /** The `seq` of the address it was last asked to load (`SessionWeb.seq`). */
  loaded = -1;
  private readonly off: Array<() => void> = [];

  constructor(
    private readonly sessionId: string,
    host: HTMLElement,
  ) {
    const element = document.createElement('webview') as WebviewElement;
    // The partition and popups before the first address, which attaches it. Main's handler decides where a new window
    // goes (here or the browser); without `allowpopups` the page's links that open one would do nothing.
    element.setAttribute('partition', WEB_PREVIEW_PARTITION);
    element.setAttribute('allowpopups', '');
    element.dataset.webPreviewPage = sessionId;
    // White under the page whatever the theme, as a browser draws it: a page without a background of its own expects that.
    Object.assign(element.style, { position: 'fixed', background: 'white', ...PARKED });
    const on = (name: string, listener: (event: Event & Record<string, unknown>) => void) => {
      element.addEventListener(name, listener as EventListener);
      this.off.push(() => element.removeEventListener(name, listener as EventListener));
    };
    const navigated = (event: Event & Record<string, unknown>) => {
      if (event.isMainFrame === false) return;
      useWebPreview.getState().shown(sessionId, event.url as string);
      this.sync();
    };
    on('dom-ready', () => {
      this.ready = true;
      this.sync();
    });
    on('did-start-loading', () => setState(sessionId, { loading: true }));
    on('did-stop-loading', () => {
      setState(sessionId, { loading: false });
      this.sync();
    });
    on('did-navigate', navigated);
    on('did-navigate-in-page', navigated);
    on('did-start-navigation', (event) => {
      if (event.isMainFrame && !event.isSameDocument) setState(sessionId, { failure: null });
    });
    on('did-fail-load', (event) => {
      if (!event.isMainFrame || event.errorCode === ERR_ABORTED) return;
      setState(sessionId, { failure: { url: event.validatedURL as string, description: event.errorDescription as string } });
    });
    host.appendChild(element);
    this.element = element;
  }

  private sync() {
    try {
      setState(this.sessionId, { back: this.element.canGoBack(), forward: this.element.canGoForward() });
    } catch {
      // Not attached yet.
    }
  }

  private call(run: (element: WebviewElement) => void) {
    if (!this.ready) return;
    try {
      run(this.element);
    } catch {
      // Not attached yet.
    }
  }

  load(url: string) {
    setState(this.sessionId, { failure: null });
    if (!this.ready) this.element.setAttribute('src', url);
    else void this.element.loadURL(url).catch(() => {}); // A failure shows through did-fail-load.
  }

  reload(url: string | null) {
    setState(this.sessionId, { failure: null });
    if (this.ready) this.call((e) => e.reload());
    else if (url) this.load(url);
  }

  stop = () => this.call((e) => e.stop());
  back = () => this.call((e) => e.goBack());
  forward = () => this.call((e) => e.goForward());

  /** Its `<webview>`'s contents id, or null before it is attached. */
  contentsId(): number | null {
    if (!this.ready) return null;
    try {
      return this.element.getWebContentsId();
    } catch {
      return null;
    }
  }

  /** Over `rect`, or parked off screen with null. */
  place(rect: DOMRect | null) {
    const next = rect ? { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` } : PARKED;
    const style = this.element.style;
    if (style.left !== next.left || style.top !== next.top || style.width !== next.width || style.height !== next.height) Object.assign(style, next);
  }

  /** While the panel is resized: the page would take the pointer as it crosses it. */
  setPointer(on: boolean) {
    this.element.style.pointerEvents = on ? '' : 'none';
  }

  destroy() {
    this.off.splice(0).forEach((off) => off());
    this.element.remove();
    usePreviewPages.setState((s) => {
      const pages = new Map(s.pages);
      pages.delete(this.sessionId);
      return { pages };
    });
  }
}

const pages = new Map<string, PreviewPage>();
const slots = new Map<string, HTMLElement>();
let host: HTMLElement | null = null;
/** A slot or its session view changing size (a drag, the sidebar folding) moves the page with it. */
let resized: ResizeObserver | null = null;
/** A look now and then, for a move nothing reports (a pane swapped, a view scrolled): only while there are pages. */
let fallback: ReturnType<typeof setInterval> | undefined;
const FALLBACK_MS = 400;

/** A session's page, once the host made it. */
export const previewPage = (sessionId: string): PreviewPage | undefined => pages.get(sessionId);

/** Makes or drops pages so there is one per session in `wanted`. */
export function keepPages(wanted: ReadonlySet<string>): void {
  if (!host) {
    host = document.createElement('div');
    host.dataset.webPreviewHost = '';
    document.body.appendChild(host);
  }
  for (const [sessionId, page] of pages) {
    if (wanted.has(sessionId)) continue;
    page.destroy();
    pages.delete(sessionId);
  }
  for (const sessionId of wanted) if (!pages.has(sessionId)) pages.set(sessionId, new PreviewPage(sessionId, host));
  if (pages.size > 0) fallback ??= setInterval(placePages, FALLBACK_MS);
  else {
    clearInterval(fallback);
    fallback = undefined;
  }
  placePages();
}

/** The panel's slot for a session's page; null as it goes. The page is drawn over it while it is on show. */
export function registerSlot(sessionId: string, slot: HTMLElement | null): void {
  resized ??= new ResizeObserver(() => placePages());
  const before = slots.get(sessionId);
  if (before && before !== slot) {
    resized.unobserve(before);
    const view = before.closest('[data-current-session]');
    if (view) resized.unobserve(view);
  }
  if (slot) {
    slots.set(sessionId, slot);
    resized.observe(slot);
    const view = slot.closest('[data-current-session]');
    if (view) resized.observe(view);
  } else slots.delete(sessionId);
  placePages();
}

/** Where a slot is on screen, or null when it isn't (hidden, covered by the panel's own notice, or off screen). */
function slotRect(slot: HTMLElement | undefined): DOMRect | null {
  if (!slot?.isConnected || slot.dataset.covered !== undefined || !slot.checkVisibility({ visibilityProperty: true })) return null;
  const rect = slot.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < window.innerWidth ? rect : null;
}

/** Puts every page over its slot, or parks it. */
export function placePages(): void {
  for (const [sessionId, page] of pages) page.place(slotRect(slots.get(sessionId)));
}
