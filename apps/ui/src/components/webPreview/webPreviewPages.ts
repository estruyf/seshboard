import { create } from 'zustand';
import { WEB_PREVIEW_PARTITION } from '@seshboard/protocol/client';
import { useWebPreview } from '../../state/webPreviewStore.ts';
import { nextZoom } from './browserTabs.ts';
import { crashReloadDelay } from './crashRecovery.ts';

/*
 * The web previews' pages, one `<webview>` per browser tab (`browserTabs.ts`), kept at the end of the window's body
 * rather than in the panel: the session view unmounts when you switch to another session, and Electron drops a
 * `<webview>`'s page when it is removed or moved. Each page is drawn over its panel's slot (`registerSlot`), in fixed
 * position, and parked off screen while the slot isn't on show (another tab in front, another session, a hidden pane).
 * Pages are keyed by tab id; the host keeps only the ones shown most recently (`livePages`). Why `<webview>` and not
 * `WebContentsView`, the workarounds that needs and when to move: docs/browser.md.
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
  openDevTools(): void;
  closeDevTools(): void;
  isDevToolsOpened(): boolean;
  setZoomFactor(factor: number): void;
  isLoadingMainFrame(): boolean;
  setAudioMuted(muted: boolean): void;
  findInPage(text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }): number;
  stopFindInPage(action: 'clearSelection' | 'keepSelection' | 'activateSelection'): void;
}

/** A failed load: where, and Chromium's words for why. */
export interface LoadFailure {
  url: string;
  description: string;
}

/** What a tab's page is doing, for its panel's toolbar. */
export interface PageState {
  loading: boolean;
  back: boolean;
  forward: boolean;
  failure: LoadFailure | null;
  /** The page's process went (`render-process-gone`): it shows nothing until it is reloaded. */
  crashed: boolean;
  /** Find in page: its bar is open, the matches of what was typed (null before a result), and a count that asks for the field's focus. */
  find: { open: boolean; matches: number; active: number; focus: number };
}

const IDLE: PageState = { loading: false, back: false, forward: false, failure: null, crashed: false, find: { open: false, matches: 0, active: 0, focus: 0 } };

/** Chromium's code for a load that something else cut short (a new navigation): not a failure. */
const ERR_ABORTED = -3;

/**
 * A page's title, and its address as it moves within the page, reach the store at most this often: a page that ticks
 * (a timer in the title, an address rewritten as you scroll) would redraw the tab list and the toolbar every time.
 */
const NOTE_MS = 300;

/** Calls `run` with the latest value at most once per `ms`, the last value always arriving. */
function throttled<T>(ms: number, run: (value: T) => void): { push(value: T): void; cancel(): void } {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { value: T } | null = null;
  const flush = () => {
    timer = undefined;
    if (!pending) return;
    last = Date.now();
    const { value } = pending;
    pending = null;
    run(value);
  };
  return {
    push(value) {
      pending = { value };
      if (timer) return;
      const wait = ms - (Date.now() - last);
      if (wait <= 0) flush();
      else timer = setTimeout(flush, wait);
    },
    cancel() {
      clearTimeout(timer);
      pending = null;
    },
  };
}

/** Where a page goes while its slot isn't on show: still running, out of sight. */
const PARKED = { left: '-100000px', top: '0px', width: '800px', height: '600px' };

export const usePreviewPages = create<{ pages: ReadonlyMap<string, PageState> }>()(() => ({ pages: new Map() }));

