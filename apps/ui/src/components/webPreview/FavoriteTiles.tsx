import { Copy, ExternalLink, StarOff } from 'lucide-react';
import { useState, type MouseEvent } from 'react';
import type { BrowserFavorite } from '@seshboard/protocol/client';
import { shortUrl } from '@seshboard/protocol/client';
import { removeFavorite, useBrowserFavorites } from '../../state/browserFavoritesStore.ts';
import { copyAddress, openInSystemBrowser } from '../../state/browserActions.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { TabIcon } from './BrowserPane.tsx';

/** A favourite's right-click menu: Copy address, Open in browser, Remove from favourites. */
export function favoriteMenu(favorite: BrowserFavorite): MenuEntry[] {
  return [
    { label: 'Copy address', icon: <Copy size={13} aria-hidden />, onSelect: () => copyAddress(favorite) },
    { label: 'Open in browser', icon: <ExternalLink size={13} aria-hidden />, onSelect: () => openInSystemBrowser(favorite) },
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

/** The favourites as tiles, for an empty tab and the empty Browser view: a click opens one (`onOpen`), a right click shows its menu. None, nothing. */
export function FavoriteTiles({ onOpen }: { onOpen(url: string): void }) {
  const favorites = useBrowserFavorites((s) => s.favorites);
  const [menu, setMenu] = useState<{ x: number; y: number; favorite: BrowserFavorite } | null>(null);
  if (!favorites.length) return null;
  return (
    <section aria-label="Favourites" className="w-full max-w-xl" data-browser-favorites="">
      <h2 className="mb-2 text-meta font-semibold text-muted">Favourites</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
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
