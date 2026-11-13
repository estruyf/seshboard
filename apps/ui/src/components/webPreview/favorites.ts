import { addressBarUrl, type BrowserFavorite } from '@seshboard/protocol/client';

/*
 * Browser favourites as plain data: which favourite a page is, adding one at the end, and the icon kept with it. Pure,
 * so the rules are tested on their own; `browserFavoritesStore.ts` holds the list and saves it in the engine.
 */

/** The largest icon kept with a favourite; a bigger one is left out (the favourite shows a globe). */
export const FAVICON_KEEP_MAX = 65_536;

const DATA_IMAGE = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i;

/** The same page for a favourite: the same address, whatever its `#`. */
function samePage(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    x.hash = '';
    y.hash = '';
    return x.href === y.href;
  } catch {
    return a === b;
  }
}

/** The favourite for a page's address, if it is one. */
export function favoriteOf(favorites: readonly BrowserFavorite[], url: string | null): BrowserFavorite | undefined {
  return url ? favorites.find((f) => samePage(f.url, url)) : undefined;
}

/** A tab's icon as a favourite keeps it: a small `data:` image, else none. */
export function keptFavicon(favicon: string | null): string | null {
  return favicon && favicon.length <= FAVICON_KEEP_MAX && DATA_IMAGE.test(favicon) ? favicon : null;
}

/** A page added at the end of the favourites. */
export function newFavorite(favorites: readonly BrowserFavorite[], page: { url: string; title: string; favicon: string | null }, id: string, now: number): BrowserFavorite {
  const position = favorites.reduce((max, f) => Math.max(max, f.position + 1), 0);
  return { id, url: page.url, title: page.title.slice(0, 500) || page.url, favicon: keptFavicon(page.favicon), position, createdAt: now };
}

/** Why Edit favourite… can't save `text` as the address of favourite `id`, or null when it can. */
export function favoriteAddressProblem(text: string, favorites: readonly BrowserFavorite[], id: string): string | null {
  const url = addressBarUrl(text, { anyHost: true });
  if (!url) return 'Type an address, such as github.com';
  const other = favoriteOf(favorites, url);
  return other && other.id !== id ? `Already a favourite: ${other.title}` : null;
}
