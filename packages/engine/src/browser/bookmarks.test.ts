import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openCacheDatabase } from '../db/database.ts';
import { BrowserBookmarks } from './bookmarks.ts';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

function tempCache() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-bookmarks-')));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'cache.sqlite');
}

const bookmark = (id: string, position: number, projectRoot: string | null = null) => ({ id, url: `https://${id}.test/`, title: id, favicon: null, folder: '', projectRoot, position });

describe('BrowserBookmarks', () => {
  it('adds, updates, lists in order and removes bookmarks in a real database', () => {
    const cache = openCacheDatabase(tempCache());
    cleanups.unshift(() => cache.close());
    const bookmarks = new BrowserBookmarks(cache.db);
    bookmarks.save({ ...bookmark('b', 1, '/work/intranet'), createdAt: 20 });
    bookmarks.save({ ...bookmark('a', 0), createdAt: 10 });
    expect(bookmarks.list().map((b) => b.id)).toEqual(['a', 'b']);
    expect(bookmarks.list().find((b) => b.id === 'b')).toMatchObject({ projectRoot: '/work/intranet', folder: '' });
    // Renamed, moved to a folder and to everywhere: the time it was added stays.
    bookmarks.save({ ...bookmark('b', 1), title: 'Staging', folder: 'Sites' });
    expect(bookmarks.list().find((b) => b.id === 'b')).toMatchObject({ title: 'Staging', folder: 'Sites', projectRoot: null, createdAt: 20 });
    bookmarks.remove('a');
    expect(bookmarks.list().map((b) => b.id)).toEqual(['b']);
  });
});
