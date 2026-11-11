import { describe, expect, it } from 'vitest';
import type { BrowserFavorite } from '@seshboard/protocol/client';
import { favoriteOf, FAVICON_KEEP_MAX, keptFavicon, newFavorite } from './favorites.ts';

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

  it('keeps only a small data: image as the icon', () => {
    expect(keptFavicon('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(keptFavicon('https://github.com/favicon.ico')).toBeNull();
    expect(keptFavicon(`data:image/png;base64,${'A'.repeat(FAVICON_KEEP_MAX)}`)).toBeNull();
    expect(keptFavicon(null)).toBeNull();
  });
});
