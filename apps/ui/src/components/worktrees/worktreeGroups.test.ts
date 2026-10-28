import { describe, expect, it } from 'vitest';
import type { WorktreeEntry, WorktreeSize } from '@seshboard/protocol/client';
import {
  aheadLabel,
  branchChoice,
  classify,
  defaultSelection,
  formatBytes,
  freedBytes,
  groupRows,
  ignoredLine,
  lockReason,
  mainCheckoutBytes,
  mergeLabel,
  NO_SESSIONS,
  removedMessage,
  sessionsLabel,
  toggleSelection,
  validSelection,
  worktreeRows,
  worktreeSummary,
  type WorktreeSessions,
} from './worktreeGroups.ts';

const NOW = Date.UTC(2026, 9, 10);
const DAY = 24 * 60 * 60 * 1000;
const ROOT = '/work/app';

function entry(name: string, patch: Partial<WorktreeEntry> = {}): WorktreeEntry {
  return {
    path: `${ROOT}/.claude/worktrees/${name}`,
    name,
    branch: `worktree-${name}`,
    head: 'abc',
    isMain: false,
    isLocked: false,
    lockReason: null,
    missing: false,
    underClaudeDir: true,
    uncommitted: 0,
    ahead: 2,
    behind: 0,
    merged: false,
    pr: null,
    upstream: null,
    unpushed: 0,
    pushed: false,
    lastActivity: NOW - DAY,
    sessions: [],
    ...patch,
  };
}

const main = entry('app', { path: ROOT, name: 'app', branch: 'main', isMain: true, underClaudeDir: false, ahead: 0 });
const busy: WorktreeSessions = { busy: 1, needsYou: 0, open: 1, total: 1 };
const group = (e: WorktreeEntry, s: WorktreeSessions = NO_SESSIONS) => classify(e, s, NOW);

describe('classify', () => {
  it('puts the main checkout first and missing folders under Stale', () => {
    expect(group(main)).toEqual({ group: 'main', reason: null });
    expect(group(entry('gone', { missing: true, uncommitted: 0 }))).toEqual({ group: 'stale', reason: null });
  });

  it('finds what is safe to remove: merged or nothing ahead, clean, no busy session, made by Claude Code', () => {
    expect(group(entry('merged', { merged: true, ahead: 0 })).group).toBe('safe');
    expect(group(entry('squashed', { pr: { number: 41, state: 'merged', url: '' } })).group).toBe('safe');
    expect(group(entry('empty', { ahead: 0 })).group).toBe('safe');
    // An idle session doesn't keep it.
    expect(group(entry('idle', { ahead: 0 }), { busy: 0, needsYou: 0, open: 1, total: 1 }).group).toBe('safe');
  });

  it('calls pushed or open-PR worktrees without activity for 14 days probably done', () => {
    const old = NOW - 20 * DAY;
    expect(group(entry('pushed', { pushed: true, lastActivity: old })).group).toBe('done');
    expect(group(entry('pr', { pr: { number: 38, state: 'open', url: '' }, unpushed: 2, lastActivity: old })).group).toBe('done');
    expect(group(entry('recent', { pushed: true, lastActivity: NOW - 3 * DAY }))).toEqual({ group: 'keep', reason: 'Active in the last 14 days' });
  });

  it('keeps the rest with the first reason that applies', () => {
    expect(group(entry('a', { merged: true, ahead: 0, uncommitted: 3 }), busy)).toEqual({ group: 'keep', reason: 'A session is working here' });
    expect(group(entry('b', { merged: true, ahead: 0, uncommitted: 3 })).reason).toBe('3 uncommitted changes');
    expect(group(entry('c', { uncommitted: 1 })).reason).toBe('1 uncommitted change');
    expect(group(entry('d', { unpushed: 3, lastActivity: NOW - 30 * DAY })).reason).toBe("3 commits aren't pushed anywhere");
    expect(group(entry('e', { unpushed: 1 })).reason).toBe("1 commit isn't pushed anywhere");
    expect(group(entry('f', { merged: true, ahead: 0, underClaudeDir: false })).reason).toBe('Outside .claude/worktrees');
    expect(group(entry('g', { merged: true, ahead: 0, isLocked: true })).reason).toBe('Locked by git');
  });
});

