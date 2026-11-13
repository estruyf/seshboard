import { Copy, ExternalLink, Globe, Link, Pencil, Plus, RotateCcw, StarOff, X } from 'lucide-react';
import { useState, type MouseEvent } from 'react';
import type { BrowserFavorite } from '@seshboard/protocol/client';
import { shortUrl } from '@seshboard/protocol/client';
import { addFavorite, removeFavorite, updateFavorite, useBrowserFavorites } from '../../state/browserFavoritesStore.ts';
import { askEditFavorite, copyAddress, openInSystemBrowser } from '../../state/browserActions.ts';
import { openFavorite } from '../../state/browserViewStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { useWebPreview } from '../../state/webPreviewStore.ts';
import { favoriteOf } from './favorites.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { TabIcon } from './BrowserPane.tsx';
import { BROWSER_OWNER, favoriteTab, frontTab, sameAddress, type BrowserTab } from './browserTabs.ts';

/**
 * A favourite's menu, on its tile (right click or ⋯) and on an empty tab's: Open, Edit favourite…, Copy address, Open in
 * browser, then, while its tab is open, Use current page's address and Go back to its address (when the tab has moved on)
 * and Close, then Remove from favourites. A favourite keeps its address as you browse: only Edit favourite… and Use
 * current page's address change it.
 */
export function favoriteMenu(favorite: BrowserFavorite, open: BrowserTab | null = null): MenuEntry[] {
  const away = open?.url ? !sameAddress(open.url, favorite.url) : false;
  // Its tab's page, unless that page is another favourite already.
  const usePage = away && open?.url && !favoriteOf(useBrowserFavorites.getState().favorites, open.url) ? open.url : null;
  return [
    { label: 'Open', icon: <Globe size={13} aria-hidden />, onSelect: () => openFavorite(favorite.url) },
    { label: 'Edit favourite…', icon: <Pencil size={13} aria-hidden />, onSelect: () => askEditFavorite(favorite), data: { 'data-browser-favorite-edit': true } },
    { label: 'Copy address', icon: <Copy size={13} aria-hidden />, onSelect: () => copyAddress(favorite) },
    { label: 'Open in browser', icon: <ExternalLink size={13} aria-hidden />, onSelect: () => openInSystemBrowser(favorite) },
    ...(open
      ? (['separator', ...(usePage ? [{ label: "Use current page's address", detail: shortUrl(usePage), icon: <Link size={13} aria-hidden />, onSelect: () => updateFavorite(favorite.id, { url: usePage }), data: { 'data-browser-favorite-use-page': true } }] : []), ...(away ? [{ label: 'Go back to its address', icon: <RotateCcw size={13} aria-hidden />, onSelect: () => useWebPreview.getState().navigate(open.id, favorite.url), data: { 'data-browser-favorite-home': true } }] : []), { label: 'Close', icon: <X size={13} aria-hidden />, onSelect: () => useWebPreview.getState().closeTab(open.id), data: { 'data-browser-favorite-close': true } }] as MenuEntry[])
      : []),
    'separator',
    { label: 'Remove from favourites', icon: <StarOff size={13} aria-hidden />, onSelect: () => removeFavorite(favorite.id), data: { 'data-browser-favorite-remove': true } },
  ];
}

/** Where a favourite's menu opens: at the pointer, or under the element from the keyboard. */
export function menuAt(event: MouseEvent<HTMLElement>): { x: number; y: number } {
  event.preventDefault();
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX || rect.left, y: event.clientY || rect.bottom };
}

/**
 * Your favourites as icon tiles, four to a row, at the top of the Browser view's list (as in Arc or Zen). A tile opens
 * its favourite's own tab, which then shows in the tile (a dot under it) and not in the list. Its name is in the
 * tooltip. A middle click closes its tab. The last tile adds the Browser tab in front. No favourites and no page to
 * add, nothing.
 */
