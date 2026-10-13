import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openCacheDatabase } from '../db/database.ts';
import { UpNextStore, type StoredUpNext } from './upNextStore.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const cachePath = () => {
  const dir = mkdtempSync(join(tmpdir(), 'switchboard-upnext-'));
  dirs.push(dir);
  return join(dir, 'cache.sqlite');
};

const image = { type: 'image' as const, mediaType: 'image/png' as const, data: 'AAAA', name: 'shot.png' };
const message = (id: string, extra: Partial<StoredUpNext> = {}): StoredUpNext => ({ id, text: `Message ${id}`, attachments: [], createdAt: 1, ...extra });

describe('Up next store', () => {
  it('keeps each session’s messages in order, with their images, across a reopen', () => {
    const path = cachePath();
    const first = openCacheDatabase(path);
    new UpNextStore(first.db).save('s1', [message('b', { attachments: [image] }), message('a')]);
    first.db.close();

    const store = new UpNextStore(openCacheDatabase(path).db);
    expect(store.list('s1')).toEqual([message('b', { attachments: [image] }), message('a')]);
    // The window gets the images by name only.
    expect(store.all()).toEqual([{ sessionId: 's1', queue: [{ id: 'b', text: 'Message b', attachments: ['shot.png'], createdAt: 1 }, { id: 'a', text: 'Message a', attachments: [], createdAt: 1 }] }]);
  });

  it('replaces a session’s list, and an empty list removes it', () => {
    const store = new UpNextStore(openCacheDatabase(cachePath()).db);
    store.save('s1', [message('a'), message('b')]);
    store.save('s2', [message('c')]);
    store.save('s1', [message('b')]);
    expect(store.list('s1').map((m) => m.id)).toEqual(['b']);
    store.save('s1', []);
    expect(store.list('s1')).toEqual([]);
    expect(store.all().map((q) => q.sessionId)).toEqual(['s2']);
  });
});