describe('selection rules', () => {
  it('locks the main checkout, busy and dirty worktrees, and locked ones', () => {
    expect(lockReason(main, NO_SESSIONS)).toBe('The main checkout is never removed');
    expect(lockReason(entry('w'), busy)).toBe('A session is working here');
    expect(lockReason(entry('w', { uncommitted: 2 }), NO_SESSIONS)).toBe('2 uncommitted changes: commit or revert first');
    expect(lockReason(entry('w', { isLocked: true, lockReason: 'USB' }), NO_SESSIONS)).toBe('Locked by git: USB');
    expect(lockReason(entry('w', { unpushed: 4 }), NO_SESSIONS)).toBeNull();
    expect(lockReason(entry('gone', { missing: true }), NO_SESSIONS)).toBeNull();
  });

  const rows = worktreeRows(
    [
      entry('keep', { unpushed: 2 }),
      main,
      entry('safe1', { merged: true, ahead: 0, lastActivity: NOW - 2 * DAY }),
      entry('gone', { missing: true }),
      entry('safe2', { ahead: 0, lastActivity: NOW - 5 * DAY }),
      entry('dirty', { uncommitted: 1 }),
    ],
    () => NO_SESSIONS,
    NOW,
  );
  const paths = (set: Set<string>) => [...set].map((p) => p.split('/').pop()).sort();

  it('orders the groups and starts with safe and stale rows picked', () => {
    expect(groupRows(rows).map((g) => [g.group, g.rows.map((r) => r.entry.name)])).toEqual([
      ['main', ['app']],
      ['safe', ['safe1', 'safe2']],
      ['keep', ['keep', 'dirty']],
      ['stale', ['gone']],
    ]);
    expect(paths(defaultSelection(rows))).toEqual(['gone', 'safe1', 'safe2']);
  });

  it('picks ranges with shift, skipping rows that cannot be picked', () => {
    const first = toggleSelection(new Set(), rows, rows[1]!.entry.path, null, false);
    expect(paths(first)).toEqual(['safe1']);
    // From safe1 to the stale row: dirty is in between and stays out.
    const range = toggleSelection(first, rows, rows[5]!.entry.path, rows[1]!.entry.path, true);
    expect(paths(range)).toEqual(['gone', 'keep', 'safe1', 'safe2']);
    // The same range again turns them off.
    const off = toggleSelection(range, rows, rows[1]!.entry.path, rows[5]!.entry.path, true);
    expect(paths(off)).toEqual([]);
    // A row that can't be picked doesn't toggle on its own either.
    expect(paths(toggleSelection(new Set(), rows, rows[0]!.entry.path, null, false))).toEqual([]);
  });

  it('drops picks that became locked or disappeared', () => {
    const later = worktreeRows([main, entry('safe1', { merged: true, ahead: 0 })], () => busy, NOW);
    expect(paths(validSelection(new Set([`${ROOT}/.claude/worktrees/safe1`, `${ROOT}/.claude/worktrees/gone`]), later))).toEqual([]);
  });
});

