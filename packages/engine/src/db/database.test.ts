import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppStateStore } from './appState.ts';
import { isCorruptionError, openCacheDatabase, schemaVersion } from './database.ts';
import { migrations } from './migrations.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'switchboard-db-'));
  dirs.push(dir);
  return dir;
};

describe('cache database', () => {
  it('creates the full schema and records its version', () => {
    const cache = openCacheDatabase(join(tempDir(), 'cache.sqlite'));
    expect(schemaVersion(cache.db)).toBe(migrations.length);
    const tables = (cache.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(['projects', 'sessions', 'transcript_fts', 'transcript_indexed', 'project_actions', 'trusted_commands', 'app_state']));
    expect(cache.recovered).toBe(false);
    cache.close();
  });

  it('reopens an existing database without re-running migrations', () => {
    const path = join(tempDir(), 'cache.sqlite');
    const first = openCacheDatabase(path);
    createAppStateStore(first.db).set('k', 1);
    first.close();
    const second = openCacheDatabase(path);
    expect(createAppStateStore(second.db).get('k')).toBe(1);
    expect(second.recovered).toBe(false);
    second.close();
  });

  it('moves a corrupt file aside and rebuilds', () => {
    const dir = tempDir();
    const path = join(dir, 'cache.sqlite');
    writeFileSync(path, 'this is not a sqlite file, just garbage bytes '.repeat(200));
    const cache = openCacheDatabase(path);
    expect(cache.recovered).toBe(true);
    expect(schemaVersion(cache.db)).toBe(migrations.length);
    expect(readdirSync(dir).some((f) => f.startsWith('cache.sqlite.broken-'))).toBe(true);
    expect(cache.fallback).toBeNull();
    cache.close();
  });

  it('moves the WAL along with a corrupt file instead of deleting it', () => {
    const dir = tempDir();
    const path = join(dir, 'cache.sqlite');
    writeFileSync(path, 'garbage '.repeat(500));
    writeFileSync(`${path}-wal`, 'recent commits');
    const cache = openCacheDatabase(path);
    expect(cache.recovered).toBe(true);
    const aside = readdirSync(dir).find((f) => /^cache\.sqlite\.broken-\d+$/.test(f))!;
    expect(readFileSync(join(dir, `${aside}-wal`), 'utf8')).toBe('recent commits');
    cache.close();
  });

  it('leaves a cache from a newer build untouched and works on a side file', () => {
    const dir = tempDir();
    const path = join(dir, 'cache.sqlite');
    const newer = openCacheDatabase(path);
    newer.db.exec("INSERT INTO owned_sessions (id, created_at) VALUES ('mine', 1)");
    newer.db.exec(`PRAGMA user_version = ${migrations.length + 1}`);
    newer.close();

    const older = openCacheDatabase(path);
    expect(older.recovered).toBe(false);
    expect(older.fallback).toMatchObject({ newerSchema: migrations.length + 1 });
    expect(older.path).not.toBe(path);
    expect(schemaVersion(older.db)).toBe(migrations.length);
    older.db.exec("INSERT INTO owned_sessions (id, created_at) VALUES ('side', 2)");
    older.close();
    expect(readdirSync(dir).some((f) => f.includes('broken'))).toBe(false);

    // The newer build finds its file, and the user's choices in it, as it left them.
    const raw = new DatabaseSync(path);
    expect(schemaVersion(raw)).toBe(migrations.length + 1);
    expect(raw.prepare('SELECT id FROM owned_sessions').all()).toEqual([{ id: 'mine' }]);
    raw.close();

    // The older build keeps its side file between launches.
    const again = openCacheDatabase(path);
    expect(again.db.prepare('SELECT id FROM owned_sessions').all()).toEqual([{ id: 'side' }]);
    again.close();
  });

  it('keeps the file when a migration fails, instead of treating it as corrupt', () => {
    const dir = tempDir();
    const path = join(dir, 'cache.sqlite');
    const old = new DatabaseSync(path);
    for (const migration of migrations.slice(0, 2)) old.exec(migration);
    old.exec('PRAGMA user_version = 2');
    // v3 creates owned_sessions; a table already in the way makes that migration fail.
    old.exec('CREATE TABLE owned_sessions (id TEXT)');
    old.close();
    const cache = openCacheDatabase(path);
    expect(cache.recovered).toBe(false);
    expect(cache.fallback).toMatchObject({ newerSchema: null });
    cache.close();
    const raw = new DatabaseSync(path);
    expect(schemaVersion(raw)).toBe(2);
    raw.close();
    // Every migration runs again in the side file; on a busy Windows runner that has taken 9s.
  }, 30_000);

  it('tells corruption apart from other SQLite errors', () => {
    expect(isCorruptionError({ errcode: 26, message: 'file is not a database' })).toBe(true);
    expect(isCorruptionError({ errcode: 11 | (1 << 8), message: 'x' })).toBe(true);
    expect(isCorruptionError({ errcode: 5, message: 'database is locked' })).toBe(false);
    expect(isCorruptionError(new Error('Cache schema v99 is newer than this build'))).toBe(false);
  });

  it('folds settled and archived sessions into one archived moment, the later of the two', () => {
    const path = join(tempDir(), 'cache.sqlite');
    const old = new DatabaseSync(path);
    for (const migration of migrations.slice(0, 12)) old.exec(migration);
    old.exec('PRAGMA user_version = 12');
    old.exec("INSERT INTO session_flags (id, pinned, settled_at, archived_at) VALUES ('a', 1, NULL, NULL), ('b', 0, 42, NULL), ('c', 0, NULL, 7), ('d', 0, 3, 9)");
    old.close();
    const cache = openCacheDatabase(path);
    expect(cache.db.prepare('SELECT id, pinned, archived_at FROM session_flags ORDER BY id').all()).toEqual([
      { id: 'a', pinned: 1, archived_at: null },
      { id: 'b', pinned: 0, archived_at: 42 },
      { id: 'c', pinned: 0, archived_at: 7 },
      { id: 'd', pinned: 0, archived_at: 9 },
    ]);
    cache.close();
  });

  it('supports full-text search', () => {
    const cache = openCacheDatabase(join(tempDir(), 'cache.sqlite'));
    cache.db.prepare('INSERT INTO transcript_fts (session_id, uuid, role, at, text) VALUES (?, ?, ?, ?, ?)').run('s1', 'u1', 'user', null, 'Please rewind the worktree changes');
    const hits = cache.db.prepare("SELECT session_id FROM transcript_fts WHERE transcript_fts MATCH 'rewinding'").all();
    expect(hits).toEqual([{ session_id: 's1' }]);
    cache.close();
  });
});

describe('app state', () => {
  it('round-trips JSON values and returns null for missing keys', () => {
    const cache = openCacheDatabase(join(tempDir(), 'cache.sqlite'));
    const state = createAppStateStore(cache.db);
    expect(state.get('missing')).toBeNull();
    state.set('prefs', { editor: 'vscode', recent: ['/a', '/b'], zoom: 1.1, compact: false });
    expect(state.get('prefs')).toEqual({ editor: 'vscode', recent: ['/a', '/b'], zoom: 1.1, compact: false });
    state.set('prefs', 'replaced');
    expect(state.get('prefs')).toBe('replaced');
    cache.close();
  });
});
