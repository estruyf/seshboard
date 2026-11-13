import { useEffect } from 'react';
import { create } from 'zustand';
import type { BrowserFavorite } from '@seshboard/protocol/client';
import { favoriteOf, keptFavicon, newFavorite } from '../components/webPreview/favorites.ts';
import type { BrowserTab } from '../components/webPreview/browserTabs.ts';
import { tabName } from '../components/webPreview/browserTabs.ts';
import type { EngineClient } from '../engine/connection.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { usePreferences } from './preferencesStore.ts';
import { toast } from './toastStore.ts';

/** Your browser favourites, in order, as the engine keeps them (`browser.favorites.*`). */
export const useBrowserFavorites = create<{ favorites: readonly BrowserFavorite[] }>()(() => ({ favorites: [] }));

let client: EngineClient | null = null;
let ids = 0;
const newId = () => `fav-${Date.now().toString(36)}-${(++ids).toString(36)}`;

/** The list as the engine has it. */
async function load(): Promise<void> {
  if (!client) return;
  try {
    const { favorites } = await client.call('browser.favorites.list', {});
    useBrowserFavorites.setState({ favorites });
  } catch {
    // The list stays as it was; the next focus tries again.
  }
}

/** A change shown at once and saved; if saving fails, it says so and shows the engine's list again. */
function change(next: readonly BrowserFavorite[], save: (client: EngineClient) => Promise<unknown>, failure: string): void {
  useBrowserFavorites.setState({ favorites: next });
  if (!client) return;
  save(client).catch(() => {
    toast(failure, { tone: 'error' });
    void load();
  });
}

/** The favourite for a page's address, if it is one. */
export function useFavoriteOf(url: string | null): BrowserFavorite | undefined {
  return useBrowserFavorites((s) => favoriteOf(s.favorites, url));
}

/** The toolbar's star, the palette and ⌘D: adds the tab's page to the favourites, or removes it. */
export function toggleFavorite(tab: Pick<BrowserTab, 'url' | 'title' | 'name' | 'favicon'>): void {
  if (!tab.url) return;
  const { favorites } = useBrowserFavorites.getState();
  const existing = favoriteOf(favorites, tab.url);
  if (existing) return removeFavorite(existing.id);
  const favorite = newFavorite(favorites, { url: tab.url, title: tabName(tab), favicon: tab.favicon }, newId(), Date.now());
  const { createdAt: _, ...saved } = favorite;
  change([...favorites, favorite], (c) => c.call('browser.favorites.save', { favorite: saved }), "Couldn't add the favourite");
}

/** A page's icon came (main, `favicon`): a favourite on that page takes it, so one starred before its icon still gets one. */
export function noteFavicon(url: string | null, favicon: string): void {
  const { favorites } = useBrowserFavorites.getState();
  const existing = favoriteOf(favorites, url);
  const kept = keptFavicon(favicon);
  if (!existing || !kept || existing.favicon === kept) return;
  const { createdAt: _, ...saved } = { ...existing, favicon: kept };
  change(
    favorites.map((f) => (f.id === existing.id ? { ...f, favicon: kept } : f)),
    (c) => c.call('browser.favorites.save', { favorite: saved }),
    "Couldn't save the favourite's icon",
  );
}

/**
 * Edit favourite… and Use current page's address: a new address or title, only ever from you. Nothing else changes a
 * favourite's address. A new address drops the icon, which the page gives again once it loads (`noteFavicon`).
 */
export function updateFavorite(id: string, edit: { url?: string; title?: string }): void {
  const { favorites } = useBrowserFavorites.getState();
  const existing = favorites.find((f) => f.id === id);
  if (!existing) return;
  const url = edit.url ?? existing.url;
  const title = (edit.title ?? existing.title).trim().slice(0, 500) || url;
  const next = { ...existing, url, title, favicon: url === existing.url ? existing.favicon : null };
  const { createdAt: _, ...saved } = next;
  change(favorites.map((f) => (f.id === id ? next : f)), (c) => c.call('browser.favorites.save', { favorite: saved }), "Couldn't save the favourite");
}

export function removeFavorite(id: string): void {
  const { favorites } = useBrowserFavorites.getState();
  change(
    favorites.filter((f) => f.id !== id),
    (c) => c.call('browser.favorites.remove', { id }),
    "Couldn't remove the favourite",
  );
}

/**
 * Loads the favourites once the engine is connected with the browser on, and again when the window comes to the front,
 * so a favourite added in another window shows here too.
 */
export function useBrowserFavoritesSync(): void {
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
