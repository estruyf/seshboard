import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openCacheDatabase, type CacheDatabase } from '../db/database.ts';
import { MemorySearch, type IndexedFolder } from './memorySearch.ts';

let base: string;
let cache: CacheDatabase;
let search: MemorySearch;
let folders: IndexedFolder[];
const memory = (dir: string, name: string, description: string, body: string, extra = '') =>
  writeFileSync(join(dir, `${name}.md`), `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  type: ${name.startsWith('u') ? 'user' : 'project'}\n${extra}---\n\n${body}\n`);

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-memory-search-')));
  cache = openCacheDatabase(join(base, 'cache.sqlite'));
  search = new MemorySearch(cache.db);
  const app = join(base, 'app');
  const personal = join(base, 'personal');
  mkdirSync(app);
  mkdirSync(personal);
  folders = [
    { dir: app, root: '/code/app', profileId: 'default' },
    { dir: personal, root: null, profileId: null },
  ];
  memory(app, 'release-process', 'npm run release, then CHANGELOG', 'Bump the version and release from main.', '  originSessionId: s-1\n');
  memory(app, 'sidebar-order', 'Needs you first', 'Then working, then by day.');
  memory(personal, 'user-writing', 'Short sentences', 'No em dashes in a release note either.');
  writeFileSync(join(app, 'MEMORY.md'), '- [release-process](release-process.md) — release\n');
});

afterEach(() => {
  cache.close();
  rmSync(base, { recursive: true, force: true });
});

describe('memory search', () => {
  it('indexes memory files (not MEMORY.md) and finds them by name, description and text', () => {
    expect(search.sync(folders)).toBe(3);
    const hits = search.search('release');
    expect(hits.map((h) => h.name)).toEqual(['release-process', 'user-writing']);
    expect(hits[0]).toMatchObject({ root: '/code/app', profileId: 'default', type: 'project', origin: 's-1' });
    expect(hits[0]!.snippet).toContain('\u0002release\u0003');
    expect(hits[1]).toMatchObject({ root: null, type: 'user' });
    expect(search.search('relea').length).toBe(2);
  });

  it('reads only files that changed, and drops the ones that are gone', () => {
    search.sync(folders);
    expect(search.sync(folders)).toBe(0);
    const path = join(folders[0]!.dir, 'sidebar-order.md');
    memory(folders[0]!.dir, 'sidebar-order', 'Pinned rows stay pinned', 'Then working.');
    utimesSync(path, new Date(), new Date(Date.now() + 5_000));
    expect(search.sync(folders)).toBe(1);
    expect(search.search('pinned').map((h) => h.name)).toEqual(['sidebar-order']);
    rmSync(path);
    search.sync(folders);
    expect(search.search('pinned')).toEqual([]);
    // A folder no longer indexed (its project removed) leaves the index.
    search.sync([folders[1]!]);
    expect(search.search('release').map((h) => h.name)).toEqual(['user-writing']);
  });

  it('filters by type and by project or the personal folder', () => {
    search.sync(folders);
    expect(search.search('release', { types: ['user'] }).map((h) => h.name)).toEqual(['user-writing']);
    expect(search.search('release', { scope: '/code/app' }).map((h) => h.name)).toEqual(['release-process']);
    expect(search.search('release', { scope: 'personal' }).map((h) => h.name)).toEqual(['user-writing']);
    expect(search.search('"')).toEqual([]);
  });

  it('finds the memories a session wrote', () => {
    search.sync(folders);
    expect(search.bySession('s-1').map((h) => h.name)).toEqual(['release-process']);
    expect(search.bySession('nope')).toEqual([]);
  });
});
