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

/** The words between a title's parts: "Docs | Site", "Workers · Cloudflare", "GitHub - owner/repo". */
const TITLE_PARTS = /\s+[|·•\-–—]\s+/;

/** The site's own name in an address, as a title says it: `dash.cloudflare.com` is "cloudflare". */
function siteWord(url: string | null): string | null {
  if (!url) return null;
  try {
    const labels = new URL(url).hostname.replace(/^www\./, '').split('.');
    return labels.length >= 2 ? labels[labels.length - 2]!.toLowerCase() : (labels[0] ?? null);
  } catch {
    return null;
  }
}

/**
 * A page's title, short enough for a favourite or a bookmark: a part said twice once ("Seshboard | Seshboard"), the
 * site's own name left out ("Workers · Cloudflare Dashboard" on cloudflare.com), and a repository's name alone
 * ("involv-intranet/intranet", "GitHub - estruyf/seshboard: Manage your sessions"). Nothing left, the title as it was.
 */
export function shortTitle(title: string, url: string | null): string {
  const text = title.trim();
  const site = siteWord(url);
  let parts = text.split(TITLE_PARTS).map((p) => p.trim()).filter(Boolean);
  parts = parts.filter((p, i) => i === 0 || p.toLowerCase() !== parts[i - 1]!.toLowerCase());
  if (site && parts.length > 1) {
    const kept = parts.filter((p) => !p.toLowerCase().includes(site));
    if (kept.length) parts = kept;
  }
  const short = parts.join(' · ');
  const repo = /^[\w.-]+\/([\w.-]+)(?::\s.*)?$/.exec(short);
  return (repo ? repo[1]! : short) || text;
}

/** A page added at the end of the favourites, under its short title (`shortTitle`) unless it has a name of yours. */
export function newFavorite(favorites: readonly BrowserFavorite[], page: { url: string; title: string; name?: string | null; favicon: string | null }, id: string, now: number): BrowserFavorite {
  const position = favorites.reduce((max, f) => Math.max(max, f.position + 1), 0);
  const title = page.name || shortTitle(page.title, page.url);
  return { id, url: page.url, title: title.slice(0, 500) || page.url, favicon: keptFavicon(page.favicon), position, createdAt: now };
}

/** Why Edit favourite… can't save `text` as the address of favourite `id`, or null when it can. */
export function favoriteAddressProblem(text: string, favorites: readonly BrowserFavorite[], id: string): string | null {
  const url = addressBarUrl(text, { anyHost: true });
  if (!url) return 'Type an address, such as github.com';
  const other = favoriteOf(favorites, url);
  return other && other.id !== id ? `Already a favourite: ${other.title}` : null;
}

/** How many favourites the sidebar shows in a row, as tiles. */
export const FAVORITE_COLUMNS = 4;