describe('sizes', () => {
  const size = (path: string, bytes: number): [string, WorktreeSize] => [path, { path, bytes, at: NOW }];

  it('sums what a selection frees, counting sizes not measured yet', () => {
    const sizes = new Map([size('/a', 612_000_000), size('/b', 598_000_000)]);
    expect(freedBytes(['/a', '/b', '/c'], sizes)).toEqual({ bytes: 1_210_000_000, unknown: 1 });
    expect(formatBytes(1_210_000_000)).toBe('1.2 GB');
  });

  it('formats like Finder', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1_500)).toBe('2 KB');
    expect(formatBytes(612_400_000)).toBe('612 MB');
    expect(formatBytes(3_700_000_000)).toBe('3.7 GB');
    expect(formatBytes(2_000_000_000)).toBe('2 GB');
  });

  it("takes nested worktrees off the main checkout's size, and summarises the rest", () => {
    const rows = worktreeRows([main, entry('a', { merged: true, ahead: 0 }), entry('gone', { missing: true })], () => NO_SESSIONS, NOW);
    const a = `${ROOT}/.claude/worktrees/a`;
    expect(mainCheckoutBytes(rows, new Map([size(ROOT, 2_000)]))).toBeNull();
    const sizes = new Map([size(ROOT, 2_000), size(a, 1_500)]);
    expect(mainCheckoutBytes(rows, sizes)).toBe(500);
    // On Windows too, where git's worktree paths come back with `\` (and the drive in either case).
    const winRoot = 'C:\\work\\app';
    const winA = 'c:\\work\\app\\.claude\\worktrees\\a';
    const winRows = worktreeRows([{ ...main, path: winRoot }, entry('a', { merged: true, ahead: 0, path: winA })], () => NO_SESSIONS, NOW);
    expect(mainCheckoutBytes(winRows, new Map([size(winRoot, 2_000), size(winA, 1_500)]))).toBe(500);
    expect(worktreeSummary(rows, sizes)).toEqual({ count: 2, bytes: 1_500, unknown: 0, safe: 1, stale: 1 });
  });
});

describe('labels', () => {
  it('describes sessions', () => {
    expect(sessionsLabel(NO_SESSIONS)).toBeNull();
    expect(sessionsLabel({ busy: 2, needsYou: 0, open: 2, total: 3 })).toEqual({ text: '2 working', tone: 'working' });
    expect(sessionsLabel({ busy: 1, needsYou: 1, open: 1, total: 1 })).toEqual({ text: '1 needs you', tone: 'needs-you' });
    expect(sessionsLabel({ busy: 0, needsYou: 0, open: 1, total: 1 })).toEqual({ text: '1 session, idle', tone: 'idle' });
    expect(sessionsLabel({ busy: 0, needsYou: 0, open: 0, total: 2 })).toEqual({ text: '2 sessions, done', tone: 'idle' });
  });

  it('describes merges, pull requests and commits ahead', () => {
    expect(mergeLabel(entry('a', { merged: true }))).toEqual({ text: 'merged', tone: 'ok' });
    expect(mergeLabel(entry('a', { pr: { number: 41, state: 'merged', url: '' } }))).toEqual({ text: 'PR #41 merged', tone: 'ok' });
    expect(mergeLabel(entry('a', { pr: { number: 38, state: 'open', url: '' } }))).toEqual({ text: 'PR #38 open', tone: 'link' });
    expect(mergeLabel(entry('a'))).toBeNull();
    expect(aheadLabel(entry('a', { ahead: 3, unpushed: 3 }))).toEqual({ text: '3 ↑ · not pushed', caution: true });
    expect(aheadLabel(entry('a', { ahead: 4, pushed: true }))).toEqual({ text: '4 ↑ · pushed', caution: false });
    expect(aheadLabel(entry('a', { ahead: 0 }))).toEqual({ text: '0', caution: false });
    expect(aheadLabel(entry('a', { merged: true, ahead: 0 }))).toBeNull();
    expect(aheadLabel(main)).toBeNull();
  });

  it('suggests deleting branches only when all are merged', () => {
    expect(branchChoice([entry('a', { merged: true }), entry('b', { ahead: 0 })])).toEqual({ defaultOn: true, note: 'all merged' });
    expect(branchChoice([entry('a', { merged: true }), entry('b', { ahead: 2 })])).toEqual({ defaultOn: false, note: '1 not merged' });
    expect(branchChoice([entry('a', { branch: null })])).toEqual({ defaultOn: false, note: null });
  });

  it('lists at most five ignored files', () => {
    expect(ignoredLine(['.env.local', '.vscode/'], 2)).toBe('.env.local, .vscode/');
    expect(ignoredLine(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 9)).toBe('a, b, c, d, e and 4 more');
  });

  it('says what a clean-up removed and freed', () => {
    expect(removedMessage(3, 1_200_000_000)).toBe('Removed 3 worktrees, freed 1.2 GB');
    expect(removedMessage(1, 0)).toBe('Removed 1 worktree');
  });
});
