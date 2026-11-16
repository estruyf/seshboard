import { browserProfilePartition, shortUrl, webPageUrl, type BrowserFavorite } from '@seshboard/protocol/client';
import type { PickedElement } from '@seshboard/protocol/bridge';
import { elementImage, elementItem, quoteHeading } from '../components/webPreview/pageMessage.ts';
import { useDrafts } from './draftsStore.ts';
import { BROWSER_OWNER, livePages, nextZoom, type BrowserTab } from '../components/webPreview/browserTabs.ts';
import { previewPage, usePreviewPages } from '../components/webPreview/webPreviewPages.ts';
import { currentPageTab, openBrowserView, openFavorite } from './browserViewStore.ts';
import { usePaletteBus } from './paletteBus.ts';
import { useSessions } from './sessionsStore.ts';
import { toast } from './toastStore.ts';
import { browserOn, useWebPreview } from './webPreviewStore.ts';

/*
 * What can be done with a browser tab, in one place for the toolbar's ⋯ menu, the tab menus, the palette and the keys:
 * copy its address, open it in the system's browser, rename it, its developer tools and zoom, clear its site's data or
 * all of it, show it wherever it lives, and send what is on a session's page to its message.
 */

export function copyAddress(tab: Pick<BrowserTab, 'url'>): void {
  if (!tab.url) return;
  void navigator.clipboard.writeText(tab.url).then(
    () => toast('Address copied'),
    () => toast("Couldn't copy the address", { tone: 'error' }),
  );
}

export function openInSystemBrowser(tab: Pick<BrowserTab, 'url'>): void {
  if (tab.url) window.open(tab.url, '_blank');
}

/** Rename tab…: its dialog (`PaletteDialogs`). */
export function askRename(tab: Pick<BrowserTab, 'id'>): void {
  usePaletteBus.getState().showDialog({ kind: 'rename-tab', tabId: tab.id });
}

/** Edit favourite…: its dialog (`PaletteDialogs`). */
export function askEditFavorite(favorite: Pick<BrowserFavorite, 'id'>): void {
  usePaletteBus.getState().showDialog({ kind: 'edit-favorite', id: favorite.id });
}

/** Clear data for this site… (a tab given, in its browser profile) or Clear all browsing data… (null): asks first (`PaletteDialogs`). */
export function askClearData(tab: Pick<BrowserTab, 'url' | 'profileId'> | null): void {
  const origin = tab?.url ? new URL(tab.url).origin : null;
  if (tab && !origin) return;
  usePaletteBus.getState().showDialog({ kind: 'clear-browser-data', origin, profileId: tab?.profileId ?? null });
}

/** The host a site's data is cleared for, as the dialog and the toast name it. */
export const siteName = (origin: string): string => shortUrl(origin).replace(/\/$/, '');

/**
 * Clears a site's data (its cookies and storage, which signs you out of it) in one browser profile (`profileId`, null:
 * Default) or, with no origin, all of it in every profile (`profileIds`: the others); then the pages that showed it load
 * again, signed out. Throws when main couldn't.
 */
export async function clearBrowsingData(origin: string | null, profileId: string | null = null, profileIds: readonly string[] = []): Promise<void> {
  if (origin) await window.seshboard?.clearBrowsingData(origin, browserProfilePartition(profileId));
  else for (const id of [null, ...profileIds]) await window.seshboard?.clearBrowsingData(null, browserProfilePartition(id));
  const state = useWebPreview.getState();
  for (const id of livePages(state)) {
    const tab = state.tabs.find((t) => t.id === id);
    if (!tab?.url) continue;
    if (origin && (new URL(tab.url).origin !== origin || tab.profileId !== profileId)) continue;
    previewPage(id)?.reload(tab.url);
  }
  toast(origin ? `Signed out of ${siteName(origin)}` : 'Browsing data cleared', { icon: 'browser' });
}

/** Find in page: opens the page's find bar, or puts the focus back in it. */
export const findInPage = (tab: Pick<BrowserTab, 'id'>): void => previewPage(tab.id)?.openFind();

export const toggleDevTools = (tab: Pick<BrowserTab, 'id'>): void => previewPage(tab.id)?.devTools();
export function zoomPage(tab: Pick<BrowserTab, 'id'>, step: 1 | -1 | 0): void {
  const page = previewPage(tab.id);
  if (page) return page.zoom(step);
  // No live page: kept with the tab for when it loads.
  const now = useWebPreview.getState().tabs.find((t) => t.id === tab.id);
  if (now) useWebPreview.getState().zoomTo(now.id, nextZoom(now.zoom, step));
}

/** Mutes a tab, or lets it play sound again. */
export function toggleMute(tab: Pick<BrowserTab, 'id' | 'muted'>): void {
  const page = previewPage(tab.id);
  if (page) page.mute(!tab.muted);
  else useWebPreview.getState().setMuted(tab.id, !tab.muted);
}

/** The session's message box is out of sight (its browser full size, or the tab shown in the Browser view): a toast says where things went. */
const messageHidden = (owner: string): boolean => useWebPreview.getState().full.has(owner) || useSessions.getState().view !== 'session';

/** Quote in message: text selected on a session's page, quoted in its message box under the page it came from. */
export function quoteInMessage(tab: Pick<BrowserTab, 'owner'>, text: string, url: string): void {
  if (tab.owner === BROWSER_OWNER) return;
  useDrafts.getState().requestQuote(tab.owner, text, { heading: quoteHeading(url) });
  if (messageHidden(tab.owner)) toast('Quoted in the message', { icon: 'browser' });
}

