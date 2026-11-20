import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openCacheDatabase } from '../db/database.ts';
import { migrations } from '../db/migrations.ts';
import { BrowserHistory } from './history.ts';
import { PinnedTabs } from './pinnedTabs.ts';
import { BrowserProfileError, BrowserProfiles } from './profiles.ts';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

function tempDir() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-browser-profiles-')));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function open(path = join(tempDir(), 'cache.sqlite')) {
  const cache = openCacheDatabase(path);
  cleanups.unshift(() => cache.close());
  return cache;
}

describe('BrowserProfiles', () => {
  it('creates, renames, moves and lists profiles in order in a real database', () => {
    const { db } = open();
    const profiles = new BrowserProfiles(db);
    const admin = profiles.create({ name: '  Admin  ', color: 'red', projectRoot: '/work/shop' }, 10);
    const customer = profiles.create({ name: 'Customer', color: 'blue', projectRoot: null }, 20);
    expect(admin.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(profiles.list().map((p) => [p.name, p.position])).toEqual([['Admin', 0], ['Customer', 1]]);
    profiles.update(admin.id, { name: 'Shop admin', color: 'green' });
    profiles.update(customer.id, { projectRoot: '/work/blog' });
    expect(profiles.list()).toMatchObject([
      { id: admin.id, name: 'Shop admin', color: 'green', projectRoot: '/work/shop', createdAt: 10 },
      { id: customer.id, name: 'Customer', projectRoot: '/work/blog' },
    ]);
  });

  it('refuses an empty name, Default and a name another profile there answers to', () => {
    const { db } = open();
    const profiles = new BrowserProfiles(db);
    const admin = profiles.create({ name: 'Admin', color: 'red', projectRoot: '/work/shop' });
    expect(() => profiles.create({ name: '  ', color: 'red', projectRoot: null })).toThrow(BrowserProfileError);
    expect(() => profiles.create({ name: 'default', color: 'red', projectRoot: null })).toThrow(/built-in/);
    expect(() => profiles.create({ name: 'ADMIN', color: 'red', projectRoot: '/work/shop' })).toThrow(/already there/);
    // Another project may have its own Admin; moving one to everywhere would clash with it.
    const blog = profiles.create({ name: 'Admin', color: 'red', projectRoot: '/work/blog' });
    expect(() => profiles.update(blog.id, { projectRoot: null })).toThrow(/already there/);
    expect(profiles.update(admin.id, { name: 'admin' }).name).toBe('admin');
  });

  it('finds a profile by name for a project, and forgets its tabs and history when deleted', () => {
    const { db } = open();
    const profiles = new BrowserProfiles(db);
    const tabs = new PinnedTabs(db);
    const history = new BrowserHistory(db);
    const admin = profiles.create({ name: 'Admin', color: 'red', projectRoot: '/work/shop' });
    expect(profiles.find('admin', '/work/shop')).toEqual({ profile: admin });
    expect(profiles.find('admin', '/work/blog')).toEqual({ error: expect.stringContaining('Default') });
    tabs.save({ id: 'kept', owner: 'browser', url: 'https://a.test/', title: 'A', position: 0 });
    tabs.save({ id: 'gone', owner: 'browser', url: 'https://a.test/', title: 'A', position: 1, profileId: admin.id });
    history.visit('https://a.test/', 'A', true, 1);
    history.visit('https://a.test/', 'A', true, 2, admin.id);
    expect(tabs.list().find((t) => t.id === 'gone')?.profileId).toBe(admin.id);
    profiles.remove(admin.id);
    expect(profiles.list()).toEqual([]);
    expect(tabs.list().map((t) => t.id)).toEqual(['kept']);
    expect(history.search('a.test', 10, admin.id)).toEqual([]);
    expect(history.search('a.test', 10)).toHaveLength(1);
  });

  it("keeps the history and pinned tabs of a cache from before profiles, as the Default profile's", () => {
    const path = join(tempDir(), 'cache.sqlite');
    // A cache from before browser profiles (v63).
    const old = new DatabaseSync(path);
    const before = migrations.findIndex((m) => m.includes('CREATE TABLE browser_profiles'));
    for (const migration of migrations.slice(0, before)) old.exec(migration);
    old.exec(`PRAGMA user_version = ${before}`);
    old.exec("INSERT INTO browser_history (url, title, visits, last_visit) VALUES ('https://kept.test/', 'Kept', 3, 50)");
    old.exec("INSERT INTO browser_tabs (id, owner, url, title, position, pinned_at) VALUES ('t', 'browser', 'https://kept.test/', 'Kept', 0, 1)");
    old.close();
    const { db } = open(path);
    const history = new BrowserHistory(db);
    expect(history.search('kept', 10)).toEqual([{ url: 'https://kept.test/', title: 'Kept', visits: 3, lastVisit: 50 }]);
    expect(new PinnedTabs(db).list()).toMatchObject([{ id: 't', profileId: null }]);
    // The same address in another profile is a row of its own.
    history.visit('https://kept.test/', 'Other', true, 60, '3f2b8c1e-6a4d-4e7b-9c2a-1d5e8f7a6b3c');
    expect(history.search('kept', 10)[0]!.visits).toBe(3);
  });
});
