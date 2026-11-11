import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openCacheDatabase } from '../db/database.ts';
import { BrowserFavorites } from './favorites.ts';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

function tempCache() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-favorites-')));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'cache.sqlite');
}

const favorite = (id: string, position: number) => ({ id, url: `https://${id}.test/`, title: id, favicon: null, position });

describe('BrowserFavorites', () => {
  it('adds, updates, lists in order and removes favourites in a real database', () => {
    const cache = openCacheDatabase(tempCache());
    cleanups.unshift(() => cache.close());
    const favorites = new BrowserFavorites(cache.db);
    favorites.save({ ...favorite('b', 1), createdAt: 20 });
    favorites.save({ ...favorite('a', 0), createdAt: 10 });
    expect(favorites.list().map((f) => f.id)).toEqual(['a', 'b']);
    // Renamed and given an icon: the time it was added stays.
    favorites.save({ ...favorite('b', 1), title: 'Docs', favicon: 'data:image/png;base64,AAAA' });
    expect(favorites.list().find((f) => f.id === 'b')).toMatchObject({ title: 'Docs', favicon: 'data:image/png;base64,AAAA', createdAt: 20 });
    favorites.remove('a');
    expect(favorites.list().map((f) => f.id)).toEqual(['b']);
  });
});
