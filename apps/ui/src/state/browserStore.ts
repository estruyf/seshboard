import { create } from 'zustand';
import { BROWSER_HOME } from '@seshboard/protocol/client';
import { browserPage, dropBrowserPage } from '../components/webPreview/webPreviewPages.ts';
import { showInMain } from './popoutsStore.ts';
import { useSessions } from './sessionsStore.ts';

interface BrowserState {
  /** The address the page is on; null while the browser is closed. */
  url: string | null;
}

/** The browser view: one page from the web beside the sessions, kept while a session is on screen. */
export const useBrowser = create<BrowserState>()(() => ({ url: null }));

/** The browser's page, made on first use with GitHub on it. */
export function ensureBrowserPage() {
  const page = browserPage((url) => useBrowser.setState({ url }));
  if (page.loaded < 0) {
    page.loaded = 0;
    page.load(BROWSER_HOME);
    useBrowser.setState({ url: BROWSER_HOME });
  }
  return page;
}

/**
 * Shows the browser as a main view, on the page it was left on, or on `url`. A pop-out has no browser: the main
 * window shows it.
 */
export function openBrowser(url?: string): void {
  if (showInMain({ kind: 'browser', url: url ?? null })) return;
  const page = ensureBrowserPage();
  if (url) {
    page.load(url);
    useBrowser.setState({ url });
  }
  useSessions.getState().setView('browser');
}

/** Closes the browser's page and leaves its view for Home. Sign-ins stay, in its own storage. */
export function closeBrowser(): void {
  dropBrowserPage();
  useBrowser.setState({ url: null });
  if (useSessions.getState().view === 'browser') useSessions.getState().goHome();
}
