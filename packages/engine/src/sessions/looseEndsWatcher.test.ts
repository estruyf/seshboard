import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GitLooseEnd } from '@seshboard/protocol';
import { openCacheDatabase } from '../db/database.ts';
import type { RepoFacts } from './looseEnds.ts';
import { LooseEndsStore, LooseEndsWatcher } from './looseEndsWatcher.ts';

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-loose-watch-')));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const ROOT = '/work/app';
const facts = (uncommitted: number, unpushed: number): RepoFacts => ({
  root: ROOT,
  baseBranch: 'main',
  checkouts: [{ path: ROOT, branch: 'feat/x', uncommitted, unpushed }],
  pullRequests: new Map(),
  failing: new Map(),
});

describe('LooseEndsWatcher', () => {
  it('finds loose ends, says when they change, keeps them across a restart, and keeps what it can’t know', async () => {
    const db = openCacheDatabase(join(dir, 'cache.sqlite'));
    const emitted: Array<Record<string, readonly GitLooseEnd[]>> = [];
    let next: { facts: RepoFacts | null; github: boolean } = { facts: facts(2, 1), github: true };
    const make = () =>
      new LooseEndsWatcher(
        {
          repos: () => [{ root: ROOT, sessions: [{ id: 's', cwd: ROOT, branch: 'feat/x', updatedAt: 1 }] }],
          facts: async () => next,
          ownerOf: (id) => id,
          emit: (map) => void emitted.push(Object.fromEntries(map)),
        },
        new LooseEndsStore(db.db),
      );
    const watcher = make();
    await watcher.refresh();
    expect(emitted).toEqual([{ s: [{ kind: 'uncommitted', files: 2 }, { kind: 'unpushed', commits: 1 }] }]);
    await watcher.refresh();
    expect(emitted).toHaveLength(1);
    watcher.close();

    // A restart starts from what was found; gh offline keeps "not pushed", git's own changes are read again.
    const again = make();
    expect(again.owners()).toEqual(new Set(['s']));
    next = { facts: facts(0, 0), github: false };
    await again.refresh();
    expect(Object.fromEntries(again.all())).toEqual({ s: [{ kind: 'unpushed', commits: 1 }] });
    // git failing keeps everything; then a full answer clears it.
    next = { facts: null, github: false };
    await again.refresh();
    expect(again.owners()).toEqual(new Set(['s']));
    next = { facts: facts(0, 0), github: true };
    await again.refresh();
    expect(again.owners()).toEqual(new Set());
    expect(emitted.at(-1)).toEqual({});
    again.close();
  });
});
