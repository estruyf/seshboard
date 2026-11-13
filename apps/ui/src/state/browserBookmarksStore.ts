import { useEffect } from 'react';
import { create } from 'zustand';
import type { BrowserBookmark } from '@seshboard/protocol/client';
import { bookmarkOf, cleanFolder, newBookmark } from '../components/webPreview/bookmarks.ts';
import { keptFavicon } from '../components/webPreview/favorites.ts';
import { BROWSER_OWNER, type BrowserTab } from '../components/webPreview/browserTabs.ts';
import type { EngineClient } from '../engine/connection.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { usePaletteBus } from './paletteBus.ts';
import { usePreferences } from './preferencesStore.ts';
import { useSessions } from './sessionsStore.ts';
import { toast } from './toastStore.ts';

/** Your browser bookmarks, in order, as the engine keeps them (`browser.bookmarks.*`): every project's and everywhere's. */
export const useBrowserBookmarks = create<{ bookmarks: readonly BrowserBookmark[] }>()(() => ({ bookmarks: [] }));

let client: EngineClient | null = null;
let ids = 0;
const newId = () => `bm-${Date.now().toString(36)}-${(++ids).toString(36)}`;

async function load(): Promise<void> {
  if (!client) return;
  try {
    const { bookmarks } = await client.call('browser.bookmarks.list', {});
    useBrowserBookmarks.setState({ bookmarks });
  } catch {
    // The list stays as it was; the next focus tries again.
  }
}

/** A change shown at once and saved; if saving fails, it says so and shows the engine's list again. */
function change(next: readonly BrowserBookmark[], save: (client: EngineClient) => Promise<unknown>, failure: string): void {
  useBrowserBookmarks.setState({ bookmarks: next });
  if (!client) return;
  save(client).catch(() => {
    toast(failure, { tone: 'error' });
    void load();
  });
}

const saved = (b: BrowserBookmark) => {
  const { createdAt: _, ...rest } = b;
  return rest;
};

/** The project a tab's bookmarks belong to: its session's, or none for a Browser tab (or a session not known here). */
export function projectOfTab(tab: Pick<BrowserTab, 'owner'>): string | null {
  if (tab.owner === BROWSER_OWNER) return null;
  return useSessions.getState().sessions.get(tab.owner)?.projectRoot ?? null;
}

/** The bookmark a tab's page has, if any (its project's first). */
export function useBookmarkOf(tab: Pick<BrowserTab, 'url' | 'owner'> | null): BrowserBookmark | undefined {
  const project = tab ? projectOfTab(tab) : null;
  return useBrowserBookmarks((s) => (tab ? bookmarkOf(s.bookmarks, tab.url, project) : undefined));
}

/**
 * ⌘D, the star and the palette: bookmarks the tab's page (for its session's project, or everywhere in the Browser
 * view) if it has none, then shows its bookmark to name, place or remove (`BookmarkDialog`).
 */
export function bookmarkPage(tab: Pick<BrowserTab, 'id' | 'url' | 'title' | 'name' | 'favicon' | 'owner'>): void {
  if (!tab.url) return;
  const { bookmarks } = useBrowserBookmarks.getState();
  const project = projectOfTab(tab);
  if (!bookmarkOf(bookmarks, tab.url, project)) {
    const bookmark = newBookmark(bookmarks, { url: tab.url, title: tab.title, name: tab.name, favicon: tab.favicon }, project, newId(), Date.now());
    change([...bookmarks, bookmark], (c) => c.call('browser.bookmarks.save', { bookmark: saved(bookmark) }), "Couldn't add the bookmark");
  }
  usePaletteBus.getState().showDialog({ kind: 'bookmark', tabId: tab.id });
}

/** The bookmark dialog's Done: its name, folder and where it shows. An empty name gives the address back. */
export function updateBookmark(id: string, change_: { title?: string; folder?: string; projectRoot?: string | null }): void {
  const { bookmarks } = useBrowserBookmarks.getState();
  const existing = bookmarks.find((b) => b.id === id);
  if (!existing) return;
  const title = change_.title === undefined ? existing.title : change_.title.replace(/\s+/g, ' ').trim().slice(0, 500) || existing.url;
  const folder = change_.folder === undefined ? existing.folder : cleanFolder(change_.folder);
  const projectRoot = change_.projectRoot === undefined ? existing.projectRoot : change_.projectRoot;
  if (title === existing.title && folder === existing.folder && projectRoot === existing.projectRoot) return;
  const next = { ...existing, title, folder, projectRoot };
  change(
    bookmarks.map((b) => (b.id === id ? next : b)),
    (c) => c.call('browser.bookmarks.save', { bookmark: saved(next) }),
    "Couldn't save the bookmark",
  );
}

export function removeBookmark(id: string): void {
  const { bookmarks } = useBrowserBookmarks.getState();
  change(
    bookmarks.filter((b) => b.id !== id),
    (c) => c.call('browser.bookmarks.remove', { id }),
    "Couldn't remove the bookmark",
  );
}

/** A page's icon came: its bookmarks take it, so one added before its icon still gets one. */
export function noteBookmarkFavicon(url: string | null, favicon: string): void {
  const kept = keptFavicon(favicon);
  if (!url || !kept) return;
  const { bookmarks } = useBrowserBookmarks.getState();
  const stale = bookmarks.filter((b) => b.favicon !== kept && bookmarkOf([b], url));
  if (!stale.length) return;
  const ids_ = new Set(stale.map((b) => b.id));
  change(
    bookmarks.map((b) => (ids_.has(b.id) ? { ...b, favicon: kept } : b)),
    (c) => Promise.all(stale.map((b) => c.call('browser.bookmarks.save', { bookmark: saved({ ...b, favicon: kept }) }))),
    "Couldn't save the bookmark's icon",
  );
}

/** Loads the bookmarks once the engine is connected with the browser on, and again when the window comes to the front. */
export function useBrowserBookmarksSync(): void {
  const connection = useEngineConnection();
  const connected = connection.status === 'connected' ? connection.client : null;
  const on = usePreferences((s) => s.prefs.browserEnabled);
  useEffect(() => {
    client = on ? connected : null;
    if (!client) return;
    void load();
    const refresh = () => void load();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [connected, on]);
}
