import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PromptScope } from '@seshboard/protocol';
import { openCacheDatabase } from '../db/database.ts';
import { SharedFileWatcher } from '../actions/sharedFileWatcher.ts';
import { ActionStore } from '../actions/actionStore.ts';
import { SavedPromptStore } from './savedPromptStore.ts';

const dirs: string[] = [];
const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});
const tempDir = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-prompts-')));
  dirs.push(dir);
  return dir;
};

function setup() {
  const cache = openCacheDatabase(join(tempDir(), 'cache.sqlite'));
  cleanups.push(() => cache.close());
  const project = tempDir();
  const other = tempDir();
  return { store: new SavedPromptStore(cache.db), actions: new ActionStore(cache.db), project, other, file: join(project, '.seshboard.json') };
}

const global: PromptScope = { kind: 'global' };
const personal = (root: string): PromptScope => ({ kind: 'personal', root });
const shared = (root: string): PromptScope => ({ kind: 'shared', root });
const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;

describe('SavedPromptStore', () => {
  it('saves, lists and deletes in all three places', () => {
    const { store, project, other, file } = setup();
    const a = store.save({ name: 'Implement issue', text: 'Start implementing {{issue:issue}}', scope: global }, 1);
    const b = store.save({ name: 'Fix PR', text: 'Fix {{pr:pr}}', scope: personal(project) }, 2);
    const c = store.save({ name: 'Fix failing test', text: 'Fix {{test}}', scope: shared(project) }, 3);
    expect([a.id, b.id, c.id]).toEqual(['implement-issue', 'fix-pr', 'fix-failing-test']);
    expect(readJson(file)).toEqual({ prompts: [{ id: 'fix-failing-test', name: 'Fix failing test', text: 'Fix {{test}}' }] });

    expect(store.list().prompts.map((p) => p.id)).toEqual(['implement-issue']);
    expect(store.list(project).prompts.map((p) => [p.id, p.scope.kind])).toEqual(
      expect.arrayContaining([
        ['implement-issue', 'global'],
        ['fix-pr', 'personal'],
        ['fix-failing-test', 'shared'],
      ]),
    );
    // Another project sees only the global ones.
    expect(store.list(other).prompts.map((p) => p.id)).toEqual(['implement-issue']);

    // Updating keeps the id and its place.
    store.save({ id: 'fix-failing-test', name: 'Fix the failing test', text: 'Fix {{test}} now', scope: shared(project) });
    expect(readJson(file)).toEqual({ prompts: [{ id: 'fix-failing-test', name: 'Fix the failing test', text: 'Fix {{test}} now' }] });

    store.remove('implement-issue', global);
    store.remove('fix-pr', personal(project));
    store.remove('fix-failing-test', shared(project));
    expect(store.list(project).prompts).toEqual([]);
    expect(readJson(file)).toEqual({});
  });

  it('gives a second prompt with the same name its own id', () => {
    const { store } = setup();
    store.save({ name: 'Review', text: 'Review it', scope: global });
    expect(store.save({ name: 'Review', text: 'Review it again', scope: global }).id).toBe('review-2');
  });

  it('keeps unknown keys, the indent and the order of the shared file', () => {
    const { store, project, file, actions } = setup();
    writeFileSync(
      file,
      `${JSON.stringify(
        {
          iconPath: 'logo.svg',
          actions: [{ name: 'Test', command: 'npm test' }],
          prompts: [{ text: 'Keep {{this}}', name: 'Keep', team: 'web' }],
          custom: { a: 1 },
        },
        null,
        4,
      )}\n`,
    );
    store.save({ id: 'keep', name: 'Keep it', text: 'Keep {{this}} too', scope: shared(project) });
    store.save({ name: 'Another', text: 'Another one', scope: shared(project) });
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('\n    "iconPath"');
    expect(text.endsWith('}\n')).toBe(true);
    expect(Object.keys(readJson(file))).toEqual(['iconPath', 'actions', 'prompts', 'custom']);
    expect(readJson(file).prompts).toEqual([
      { id: 'keep', name: 'Keep it', text: 'Keep {{this}} too', team: 'web' },
      { id: 'another', name: 'Another', text: 'Another one' },
    ]);
    // The actions in the same file still read.
    expect(actions.list(project).actions.map((a) => a.id)).toEqual(['test']);
  });

  it('reports shared entries that do not read and keeps the others', () => {
    const { store, project, file } = setup();
    writeFileSync(file, JSON.stringify({ prompts: [{ name: 'Ok', text: 'Fine' }, { name: 'No text' }, { name: 'Ok', text: 'Same id' }] }));
    const { prompts, errors } = store.list(project);
    expect(prompts.map((p) => p.id)).toEqual(['ok']);
    expect(errors).toEqual(['.seshboard.json prompt 2: it needs a "text" of up to 20,000 characters', '.seshboard.json prompt 3: another prompt has the id "ok"']);
  });

  it('moves between every two places, and to another project', () => {
    const { store, project, other, file } = setup();
    store.save({ name: 'Fix PR', text: 'Fix {{pr:pr}}', scope: global });
    const places = [global, personal(project), shared(project), personal(other), shared(other), global];
    for (let i = 1; i < places.length; i++) {
      const moved = store.move('fix-pr', places[i - 1]!, places[i]!);
      expect(moved.scope).toEqual(places[i]);
      const everywhere = [...store.list(project).prompts, ...store.list(other).prompts.filter((p) => p.scope.kind !== 'global')];
      expect(everywhere.filter((p) => p.id === 'fix-pr').map((p) => p.scope)).toEqual([places[i]]);
    }
    store.move('fix-pr', global, shared(project));
    store.move('fix-pr', shared(project), global);
    expect(readJson(file)).toEqual({});
    expect(readJson(join(other, '.seshboard.json'))).toEqual({});
  });

  it('loses nothing when a move fails on the way', () => {
    const { store, project, file } = setup();
    store.save({ name: 'Fix PR', text: 'Fix {{pr:pr}}', scope: personal(project) });
    // The target can't be written: a file someone broke.
    writeFileSync(file, '{ "actions": [ ');
    expect(() => store.move('fix-pr', personal(project), shared(project))).toThrow(/can't be read, so Seshboard won't overwrite it/);
    expect(readFileSync(file, 'utf8')).toBe('{ "actions": [ ');
    expect(store.list(project).prompts.map((p) => p.scope.kind)).toEqual(['personal']);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('puts the copy back when the original cannot be taken out', () => {
    const { store, project } = setup();
    store.save({ name: 'Fix PR', text: 'Fix {{pr:pr}}', scope: shared(project) });
    // The project folder turns read-only: the shared file can't be rewritten any more.
    chmodSync(project, 0o555);
    cleanups.unshift(() => chmodSync(project, 0o755));
    expect(() => store.move('fix-pr', shared(project), global)).toThrow(/Couldn't move “Fix PR” out of the project's \.seshboard\.json\. The project's \.seshboard\.json can't be written/);
    chmodSync(project, 0o755);
    expect(store.list(project).prompts.map((p) => p.scope.kind)).toEqual(['shared']);
  });

  it('counts uses without touching the shared file', () => {
    const { store, project, file } = setup();
    store.save({ name: 'Global', text: 'g', scope: global });
    store.save({ name: 'Shared', text: 's', scope: shared(project) });
    const before = readFileSync(file, 'utf8');
    const mtime = statSync(file).mtimeMs;
    store.used('shared', shared(project), 100);
    store.used('shared', shared(project), 200);
    store.used('global', global, 150);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(statSync(file).mtimeMs).toBe(mtime);
    const listed = store.list(project).prompts;
    expect(listed.map((p) => [p.id, p.uses, p.lastUsedAt])).toEqual([
      ['shared', 2, 200],
      ['global', 1, 150],
    ]);
    // The count goes along when it moves, and back.
    store.move('shared', shared(project), personal(project));
    expect(store.list(project).prompts.find((p) => p.id === 'shared')).toMatchObject({ uses: 2, lastUsedAt: 200 });
    store.move('shared', personal(project), shared(project));
    expect(store.list(project).prompts.find((p) => p.id === 'shared')).toMatchObject({ uses: 2, scope: { kind: 'shared' } });
    expect(readJson(file)).toEqual({ prompts: [{ id: 'shared', name: 'Shared', text: 's' }] });
  });

  it('survives reopening the database', () => {
    const data = tempDir();
    const first = openCacheDatabase(join(data, 'cache.sqlite'));
    new SavedPromptStore(first.db).save({ name: 'Kept', text: 'k', scope: global });
    first.close();
    const second = openCacheDatabase(join(data, 'cache.sqlite'));
    cleanups.push(() => second.close());
    expect(new SavedPromptStore(second.db).list().prompts.map((p) => p.name)).toEqual(['Kept']);
  });
});

describe('SharedFileWatcher', () => {
  it('tells when the shared file changes, and not for other files', async () => {
    const project = tempDir();
    const changes: string[] = [];
    const watcher = new SharedFileWatcher((root) => changes.push(root));
    cleanups.push(() => watcher.close());
    watcher.watch(project);
    writeFileSync(join(project, 'notes.txt'), 'x');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(changes).toEqual([]);
    writeFileSync(join(project, '.seshboard.json'), JSON.stringify({ prompts: [{ name: 'Pulled', text: 'From a pull' }] }));
    await expect.poll(() => changes, { timeout: 3_000 }).toEqual([project]);
  });
});