/** A tab's page as its toolbar shows it. */
export function usePageState(tabId: string | null): PageState {
  return usePreviewPages((s) => (tabId ? s.pages.get(tabId) : undefined)) ?? IDLE;
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
    const tab = useWebPreview.getState().tabs.find((t) => t.id === sessionId);
    if (tab) element.dataset.webPreviewOwner = tab.owner;
    // White under the page whatever the theme, as a browser draws it: a page without a background of its own expects that.
    Object.assign(element.style, { position: 'fixed', background: 'white', ...PARKED });
    const on = (name: string, listener: (event: Event & Record<string, unknown>) => void) => {
      element.addEventListener(name, listener as EventListener);
      this.off.push(() => element.removeEventListener(name, listener as EventListener));
    };
    const title = throttled<string>(NOTE_MS, (text) => useWebPreview.getState().titled(sessionId, text));
    const address = throttled<string>(NOTE_MS, (url) => {
      useWebPreview.getState().shown(sessionId, url);
      this.sync();
    });
    this.off.push(title.cancel, address.cancel);
    const navigated = (event: Event & Record<string, unknown>) => {
      if (event.isMainFrame === false) return;
      address.push(event.url as string);
    };
    on('page-title-updated', (event) => title.push(String(event.title ?? '')));
    // The icon comes from main, fetched in the page's partition (`WebPreviewHost`, `favicon`).
    // A stopped page loads again by itself a few times (`crashReloadDelay`); past that it shows its notice.
    on('render-process-gone', () => {
      const now = Date.now();
      const delay = crashReloadDelay(this.crashes, now);
      this.crashes = [...this.crashes.filter((at) => now - at < 30_000), now];
      if (delay === null) return setState(sessionId, { crashed: true, loading: false });
      setState(sessionId, { loading: true });
      clearTimeout(this.restart);
      this.restart = setTimeout(() => this.reload(this.tab()?.url ?? null), delay);
    });
    // A click in the page gives the <webview> the focus but no mouse event: the app's menus and popovers close on one.
    on('focus', () => {
      element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    // A page that closes itself (a sign-in popup, opened as a tab, once the provider is done) closes its tab.
    on('close', () => useWebPreview.getState().closeTab(sessionId));
    on('dom-ready', () => {
      this.ready = true;
      this.sync();
      // The tab's zoom and mute, on each new document: Chromium keeps zoom per site, the tab keeps its own.
      this.applyTab();
    });
    // Loading is the page's own document: an iframe that loads late doesn't keep the line going.
    on('did-start-loading', () => setState(sessionId, { loading: this.mainFrameLoading() }));
    on('did-stop-loading', () => {
      setState(sessionId, { loading: false });
      this.sync();
    });
    on('did-navigate', navigated);
    on('did-navigate-in-page', navigated);
    on('did-start-navigation', (event) => {
      if (event.isMainFrame && !event.isSameDocument) setState(sessionId, { failure: null, ...this.findCleared() });
    });
    // Chromium reports the count as it finds; the last report of a search is final.
    on('found-in-page', (event) => {
      const result = event.result as { matches: number; activeMatchOrdinal: number } | undefined;
      if (!result) return;
      const find = this.findState();
      setState(sessionId, { find: { ...find, matches: result.matches, active: result.activeMatchOrdinal } });
    });
    on('did-fail-load', (event) => {
      if (!event.isMainFrame || event.errorCode === ERR_ABORTED) return;
      setState(sessionId, { failure: { url: event.validatedURL as string, description: event.errorDescription as string } });
    });
    host.appendChild(element);
    this.element = element;
  }

  /** When it stopped lately (`render-process-gone`), for `crashReloadDelay`. */
  private crashes: number[] = [];
  private restart: ReturnType<typeof setTimeout> | undefined;

  private tab() {
    return useWebPreview.getState().tabs.find((t) => t.id === this.sessionId);
  }

  private mainFrameLoading(): boolean {
    try {
      return this.element.isLoadingMainFrame();
    } catch {
      return true;
    }
  }

  /** The tab's zoom and mute on the page now showing. */
  applyTab() {
    const tab = this.tab();
    if (!tab) return;
    this.call((e) => {
      e.setZoomFactor(tab.zoom);
      e.setAudioMuted(tab.muted);
    });
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
    setState(this.sessionId, { failure: null, crashed: false });
    if (!this.ready) this.element.setAttribute('src', url);
    else void this.element.loadURL(url).catch(() => {}); // A failure shows through did-fail-load.
  }

  reload(url: string | null) {
    setState(this.sessionId, { failure: null, crashed: false });
    if (this.ready) this.call((e) => e.reload());
    else if (url) this.load(url);
  }

  stop = () => this.call((e) => e.stop());
  /** The page's developer tools, in a window of their own; again closes them. */
  devTools = () => this.call((e) => (e.isDevToolsOpened() ? e.closeDevTools() : e.openDevTools()));
  /** Zooms the page a step in (1) or out (-1) through Chrome's levels, or back to 100% (0), and keeps it with the tab. */
  zoom = (step: 1 | -1 | 0) => {
    const tab = this.tab();
    if (!tab) return;
    useWebPreview.getState().zoomTo(tab.id, nextZoom(tab.zoom, step));
    this.applyTab();
  };
  /** Mutes the page, or lets it play sound again, and keeps that with the tab. */
  mute = (muted: boolean) => {
    useWebPreview.getState().setMuted(this.sessionId, muted);
    this.applyTab();
  };
  private findState() {
    return usePreviewPages.getState().pages.get(this.sessionId)?.find ?? IDLE.find;
  }

  /** A navigation drops Chromium's matches; the bar stays open, empty of results. */
  private findCleared(): Pick<PageState, 'find'> {
    return { find: { ...this.findState(), matches: 0, active: 0 } };
  }

  /** Opens the find bar, or gives its field the focus again when it is open. */
  openFind = () => {
    const find = this.findState();
    setState(this.sessionId, { find: { ...find, open: true, focus: find.focus + 1 } });
  };

  /** Looks for `text` (a new word from the first match; the same word, `step` moves to the next or previous); an empty one clears. */
  find = (text: string, step: 'new' | 'next' | 'previous' = 'new') => {
    if (!text) return this.clearFind();
    this.call((e) => {
      e.findInPage(text, { forward: step !== 'previous', findNext: step !== 'new' });
    });
  };

  private clearFind() {
    this.call((e) => e.stopFindInPage('clearSelection'));
    setState(this.sessionId, this.findCleared());
  }

  /** Closes the find bar and clears the highlights; the page takes the keyboard back. */
  closeFind = () => {
    this.clearFind();
    setState(this.sessionId, { find: { ...this.findState(), open: false } });
    this.call((e) => e.focus());
  };

  back = () => this.call((e) => e.goBack());
  forward = () => this.call((e) => e.goForward());

  /**
   * Its `<webview>`'s contents id, or null before it is attached. Not only once `ready`: main sends a page's icon as
   * soon as the page declares it, often before `dom-ready` on a large page, and the icon would find no tab.
   */
  contentsId(): number | null {
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
    clearTimeout(this.restart);
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

/** A tab's page, once the host made it. */
export const previewPage = (tabId: string): PreviewPage | undefined => pages.get(tabId);

/** The tab whose page has this contents id (the main process names pages by it). */
export function tabOfContents(contentsId: number): string | undefined {
  for (const [tabId, page] of pages) if (page.contentsId() === contentsId) return tabId;
  return undefined;
}

/** Makes or drops pages so there is one per tab in `wanted`. */
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