/** An element of a session's page in its message: a chip with where it is and its HTML, and its picture. */
export function addElementToMessage(tab: Pick<BrowserTab, 'owner'>, element: PickedElement): void {
  if (tab.owner === BROWSER_OWNER) return;
  const drafts = useDrafts.getState();
  drafts.addContext(tab.owner, [elementItem(element)]);
  const image = elementImage(element);
  if (image) drafts.requestImages(tab.owner, [image]);
  drafts.requestFocus(tab.owner);
  if (messageHidden(tab.owner)) toast('Element added to the message', { icon: 'browser' });
}

/** Pick an element: on a session's page, the one you click goes to its message; again while picking stops. */
export function pickElement(tab: Pick<BrowserTab, 'id' | 'owner' | 'url'>): void {
  const page = previewPage(tab.id);
  if (!page || !tab.url || tab.owner === BROWSER_OWNER) return;
  if (usePreviewPages.getState().pages.get(tab.id)?.picking) return page.cancelPick();
  void page.pick().then((element) => element && addElementToMessage(tab, element));
}

/** Go to tab…: the tab in front where it lives, the Browser view or its session with the panel open. */
export function goToTab(tabId: string): void {
  const web = useWebPreview.getState();
  const tab = web.tabs.find((t) => t.id === tabId);
  if (!tab) return;
  if (tab.owner === BROWSER_OWNER) {
    web.selectTab(tab.id);
    if (useSessions.getState().view !== 'browser') openBrowserView();
    return;
  }
  useSessions.getState().select(tab.owner);
  web.selectTab(tab.id);
  web.open(tab.owner);
}

/** Open favourite…: in the session on screen, its panel; anywhere else, the Browser view. */
export function openFavoriteHere(url: string): void {
  const { view, selectedId } = useSessions.getState();
  if (view === 'session' && selectedId) useWebPreview.getState().open(selectedId, url);
  else openFavorite(url);
}

/**
 * A web link the app offers (Open on GitHub, a pull request, a guide), with the browser on: in `sessionId`'s browser when
 * given, else where Open favourite… puts it (`openFavoriteHere`). The browser off, or an address that is no web page,
 * leaves it to the system browser.
 */
export function openWebLink(url: string, sessionId: string | null = null): void {
  const page = browserOn() ? webPageUrl(url) : null;
  if (!page) {
    // The main process opens http(s) links from window.open in the system browser.
    window.open(url, '_blank');
    return;
  }
  if (sessionId) useWebPreview.getState().open(sessionId, page);
  else openFavoriteHere(page);
}

/** What the palette's browser commands do (`runBrowserAction`): to the tab on screen, except Reopen closed tab and Clear all browsing data. */
export type BrowserAction =
  | 'back'
  | 'forward'
  | 'stop'
  | 'close-tab'
  | 'reopen-tab'
  | 'pin'
  | 'unpin'
  | 'rename'
  | 'copy-address'
  | 'open-external'
  | 'address'
  | 'find'
  | 'full'
  | 'side'
  | 'close-panel'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'mute'
  | 'unmute'
  | 'devtools'
  | 'pick-element'
  | 'clear-site'
  | 'clear-all';

/** Reopen closed tab from the palette: the one closed last here (the Browser view's, or the session's), else any. */
function reopenHere(): void {
  const { view, selectedId } = useSessions.getState();
  const web = useWebPreview.getState();
  const owner = web.reopenTab(view === 'browser' ? BROWSER_OWNER : (selectedId ?? undefined)) ?? web.reopenTab();
  if (owner === BROWSER_OWNER) {
    if (view !== 'browser') openBrowserView();
  } else if (owner && owner !== selectedId) useSessions.getState().select(owner);
}

/** A palette command on the browser: to the tab on screen, except Reopen closed tab and Clear all browsing data. */
export function runBrowserAction(action: BrowserAction): void {
  if (action === 'reopen-tab') return reopenHere();
  if (action === 'clear-all') return askClearData(null);
  const tab = currentPageTab();
  if (!tab) return;
  const web = useWebPreview.getState();
  const page = previewPage(tab.id);
  switch (action) {
    case 'back':
      return page?.back();
    case 'forward':
      return page?.forward();
    case 'stop':
      return page?.stop();
    case 'close-tab':
      return web.closeTab(tab.id);
    case 'pin':
      return web.pin(tab.id);
    case 'unpin':
      return web.unpin(tab.id);
    case 'rename':
      return askRename(tab);
    case 'copy-address':
      return copyAddress(tab);
    case 'open-external':
      return openInSystemBrowser(tab);
    case 'address':
      // After the palette has closed and handed the focus back.
      setTimeout(() => {
        const field = document.querySelector<HTMLInputElement>(`[data-browser-address][data-tab-id="${CSS.escape(tab.id)}"]`);
        field?.focus();
        field?.select();
      });
      return;
    case 'find':
      return findInPage(tab);
    case 'full':
    case 'side':
      return web.setFull(tab.owner, action === 'full');
    case 'close-panel':
      return web.close(tab.owner);
    case 'zoom-in':
      return zoomPage(tab, 1);
    case 'zoom-out':
      return zoomPage(tab, -1);
    case 'zoom-reset':
      return zoomPage(tab, 0);
    case 'mute':
    case 'unmute':
      return toggleMute({ id: tab.id, muted: action === 'unmute' });
    case 'devtools':
      return toggleDevTools(tab);
    case 'pick-element':
      return pickElement(tab);
    case 'clear-site':
      return askClearData(tab);
  }
}
