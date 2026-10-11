import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openCacheDatabase } from '../db/database.ts';
import { migrations } from '../db/migrations.ts';
import { LaterStore } from './laterStore.ts';

// Folders in this platform's form (E:\work\web on Windows), as the queue only takes absolute local paths.
const WEB = resolve('/work/web');
const API = resolve('/work/api');
const OTHER = resolve('/work/other');

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const cachePath = () => {
  const dir = mkdtempSync(join(tmpdir(), 'switchboard-later-'));
  dirs.push(dir);
  return join(dir, 'cache.sqlite');
};

describe('queue (the Later list)', () => {
  it('saves a prompt with the choices it would start with, and fills in the rest', () => {
    const cache = openCacheDatabase(cachePath());
    const later = new LaterStore(cache.db);
    const item = later.add({ cwd: WEB, prompt: 'Add a yearly overview page', model: 'opus', workspace: 'worktree', profileId: 'work' });
    expect(item).toMatchObject({
      cwd: WEB,
      prompt: 'Add a yearly overview page',
      model: 'opus',
      effort: null,
      permissionMode: 'default',
      workspace: 'worktree',
      baseRef: 'fresh',
      branch: null,
      profileId: 'work',
      position: 0,
      waitFor: { kind: 'project' },
    });
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(later.list()).toEqual([item]);
    cache.close();
  });

  it('keeps the images pasted with a prompt, and edits to them', () => {
    const cache = openCacheDatabase(cachePath());
    const later = new LaterStore(cache.db);
    const image = { type: 'image' as const, mediaType: 'image/png' as const, data: 'aGVsbG8=', name: 'screenshot.png' };
    const item = later.add({ cwd: WEB, prompt: 'Match this design', attachments: [image] });
    expect(item.attachments).toEqual([image]);
    expect(later.get(item.id)!.attachments).toEqual([image]);
    expect(later.update(item.id, { draft: { cwd: WEB, prompt: 'Match this design' } })!.attachments).toEqual([]);
    // Items queued before images could be, read without any.
    expect(later.add({ cwd: WEB, prompt: 'No images' }).attachments).toEqual([]);
    cache.close();
  });

  it('adds at the end and lists in queue order, all of them or one project', () => {
    const cache = openCacheDatabase(cachePath());
    const later = new LaterStore(cache.db);
    // Queue order, not age: the newest was added first.
    const a = later.add({ cwd: WEB, prompt: 'First' }, { createdAt: 3 });
    const b = later.add({ cwd: API, prompt: 'Second' }, { createdAt: 2 });
    const c = later.add({ cwd: WEB, prompt: 'Third' }, { createdAt: 1 });
    expect(later.list().map((i) => [i.id, i.position])).toEqual([
      [a.id, 0],
      [b.id, 1],
      [c.id, 2],
    ]);
    expect(later.list(WEB).map((i) => i.prompt)).toEqual(['First', 'Third']);
    expect(later.list(API).map((i) => i.prompt)).toEqual(['Second']);
    expect(later.list(OTHER)).toEqual([]);
    cache.close();
  });

  it('reorders, clamping the index, and keeps positions 0..n-1', () => {
    const cache = openCacheDatabase(cachePath());
    const later = new LaterStore(cache.db);
    const [a, , c] = ['A', 'B', 'C'].map((prompt) => later.add({ cwd: WEB, prompt }));
    expect(later.reorder(c!.id, 0)).toBe(true);
    expect(later.list().map((i) => i.prompt)).toEqual(['C', 'A', 'B']);
    expect(later.reorder(c!.id, 99)).toBe(true);
    expect(later.list().map((i) => i.prompt)).toEqual(['A', 'B', 'C']);
    later.reorder(a!.id, 1);
    expect(later.list().map((i) => [i.prompt, i.position])).toEqual([
      ['B', 0],
      ['A', 1],
      ['C', 2],
    ]);
    expect(later.reorder('missing', 0)).toBe(false);
    cache.close();
  });

  it('changes what an item waits for, and defaults to its project', () => {
    const cache = openCacheDatabase(cachePath());
    const later = new LaterStore(cache.db);
    const first = later.add({ cwd: WEB, prompt: 'First' });
    const second = later.add({ cwd: WEB, prompt: 'Second' }, { waitFor: { kind: 'item', itemId: first.id } });
    expect(first.waitFor).toEqual({ kind: 'project' });
    expect(second.waitFor).toEqual({ kind: 'item', itemId: first.id });
    expect(later.update(first.id, { waitFor: { kind: 'session', sessionId: 's-1' } })?.waitFor).toEqual({ kind: 'session', sessionId: 's-1' });
    expect(later.update(first.id, { waitFor: { kind: 'none' } })?.waitFor).toEqual({ kind: 'none' });
    expect(later.update(first.id, { waitFor: { kind: 'project' } })?.waitFor).toEqual({ kind: 'project' });
    expect(later.update('missing', { waitFor: { kind: 'none' } })).toBeNull();
    cache.close();
  });

  it('edits an item in its place, keeping its age and what it waits for', () => {
    const cache = openCacheDatabase(cachePath());
    const later = new LaterStore(cache.db);
    const first = later.add({ cwd: WEB, prompt: 'First' }, { waitFor: { kind: 'none' } });
    const second = later.add({ cwd: WEB, prompt: 'Second' });
    const edited = later.update(first.id, { draft: { cwd: API, prompt: 'First, edited', model: 'opus', permissionMode: 'plan' } });
    expect(edited).toMatchObject({ id: first.id, cwd: API, prompt: 'First, edited', model: 'opus', permissionMode: 'plan', createdAt: first.createdAt, waitFor: { kind: 'none' } });
    expect(later.list().map((i) => i.id)).toEqual([first.id, second.id]);
    expect(later.update('missing', { draft: { cwd: WEB, prompt: 'Gone' } })).toBeNull();
    cache.close();
  });

  it('takes a started item off the queue and remembers its session while another item waits on it', () => {
    const cache = openCacheDatabase(cachePath());
    const later = new LaterStore(cache.db);
    const first = later.add({ cwd: WEB, prompt: 'First' });
    const second = later.add({ cwd: WEB, prompt: 'Second' }, { waitFor: { kind: 'item', itemId: first.id } });
    const third = later.add({ cwd: WEB, prompt: 'Third' });
    later.started(first.id, 'session-1');
    expect(later.list().map((i) => [i.prompt, i.position])).toEqual([
      ['Second', 0],
      ['Third', 1],
    ]);
    expect(later.startedLinks()).toEqual([{ itemId: first.id, sessionId: 'session-1' }]);
    // Nothing waits on the third one: its link isn't kept.
    later.started(third.id, 'session-3');
    expect(later.startedLinks()).toEqual([{ itemId: first.id, sessionId: 'session-1' }]);
    later.started(second.id, 'session-2');
    expect(later.list()).toEqual([]);
    expect(later.startedLinks()).toEqual([]);
    cache.close();
  });

  it('removes an item, and Undo puts it back in its place', () => {
    const cache = openCacheDatabase(cachePath());
    const later = new LaterStore(cache.db);
    const older = later.add({ cwd: WEB, prompt: 'Older' }, { createdAt: 1 });
    const removed = later.add({ cwd: WEB, prompt: 'Middle', effort: 'high' }, { createdAt: 2, waitFor: { kind: 'none' } });
    later.add({ cwd: WEB, prompt: 'Newer' }, { createdAt: 3 });
    later.remove(removed.id);
    expect(later.list().map((i) => [i.prompt, i.position])).toEqual([
      ['Older', 0],
      ['Newer', 1],
    ]);
    const { id, createdAt, position, waitFor, ...draft } = removed;
    expect(later.add(draft, { id, createdAt, index: position, waitFor })).toEqual(removed);
    expect(later.list().map((i) => i.prompt)).toEqual(['Older', 'Middle', 'Newer']);
    // Removing something that is already gone is fine.
    later.remove('missing');
    later.remove(older.id);
    expect(later.list()).toHaveLength(2);
    cache.close();
  });

  it('refuses an empty prompt or a relative folder', () => {
    const cache = openCacheDatabase(cachePath());
    const later = new LaterStore(cache.db);
    expect(() => later.add({ cwd: WEB, prompt: '   ' })).toThrow();
    expect(() => later.add({ cwd: 'work/web', prompt: 'Hi' })).toThrow();
    expect(later.list()).toEqual([]);
    cache.close();
  });

  it('turns saved prompts into queue items, oldest first, when upgrading', () => {
    const path = cachePath();
    const old = new DatabaseSync(path);
    for (const migration of migrations.slice(0, 15)) old.exec(migration);
    old.exec('PRAGMA user_version = 15');
    const insert = old.prepare('INSERT INTO later_prompts (id, cwd, prompt, settings_json, created_at) VALUES (?, ?, ?, ?, ?)');
    insert.run('newest', WEB, 'Newest', '{"model":"opus"}', 30);
    insert.run('oldest', API, 'Oldest', '{}', 10);
    insert.run('b-middle', WEB, 'Middle B', '{"workspace":"worktree"}', 20);
    insert.run('a-middle', WEB, 'Middle A', '{}', 20);
    old.close();
    const cache = openCacheDatabase(path);
    const items = new LaterStore(cache.db).list();
    expect(items.map((i) => [i.id, i.position, i.waitFor.kind])).toEqual([
      ['oldest', 0, 'project'],
      ['a-middle', 1, 'project'],
      ['b-middle', 2, 'project'],
      ['newest', 3, 'project'],
    ]);
    expect(items.find((i) => i.id === 'newest')).toMatchObject({ model: 'opus', createdAt: 30 });
    expect(items.find((i) => i.id === 'b-middle')).toMatchObject({ workspace: 'worktree' });
    cache.close();
  });

  it('survives a cache rebuild and a restart', () => {
    const path = cachePath();
    const first = openCacheDatabase(path);
    const store = new LaterStore(first.db);
    const saved = store.add({ cwd: WEB, prompt: 'Keep me', branch: 'feature/a' });
    const after = store.add({ cwd: WEB, prompt: 'After it' }, { waitFor: { kind: 'item', itemId: saved.id } });
    store.reorder(after.id, 0);
    // What a rebuild throws away: the session cache and the search index, all derived from ~/.claude.
    first.db.exec('DELETE FROM sessions; DELETE FROM transcript_fts; DELETE FROM transcript_indexed;');
    first.close();
    const second = openCacheDatabase(path);
    expect(new LaterStore(second.db).list()).toEqual([
      { ...after, position: 0 },
      { ...saved, position: 1 },
    ]);
    second.close();
  });

  it('skips a row it cannot read instead of failing the list', () => {
    const cache = openCacheDatabase(cachePath());
    const later = new LaterStore(cache.db);
    later.add({ cwd: WEB, prompt: 'Fine' }, { createdAt: 1 });
    const insert = cache.db.prepare('INSERT INTO later_prompts (id, cwd, prompt, settings_json, created_at, position, wait_json) VALUES (?, ?, ?, ?, ?, ?, ?)');
    insert.run('odd', WEB, 'Odd', '{"permissionMode":"sideways"}', 5, 1, null);
    insert.run('broken', WEB, 'Broken', 'not json', 6, 2, null);
    insert.run('odd-wait', WEB, 'Odd wait', '{}', 7, 3, '{"kind":"someday"}');
    // Unreadable settings fall back to the defaults; an invalid value drops the row; an unknown wait is the project.
    expect(later.list().map((i) => [i.prompt, i.waitFor.kind])).toEqual([
      ['Fine', 'project'],
      ['Broken', 'project'],
      ['Odd wait', 'project'],
    ]);
    cache.close();
  });
});
