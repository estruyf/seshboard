import { describe, expect, it } from 'vitest';
import type { BrowserFavorite } from '@seshboard/protocol/client';
import { favoriteAddressProblem, favoriteOf, FAVICON_KEEP_MAX, keptFavicon, newFavorite, shortTitle } from './favorites.ts';

const fav = (id: string, url: string, position: number): BrowserFavorite => ({ id, url, title: id, favicon: null, position, createdAt: position });

describe('favourites', () => {
  const list = [fav('gh', 'https://github.com/pulls', 0), fav('docs', 'https://docs.test/guide?v=2', 3)];

  it('finds the favourite for a page whatever its #, but not another query or path', () => {
    expect(favoriteOf(list, 'https://github.com/pulls#top')?.id).toBe('gh');
    expect(favoriteOf(list, 'https://docs.test/guide?v=2')?.id).toBe('docs');
    expect(favoriteOf(list, 'https://docs.test/guide?v=3')).toBeUndefined();
    expect(favoriteOf(list, 'https://github.com/issues')).toBeUndefined();
    expect(favoriteOf(list, null)).toBeUndefined();
  });

  it('adds a page at the end, titled by its address when it has no title', () => {
    const added = newFavorite(list, { url: 'https://new.test/', title: '', favicon: null }, 'n', 50);
    expect(added).toMatchObject({ id: 'n', url: 'https://new.test/', title: 'https://new.test/', position: 4, createdAt: 50 });
    expect(newFavorite([], { url: 'https://a.test/', title: 'A', favicon: null }, 'a', 1).position).toBe(0);
  });

  it("saves an edited address only when it is one, and not another favourite's", () => {
    expect(favoriteAddressProblem('github.com/pulls?q=mine', list, 'gh')).toBeNull();
    // Its own address again is fine.
    expect(favoriteAddressProblem('https://github.com/pulls', list, 'gh')).toBeNull();
    expect(favoriteAddressProblem('not an address', list, 'gh')).toBe('Type an address, such as github.com');
    expect(favoriteAddressProblem('docs.test/guide?v=2', list, 'gh')).toBe('Already a favourite: docs');
  });

  it('keeps only a small data: image as the icon', () => {
    expect(keptFavicon('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(keptFavicon('https://github.com/favicon.ico')).toBeNull();
    expect(keptFavicon(`data:image/png;base64,${'A'.repeat(FAVICON_KEEP_MAX)}`)).toBeNull();
    expect(keptFavicon(null)).toBeNull();
  });

  it('shortens a title for a favourite: a repeated part once, without the site, a repository by its name', () => {
    expect(shortTitle('Seshboard | Seshboard', 'https://seshboard.app/')).toBe('Seshboard');
    expect(shortTitle('involv-intranet/intranet', 'https://github.com/involv-intranet/intranet')).toBe('intranet');
    expect(shortTitle('GitHub - estruyf/seshboard: Manage your Claude Code sessions', 'https://github.com/estruyf/seshboard')).toBe('seshboard');
    expect(shortTitle('Workers · Cloudflare Dashboard', 'https://dash.cloudflare.com/workers')).toBe('Workers');
    expect(shortTitle('Pull requests · involv-intranet/intranet · GitHub', 'https://github.com/involv-intranet/intranet/pulls')).toBe('Pull requests · involv-intranet/intranet');
    // Nothing to take away: as it was.
    expect(shortTitle('My Dashboard', 'https://intranet.test/')).toBe('My Dashboard');
    expect(shortTitle('GitHub', 'https://github.com/')).toBe('GitHub');
    expect(shortTitle('  ', null)).toBe('');
  });

  it('adds a page under its short title, or the name you gave its tab', () => {
    expect(newFavorite([], { url: 'https://seshboard.app/', title: 'Seshboard | Seshboard', favicon: null }, 's', 1).title).toBe('Seshboard');
    expect(newFavorite([], { url: 'https://seshboard.app/', title: 'Seshboard | Seshboard', name: 'Docs', favicon: null }, 's', 1).title).toBe('Docs');
  });
});
