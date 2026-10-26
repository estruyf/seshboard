import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppStateStore } from '../db/appState.ts';
import { openCacheDatabase } from '../db/database.ts';
import { ProfileStore, readProfileDefaults } from './profileStore.ts';

const unset = { model: null, effort: null, permissionMode: null, workspace: null, baseRef: null };

let base: string;
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-profile-defaults-')));
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('profile defaults', () => {
  it('start unset, are saved per profile and survive reopening the cache', () => {
    const path = join(base, 'cache.sqlite');
    const builtin = { configDir: join(base, '.claude'), fromEnv: false };
    let cache = openCacheDatabase(path);
    let work: string;
    try {
      const changes: unknown[] = [];
      const store = new ProfileStore(cache.db, createAppStateStore(cache.db), builtin, (snapshot) => changes.push(snapshot));
      work = store.add('Work', 'blue', join(base, 'work'));
      expect(store.snapshot().profiles.map((p) => p.defaults)).toEqual([unset, unset]);
      store.setDefaults(work, { ...unset, model: 'opus', permissionMode: 'plan', workspace: 'worktree' });
      expect(changes.length).toBe(2);
      expect(() => store.setDefaults('missing', unset)).toThrow(/No such profile/);
    } finally {
      cache.close();
    }
    cache = openCacheDatabase(path);
    try {
      const store = new ProfileStore(cache.db, createAppStateStore(cache.db), builtin);
      const { profiles } = store.snapshot();
      expect(profiles.find((p) => p.id === work)?.defaults).toEqual({ ...unset, model: 'opus', permissionMode: 'plan', workspace: 'worktree' });
      expect(profiles.find((p) => p.builtin)?.defaults).toEqual(unset);
      // Clearing every field stores nothing.
      store.setDefaults(work, unset);
      expect(store.snapshot().profiles.find((p) => p.id === work)?.defaults).toEqual(unset);
    } finally {
      cache.close();
    }
  });

  it('read leniently: a field that no longer validates is unset, and a branch is never kept', () => {
    expect(readProfileDefaults(null)).toEqual(unset);
    expect(readProfileDefaults('not json')).toEqual(unset);
    expect(readProfileDefaults(JSON.stringify({ model: 'sonnet', effort: 'sideways', branch: 'main' }))).toEqual({ ...unset, model: 'sonnet' });
  });
});