export function FavoriteBar() {
  const favorites = useBrowserFavorites((s) => s.favorites);
  const tabs = useWebPreview((s) => s.tabs);
  const activeId = useWebPreview((s) => s.active.get(BROWSER_OWNER) ?? null);
  const atBrowser = useSessions((s) => s.view === 'browser');
  const front = useWebPreview((s) => frontTab(s, BROWSER_OWNER) ?? null);
  const [menu, setMenu] = useState<{ x: number; y: number; favorite: BrowserFavorite } | null>(null);
  // The + tile: the page in front, while it isn't a favourite's already.
  const addable = front?.url && !front.favoriteId ? front : null;
  if (!favorites.length && !addable) return null;
  const state = { tabs, active: new Map<string, string>() };
  return (
    <div className="px-2 pb-2" data-browser-favorites-bar="">
      <ul aria-label="Favourites" className="grid grid-cols-4 gap-1.5">
        {favorites.map((favorite) => {
          const open = favoriteTab(state, favorite.id) ?? null;
          const current = atBrowser && !!open && open.id === activeId;
          const label = `${favorite.title}${open ? ', open' : ''}`;
          return (
            <li key={favorite.id} className="min-w-0">
              <button
                type="button"
                onClick={() => openFavorite(favorite.url)}
                onContextMenu={(e) => setMenu({ ...menuAt(e), favorite })}
                onMouseDown={(e) => e.button === 1 && e.preventDefault()}
                onAuxClick={(e) => {
                  if (e.button !== 1 || !open) return;
                  e.preventDefault();
                  useWebPreview.getState().closeTab(open.id);
                }}
                aria-label={label}
                aria-current={current ? 'page' : undefined}
                data-tooltip={`${favorite.title}\n${shortUrl(open?.url ?? favorite.url)}`}
                className={`relative flex h-11 w-full items-center justify-center rounded-lg ${current ? 'bg-selected ring-1 ring-border' : 'bg-text/6 hover:bg-border/45'}`}
                data-browser-favorite={favorite.url}
                data-browser-favorite-open={open ? '' : undefined}
              >
                <TabIcon tab={open?.favicon ? open : favorite} size={18} />
                {open && <span aria-hidden className={`absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full ${current ? 'bg-text' : 'bg-muted'}`} />}
              </button>
            </li>
          );
        })}
        <li className="min-w-0">
          <button
            type="button"
            disabled={!addable}
            onClick={() => addable && addFavorite(addable)}
            aria-label={addable ? 'Add the page in front to favourites' : 'Add to favourites: open a page first'}
            data-tooltip={addable ? 'Add the page in front to favourites' : 'Open a page, then add it here'}
            className="flex h-11 w-full items-center justify-center rounded-lg border border-dashed border-border text-faint enabled:hover:bg-border/45 enabled:hover:text-text disabled:opacity-50"
            data-browser-favorite-add=""
          >
            <Plus size={15} aria-hidden />
          </button>
        </li>
      </ul>
      {menu && <Menu x={menu.x} y={menu.y} entries={favoriteMenu(menu.favorite, favoriteTab(state, menu.favorite.id) ?? null)} label={`${menu.favorite.title} menu`} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** The favourites as tiles with their names, for a new tab and the empty Browser view: a click opens one (`onOpen`), a right click shows its menu. None, nothing. */
export function FavoriteTiles({ onOpen }: { onOpen(url: string): void }) {
  const favorites = useBrowserFavorites((s) => s.favorites);
  const [menu, setMenu] = useState<{ x: number; y: number; favorite: BrowserFavorite } | null>(null);
  if (!favorites.length) return null;
  return (
    <section aria-label="Favourites" className="w-full" data-browser-favorites="">
      <h2 className="mb-2 text-meta font-semibold text-muted">Favourites</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2">
        {favorites.map((favorite) => (
          <button
            key={favorite.id}
            type="button"
            onClick={() => onOpen(favorite.url)}
            onContextMenu={(e) => setMenu({ ...menuAt(e), favorite })}
            data-tooltip={`${favorite.title}\n${shortUrl(favorite.url)}`}
            className="flex min-w-0 flex-col items-center gap-1.5 rounded-lg bg-text/6 px-2 py-3 text-ui text-text hover:bg-border/45"
            data-browser-favorite={favorite.url}
          >
            <TabIcon tab={favorite} size={20} />
            <span className="w-full truncate text-center">{favorite.title}</span>
          </button>
        ))}
      </div>
      {menu && <Menu x={menu.x} y={menu.y} entries={favoriteMenu(menu.favorite)} label={`${menu.favorite.title} menu`} onClose={() => setMenu(null)} />}
    </section>
  );
}
