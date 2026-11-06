import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LOCK_DIR, LOCKS_TTL_MS, codexLocks, deviceNumbers, lockFile, parseLsof, parseProcLocks, systemLockHolders, type LockHolders } from './codexInUse.ts';

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

const name = (file: string) => file.split(/[\\/]/).pop()!;

/** Answers from `map` (lock file name → pids), counting the questions; `fail` makes the next ones fail. */
const fakeHolders = (map: Record<string, number[]>) => {
  const state = { asked: 0, fail: false, map };
  const holders: LockHolders = async (files) => {
    state.asked++;
    if (state.fail) throw new Error('lsof timed out');
    return new Map(files.flatMap((file) => (state.map[name(file)] ? [[file, state.map[name(file)]!] as const] : [])));
  };
  return { state, holders };
};

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
  it("reads the flock holders of Linux's /proc/locks by device and inode", () => {
    const text = [
      '1: FLOCK  ADVISORY  WRITE 1234 08:01:5678 0 EOF',
      '2: POSIX  ADVISORY  WRITE 99 08:01:42 0 EOF',
      '2: -> FLOCK  ADVISORY  WRITE 55 08:01:5678 0 EOF',
      // The same inode on another device is another file.
      '3: FLOCK  ADVISORY  WRITE 77 00:1f:5678 0 EOF',
      '',
    ].join('\n');
    expect(parseProcLocks(text, new Map([['8:1:5678', '/h/a.lock']]))).toEqual(new Map([['/h/a.lock', [1234, 55]]]));
  });

  it("turns stat's device number into the major and minor /proc/locks prints", () => {
    // makedev(8, 1) and makedev(259, 3) as Linux encodes them for stat.
    expect(deviceNumbers(0x801)).toBe('8:1');
    expect(deviceNumbers((259 << 8) | 3)).toBe('259:3');
    // A minor number past 255 keeps its high bits above the major (makedev(0, 0x12331)).
    expect(deviceNumbers(0x31 | (0x12300 << 12))).toBe(`0:${0x12331}`);
  });
});

describe('codexLocks', () => {
  it('is the threads whose lock another process holds, not those Seshboard holds, has loaded, or without a lock', async () => {
    const home = codexHome(['a', 'b', 'c', 'd', 'e']);
    const { holders, state } = fakeHolders({ 'a.lock': [20], 'b.lock': [10], 'd.lock': [30], 'e.lock': [40] });
    const open = await codexLocks(home, { holders }).openThreads(['a', 'b', 'c', 'e', 'f'], new Set([10]), new Set(['e']));
    // c's lock is stale (a killed Codex left it), f has none, d wasn't asked about, e is loaded in Seshboard.
    expect(open).toEqual(new Set(['a']));
    expect(state.asked).toBe(1);
  });

  it('asks the system again only when the lock files change, or after a while', async () => {
    const home = codexHome(['a']);
    let time = 0;
    const { holders, state } = fakeHolders({ 'a.lock': [20] });
    const locks = codexLocks(home, { holders, now: () => time });
    expect(await locks.openThreads(['a', 'b'], new Set())).toEqual(new Set(['a']));
    time += 3000;
    expect(await locks.openThreads(['a', 'b'], new Set())).toEqual(new Set(['a']));
    expect(state.asked).toBe(1);
    // Our own pid now: answered from what was asked, without asking again.
    expect(await locks.openThreads(['a', 'b'], new Set([20]))).toEqual(new Set());
    expect(state.asked).toBe(1);
    writeFileSync(lockFile(home, 'b'), '');
    state.map['b.lock'] = [21];
    expect(await locks.openThreads(['a', 'b'], new Set())).toEqual(new Set(['a', 'b']));
    expect(state.asked).toBe(2);
    time += LOCKS_TTL_MS;
    await locks.openThreads(['a', 'b'], new Set());
    expect(state.asked).toBe(3);
    unlinkSync(lockFile(home, 'a'));
    unlinkSync(lockFile(home, 'b'));
    expect(await locks.openThreads(['a', 'b'], new Set())).toEqual(new Set());
    expect(state.asked).toBe(3);
  });

  it("keeps the last answer when the system can't say, and none before the first means not open", async () => {
    const home = codexHome(['a', 'b']);
    let time = 0;
    const { holders, state } = fakeHolders({ 'a.lock': [20] });
    state.fail = true;
    const locks = codexLocks(home, { holders, now: () => time });
    expect(await locks.openThreads(['a', 'b'], new Set())).toEqual(new Set());
    state.fail = false;
    time += LOCKS_TTL_MS;
    expect(await locks.openThreads(['a', 'b'], new Set())).toEqual(new Set(['a']));
    state.fail = true;
    time += LOCKS_TTL_MS;
    expect(await locks.openThreads(['a', 'b'], new Set())).toEqual(new Set(['a']));
    expect(state.asked).toBe(3);
  });

  it('asks once for callers at the same time', async () => {
    const home = codexHome(['a']);
    const { holders, state } = fakeHolders({ 'a.lock': [20] });
    const locks = codexLocks(home, { holders });
    const answers = await Promise.all([1, 2, 3].map(() => locks.openThreads(['a'], new Set())));
    expect(answers).toEqual([new Set(['a']), new Set(['a']), new Set(['a'])]);
    expect(state.asked).toBe(1);
  });

  it("takes a lock file as open where the system can't name its holder, unless Seshboard loaded the thread", async () => {
    const home = codexHome(['a', 'b']);
    expect(await codexLocks(home, { holders: null }).openThreads(['a', 'b', 'c'], new Set(), new Set(['b']))).toEqual(new Set(['a']));
    expect(systemLockHolders('win32')).toBeNull();
  });

  // macOS always has lsof; a Linux runner may not, and Windows can't name the holder.
  it.skipIf(process.platform !== 'darwin')('finds a real process that has the lock file open', async () => {
    const home = codexHome(['a', 'b']);
    const child = spawn(process.execPath, ['-e', "require('fs').openSync(process.argv[1], 'r+'); console.log('open'); setInterval(() => {}, 1000)", lockFile(home, 'a')]);
    try {
      await new Promise((resolve) => child.stdout.once('data', resolve));
      expect(await codexLocks(home).openThreads(['a', 'b'], new Set())).toEqual(new Set(['a']));
      expect(await codexLocks(home).openThreads(['a', 'b'], new Set([child.pid!]))).toEqual(new Set());
    } finally {
      child.kill();
    }
  });
});
