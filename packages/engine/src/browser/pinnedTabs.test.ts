import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openCacheDatabase } from '../db/database.ts';
import { BROWSER_OWNER, PinnedTabs } from './pinnedTabs.ts';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

function tempCache() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-tabs-')));
  const file = join(dir, 'cache.sqlite');
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return file;
}

const tab = (id: string, owner: string, position: number, url = `https://github.com/${id}`) => ({ id, owner, url, title: id, position });

describe('PinnedTabs', () => {
  it('saves, updates, removes and reorders tabs in a real database', () => {
    const cache = openCacheDatabase(tempCache());
    cleanups.unshift(() => cache.close());
    const tabs = new PinnedTabs(cache.db);
    tabs.save({ ...tab('a', 's1', 0), pinnedAt: 10 });
    tabs.save(tab('b', 's1', 1));
    tabs.save(tab('c', BROWSER_OWNER, 0));
    // Browsing on: the address and title change, the pin time stays.
    tabs.save({ ...tab('a', 's1', 0, 'https://github.com/a/pull/2'), title: 'PR 2' });
    const a = tabs.list().find((t) => t.id === 'a')!;
    expect(a).toMatchObject({ url: 'https://github.com/a/pull/2', title: 'PR 2', name: null, pinnedAt: 10 });
    // A name of your own stays until it is cleared.
    tabs.save({ ...tab('a', 's1', 0, 'https://github.com/a/pull/2'), name: 'Review' });
    expect(tabs.list().find((t) => t.id === 'a')!.name).toBe('Review');
    tabs.save({ ...tab('a', 's1', 0, 'https://github.com/a/pull/2'), name: null });
    expect(tabs.list().find((t) => t.id === 'a')!.name).toBeNull();
    // Its icon, for the start before the page loads.
    expect(tabs.list().find((t) => t.id === 'a')!.favicon).toBeNull();
    tabs.save({ ...tab('a', 's1', 0, 'https://github.com/a/pull/2'), favicon: 'data:image/png;base64,AAAA' });
    expect(tabs.list().find((t) => t.id === 'a')!.favicon).toBe('data:image/png;base64,AAAA');

    tabs.reorder('s1', ['b', 'a', 'unknown']);
    expect(tabs.list().filter((t) => t.owner === 's1').map((t) => t.id)).toEqual(['b', 'a']);
    // Another owner's tab isn't moved by a reorder that names it.
    tabs.reorder('s1', ['c']);
    expect(tabs.list().find((t) => t.id === 'c')!.position).toBe(0);

    tabs.remove('b');
    expect(tabs.list().map((t) => t.id).sort()).toEqual(['a', 'c']);
  });

  it('keeps the tabs when the cache is opened again', () => {
    const file = tempCache();
    const first = openCacheDatabase(file);
    new PinnedTabs(first.db).save(tab('a', 's1', 0));
    first.close();
    const again = openCacheDatabase(file);
    cleanups.unshift(() => again.close());
    expect(new PinnedTabs(again.db).list().map((t) => t.id)).toEqual(['a']);
  });

  it("keeps an archived session's tabs and drops a deleted or unknown session's", () => {
    const cache = openCacheDatabase(tempCache());
    cleanups.unshift(() => cache.close());
    const tabs = new PinnedTabs(cache.db);
    tabs.save(tab('kept', 'archived', 0));
    tabs.save(tab('deleted', 'gone', 0));
    tabs.save(tab('stale', 'unknown', 0));
    tabs.save(tab('view', BROWSER_OWNER, 0));
    // Archiving changes nothing here; deleting forgets the session's tabs.
    tabs.forget('gone');
    // The Browser view's tabs are never forgotten with a session.
    tabs.forget(BROWSER_OWNER);
    expect(tabs.list().map((t) => t.id).sort()).toEqual(['kept', 'stale', 'view']);
    // At the next start, a session nobody knows any more goes.
    expect(tabs.prune((id) => id === 'archived')).toEqual(['unknown']);
    expect(tabs.list().map((t) => t.id).sort()).toEqual(['kept', 'view']);
  });
});
