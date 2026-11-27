import { BROWSER_OWNER } from '../components/webPreview/browserTabs.ts';
import { previewPage } from '../components/webPreview/webPreviewPages.ts';
import { matches } from '../lib/shortcuts.ts';
import { bookmarkPage } from './browserBookmarksStore.ts';
import { currentPageTab, newBrowserTab, openBrowserView } from './browserViewStore.ts';
import { browserOwnerOf } from './remoteSelection.ts';
import { useSessions } from './sessionsStore.ts';
import { useWebPreview } from './webPreviewStore.ts';

/** Whose browser the keys work on: the Browser view's, a session's (with the element its address bar is in), or none. */
export interface BrowserKeyScope {
  /** The Browser view is on screen. */
  browserView: boolean;
  /** The session whose Browser panel the keys open and find their address bar in; null outside one. */
  sessionId: string | null;
  /** Where that session's address bar is (a selector); null for none. */
  root: string | null;
}

/** In the main window: the Browser view, or the session on screen (one on another computer too: its browser is here). */
export function mainBrowserScope(): BrowserKeyScope {
  const { view, selectedId } = useSessions.getState();
  const sessionId = view === 'session' ? browserOwnerOf(selectedId) : null;
  return { browserView: view === 'browser', sessionId, root: sessionId ? `[data-current-session="${CSS.escape(sessionId)}"]` : null };
}

/**
 * The browser's keys (the browser on): ⌘⇧B outside a session shows the Browser view (in one it toggles the
 * session's browser, `web.toggle`), ⌘T opens a tab, ⌘L goes to the address bar, and ⌘W closes the tab while its page
 * or address bar has focus (main hands both over as keys). True when the key was one of them and did something.
 */
export function browserKey(event: KeyboardEvent, scope: BrowserKeyScope): boolean {
  const { browserView, sessionId } = scope;
  if (matches(event, 'browser.view')) {
    if (sessionId) return false;
    openBrowserView();
    return true;
  }
  if (matches(event, 'browser.new-tab')) {
    if (browserView) newBrowserTab();
    else if (sessionId) {
      useWebPreview.getState().open(sessionId);
      if (useWebPreview.getState().tabs.find((t) => t.id === useWebPreview.getState().active.get(sessionId))?.url) useWebPreview.getState().openTab(sessionId, null);
    } else return false;
    return true;
  }
  if (matches(event, 'browser.address')) {
    const root = browserView ? '[data-browser-view]' : scope.root;
    const field = root ? document.querySelector<HTMLInputElement>(`${root} [data-browser-address]`) : null;
    if (!field || field.disabled) return false;
    field.focus();
    field.select();
    return true;
  }
  if (matches(event, 'browser.close-tab')) {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const tabId = target?.dataset.webPreviewPage ?? target?.closest<HTMLElement>('[data-browser-address]')?.dataset.tabId;
    if (!tabId) return false;
    useWebPreview.getState().askClose(tabId);
    if (browserView && !useWebPreview.getState().active.get(BROWSER_OWNER)) document.querySelector<HTMLElement>('[data-browser-view]')?.focus();
    return true;
  }
  if (matches(event, 'browser.bookmark')) {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const tabId = target?.dataset.webPreviewPage ?? target?.closest<HTMLElement>('[data-browser-address]')?.dataset.tabId;
    const tab = tabId ? useWebPreview.getState().tabs.find((t) => t.id === tabId) : undefined;
    if (!tab?.url) return false;
    bookmarkPage(tab);
    return true;
  }
  // ⌘F in a page, its address bar or find bar (or anywhere in the Browser view) finds in the page.
  if (matches(event, 'browser.find')) {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const tabId = target?.dataset.webPreviewPage ?? target?.closest<HTMLElement>('[data-browser-address], [data-browser-find]')?.dataset.tabId ?? (browserView ? currentPageTab()?.id : undefined);
    const page = tabId ? previewPage(tabId) : undefined;
    if (!page || !useWebPreview.getState().tabs.find((t) => t.id === tabId)?.url) return false;
    page.openFind();
    return true;
  }
  // ⌘⇧T: in a page or its address bar, that owner's closed tab; in the Browser view, its own. Elsewhere it is Activity's.
  if (matches(event, 'browser.reopen-tab')) {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const tabId = target?.dataset.webPreviewPage ?? target?.closest<HTMLElement>('[data-browser-address]')?.dataset.tabId;
    const owner = tabId ? useWebPreview.getState().tabs.find((t) => t.id === tabId)?.owner : browserView ? BROWSER_OWNER : undefined;
    if (!owner) return false;
    useWebPreview.getState().reopenTab(owner);
    return true;
  }
  return false;
}
