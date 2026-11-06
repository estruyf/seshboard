import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LOCK_DIR, lockFile, openThreads, parseLsof, parseProcLocks, systemLockHolders, type LockHolders } from './codexInUse.ts';

const homes: string[] = [];
const codexHome = (locked: string[]) => {
  // Not by its real path: on macOS the temp folder is behind a symlink, which lsof follows.
  const home = mkdtempSync(join(tmpdir(), 'seshboard-codex-locks-'));
  homes.push(home);
  mkdirSync(join(home, LOCK_DIR));
  writeFileSync(join(home, LOCK_DIR, '.coordination.lock'), '');
  for (const id of locked) writeFileSync(lockFile(home, id), '');
  return home;
};

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe('parseLsof', () => {
  it('reads which process has which file open', () => {
    expect(parseLsof('p53166\nf11\nn/x/a.lock\np700\nf3\nn/x/a.lock\nf4\nn/x/b.lock\n')).toEqual(
      new Map([
        ['/x/a.lock', [53166, 700]],
        ['/x/b.lock', [700]],
      ]),
    );
    expect(parseLsof('')).toEqual(new Map());
  });
});

describe('parseProcLocks', () => {
  it("reads the flock holders of Linux's /proc/locks by inode", () => {
    const text = ['1: FLOCK  ADVISORY  WRITE 1234 08:01:5678 0 EOF', '2: POSIX  ADVISORY  WRITE 99 08:01:42 0 EOF', '2: -> FLOCK  ADVISORY  WRITE 55 00:1f:5678 0 EOF', ''].join('\n');
    expect(parseProcLocks(text, new Map([[5678, '/h/a.lock']]))).toEqual(new Map([['/h/a.lock', [1234, 55]]]));
  });
});

describe('openThreads', () => {
  const holders =
    (map: Record<string, number[]>): LockHolders =>
    async (files) =>
      new Map(files.flatMap((file) => (map[file.split(/[\\/]/).pop()!] ? [[file, map[file.split(/[\\/]/).pop()!]!] as const] : [])));

  it('is the threads whose lock another process holds, not those Seshboard holds or without a lock', async () => {
    const home = codexHome(['a', 'b', 'c', 'd']);
    const open = await openThreads(home, ['a', 'b', 'c', 'e'], new Set([10]), { holders: holders({ 'a.lock': [20], 'b.lock': [10], 'd.lock': [30] }) });
    // c's lock is stale (a killed Codex left it), e has none, d wasn't asked about.
    expect(open).toEqual(new Set(['a']));
  });

  it("takes a lock file as open where the system can't name its holder, unless Seshboard loaded the thread", async () => {
    const home = codexHome(['a', 'b']);
    const open = await openThreads(home, ['a', 'b', 'c'], new Set(), { ownThreads: new Set(['b']), holders: async () => null });
    expect(open).toEqual(new Set(['a']));
  });

  it('asks nothing when there are no lock files', async () => {
    let asked = false;
    const home = codexHome([]);
    expect(await openThreads(home, ['a'], new Set(), { holders: async () => ((asked = true), new Map()) })).toEqual(new Set());
    expect(asked).toBe(false);
  });

  // macOS always has lsof; a Linux runner may not, and Windows can't name the holder.
  it.skipIf(process.platform !== 'darwin')(
    'finds a real process that has the lock file open',
    async () => {
      const home = codexHome(['a', 'b']);
      const child = spawn(process.execPath, ['-e', "require('fs').openSync(process.argv[1], 'r+'); console.log('open'); setInterval(() => {}, 1000)", lockFile(home, 'a')]);
      try {
        await new Promise((resolve) => child.stdout.once('data', resolve));
        expect(await openThreads(home, ['a', 'b'], new Set(), { holders: systemLockHolders() })).toEqual(new Set(['a']));
        expect(await openThreads(home, ['a', 'b'], new Set([child.pid!]), { holders: systemLockHolders() })).toEqual(new Set());
      } finally {
        child.kill();
      }
    },
  );
});
