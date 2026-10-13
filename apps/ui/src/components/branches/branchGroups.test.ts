import { describe, expect, it } from 'vitest';
import type { BranchEntry, LocalBranch } from '@switchboard/protocol/client';
import {
  baseLabel,
  branchRows,
  branchSummary,
  classify,
  defaultSelection,
  deletedMessage,
  deletePlan,
  filterRows,
  groupRows,
  localLabel,
  localLock,
  localLoss,
  prLabel,
  remoteLock,
  remoteLoss,
  switchAction,
  toggleSelection,
  validSelection,
} from './branchGroups.ts';

const NOW = Date.UTC(2026, 9, 10);
const DAY = 24 * 60 * 60 * 1000;

function local(patch: Partial<LocalBranch> = {}): LocalBranch {
  return { sha: 'aaa', upstream: null, upstreamGone: false, aheadOfUpstream: null, behindUpstream: null, unpushed: 0, checkedOutIn: null, neverCommitted: false, ...patch };
}

function branch(name: string, patch: Partial<BranchEntry> = {}): BranchEntry {
  return { name, local: local(), remote: null, isBase: false, ahead: 2, behind: 0, merged: false, pr: null, lastCommitAt: NOW - DAY, subject: 'Do a thing', author: 'Ann', ...patch };
}

const remote = (name: string, sha = 'aaa') => ({ remote: 'origin', ref: `origin/${name}`, sha, isDefault: false });
const main = branch('main', { isBase: true, ahead: null, behind: null, local: local({ checkedOutIn: '/work/app', upstream: 'origin/main', aheadOfUpstream: 0, behindUpstream: 0 }), remote: { ...remote('main'), isDefault: true } });

describe('classify', () => {
  it('puts the base and checked-out branches in use', () => {
    expect(classify(main, NOW)).toBe('in-use');
    expect(classify(branch('wt', { local: local({ checkedOutIn: '/work/app/.claude/worktrees/wt' }) }), NOW)).toBe('in-use');
  });

  it('finds what is safe: merged by ancestry or PR, or never committed on, with nothing unpushed', () => {
    expect(classify(branch('m', { merged: true, ahead: 0 }), NOW)).toBe('safe');
    expect(classify(branch('sq', { pr: { number: 4, state: 'merged', url: '' } }), NOW)).toBe('safe');
    expect(classify(branch('new', { ahead: 0, local: local({ neverCommitted: true }) }), NOW)).toBe('safe');
    expect(classify(branch('sq2', { pr: { number: 5, state: 'merged', url: '' }, local: local({ unpushed: 1 }) }), NOW)).toBe('active');
    expect(classify(branch('r', { local: null, remote: remote('r'), merged: true, ahead: 0 }), NOW)).toBe('safe');
  });

  it('then gone upstreams, then inactive, then active', () => {
    expect(classify(branch('g', { local: local({ upstreamGone: true, unpushed: 2 }) }), NOW)).toBe('gone');
    expect(classify(branch('old', { lastCommitAt: NOW - 100 * DAY }), NOW)).toBe('inactive');
    expect(classify(branch('new'), NOW)).toBe('active');
  });
});

describe('locks', () => {
  it('locks the base, checked-out branches, the remote default and branches with an open PR', () => {
    expect(localLock(main)).toBe('The base branch is never deleted');
    expect(localLock(branch('wt', { local: local({ checkedOutIn: '/work/app/.claude/worktrees/brave-otter' }) }))).toBe('Checked out in brave-otter');
    expect(remoteLock(main, 'main')).toBe("The remote's default branch is never deleted");
    expect(remoteLock(branch('main', { local: null, remote: { ...remote('main'), remote: 'upstream', ref: 'upstream/main' } }), 'main')).toBe("The remote's default branch is never deleted");
    expect(remoteLock(branch('pr', { remote: remote('pr'), pr: { number: 9, state: 'open', url: '' } }), 'main')).toBe('PR #9 is open; deleting the branch would close it');
    expect(remoteLock(branch('ok', { remote: remote('ok') }), 'main')).toBeNull();
  });

  it('locks a row only when neither copy can go', () => {
    const rows = branchRows([main, branch('pr', { local: local({ checkedOutIn: '/x/wt' }), remote: remote('pr'), pr: { number: 9, state: 'open', url: '' } }), branch('half', { local: local({ checkedOutIn: '/x/half' }), remote: remote('half') })], 'main', NOW);
    expect(rows.find((r) => r.key === 'main')!.locked).toBe('The base branch is never deleted');
    expect(rows.find((r) => r.key === 'pr')!.locked).toBe('Checked out in wt');
    expect(rows.find((r) => r.key === 'half')!.locked).toBeNull();
  });
});

describe('switchAction', () => {
  const root = '/work/app';
  const onMain = (main: BranchEntry) => [main, branch('feature'), branch('wt', { local: local({ checkedOutIn: '/work/app/.claude/worktrees/brave-otter' }) }), branch('remote-only', { local: null, remote: remote('remote-only') })];

  it('switches the main checkout to a branch that is not checked out, here or only on the remote', () => {
    const entries = onMain(main);
    expect(switchAction(entries[1]!, entries, root)).toEqual({ branch: 'feature', label: 'Switch to this branch', blocked: null });
    expect(switchAction(entries[3]!, entries, root)).toEqual({ branch: 'remote-only', label: 'Switch to this branch', blocked: null });
  });

  it("can't switch to a branch checked out in a worktree", () => {
    const entries = onMain(main);
    expect(switchAction(entries[2]!, entries, root)).toEqual({ branch: 'wt', label: 'Switch to this branch', blocked: 'Checked out in brave-otter' });
  });

  it('offers nothing on the base while it is checked out', () => {
    expect(switchAction(main, onMain(main), root)).toBeNull();
  });

  it('offers the base on the branch checked out in the main checkout, so it can be deleted next', () => {
    const base = branch('main', { isBase: true, local: local() });
    const current = branch('cleanup', { local: local({ checkedOutIn: root }) });
    expect(switchAction(current, [base, current], root)).toEqual({ branch: 'main', label: 'Switch to main', blocked: null });
    const elsewhere = branch('main', { isBase: true, local: local({ checkedOutIn: '/work/app-main' }) });
    expect(switchAction(current, [elsewhere, current], root)).toEqual({ branch: 'main', label: 'Switch to main', blocked: 'main is checked out in app-main' });
    expect(switchAction(current, [current], root)).toBeNull();
  });
});

describe('rows and selection', () => {
  const entries = [
    branch('active-1', { lastCommitAt: NOW - 2 * DAY }),
    branch('merged', { merged: true, ahead: 0, remote: remote('merged') }),
    main,
    branch('theirs', { local: null, remote: remote('theirs'), merged: true, ahead: 0 }),
    branch('active-2', { lastCommitAt: NOW - DAY, subject: 'Fix the login page' }),
  ];
  const rows = branchRows(entries, 'main', NOW);

  it('orders by group, newest first, and keys remote-only rows by their ref', () => {
    expect(rows.map((r) => r.key)).toEqual(['main', 'merged', 'origin/theirs', 'active-2', 'active-1']);
    expect(groupRows(rows).map((g) => g.group)).toEqual(['in-use', 'safe', 'active']);
    expect(branchSummary(rows)).toEqual({ local: 4, remote: 3, safe: 2, gone: 0 });
  });

  it('starts with the safe local branches picked, never a remote-only one', () => {
    expect([...defaultSelection(rows)]).toEqual(['merged']);
    expect([...validSelection(new Set(['main', 'merged', 'gone']), rows)]).toEqual(['merged']);
  });

  it('picks ranges with shift, skipping locked rows', () => {
    expect([...toggleSelection(new Set(), rows, 'active-2', 'main', true)].sort()).toEqual(['active-2', 'merged', 'origin/theirs']);
  });

  it('filters by every word in the name, remote ref or subject', () => {
    expect(filterRows(rows, 'login').map((r) => r.key)).toEqual(['active-2']);
    expect(filterRows(rows, 'origin theirs').map((r) => r.key)).toEqual(['origin/theirs']);
    expect(filterRows(rows, '  ')).toHaveLength(rows.length);
  });

  it('plans which copies go, leaving locked and missing ones', () => {
    const picked = rows.filter((r) => ['merged', 'origin/theirs', 'active-1'].includes(r.key));
    expect(deletePlan(picked, { local: true, remote: false }).map((p) => [p.row.key, p.local, p.remote])).toEqual([
      ['merged', true, false],
      ['active-1', true, false],
    ]);
    expect(deletePlan(picked, { local: true, remote: true }).map((p) => [p.row.key, p.local, p.remote])).toEqual([
      ['merged', true, true],
      ['origin/theirs', false, true],
      ['active-1', true, false],
    ]);
  });
});

describe('losses', () => {
  it('counts unpushed local commits unless merged', () => {
    expect(localLoss(branch('a', { local: local({ unpushed: 3 }) }))).toBe(3);
    expect(localLoss(branch('a', { local: local({ unpushed: 3 }), pr: { number: 1, state: 'merged', url: '' } }))).toBe(0);
  });

  it('counts unmerged remote commits unless a local copy that stays keeps them', () => {
    const shared = branch('s', { ahead: 4, remote: remote('s') });
    expect(remoteLoss(shared, false)).toBe(0);
    expect(remoteLoss(shared, true)).toBe(4);
    expect(remoteLoss(branch('r', { local: null, ahead: 2, remote: remote('r') }), false)).toBe(2);
    expect(remoteLoss(branch('behind', { ahead: 3, remote: remote('behind', 'bbb'), local: local({ upstream: 'origin/behind', behindUpstream: 1 }) }), false)).toBe(3);
  });
});

describe('labels', () => {
  it('describes the local copy', () => {
    expect(localLabel(main)).toEqual({ text: 'checked out', tone: 'default' });
    expect(localLabel(branch('a', { local: local({ unpushed: 2 }) }))).toEqual({ text: '2 not pushed', tone: 'caution' });
    expect(localLabel(branch('a', { local: local({ upstreamGone: true }) }))).toEqual({ text: 'upstream gone', tone: 'muted' });
    expect(localLabel(branch('a', { remote: remote('a'), local: local({ upstream: 'origin/a', aheadOfUpstream: 1, behindUpstream: 2 }) }))).toEqual({ text: '↑1 ↓2', tone: 'default' });
    expect(localLabel(branch('a', { remote: remote('a'), local: local({ upstream: 'origin/a', aheadOfUpstream: 0, behindUpstream: 0 }) }))).toEqual({ text: 'in sync', tone: 'ok' });
    expect(localLabel(branch('a'))).toEqual({ text: 'local only', tone: 'muted' });
    expect(localLabel(branch('a', { local: null }))).toBeNull();
  });

  it('describes where it stands against the base, and its pull request', () => {
    expect(baseLabel(main)).toBeNull();
    expect(baseLabel(branch('a', { pr: { number: 41, state: 'merged', url: '' } }))).toEqual({ text: 'PR #41 merged', tone: 'ok' });
    expect(baseLabel(branch('a', { merged: true, ahead: 0 }))).toEqual({ text: 'merged', tone: 'ok' });
    expect(baseLabel(branch('a', { ahead: 0, local: local({ neverCommitted: true }) }))).toEqual({ text: 'no commits of its own', tone: 'muted' });
    expect(baseLabel(branch('a', { ahead: 3, behind: 12 }))).toEqual({ text: '3 ↑ 12 ↓', tone: 'default' });
    expect(prLabel(branch('a', { pr: { number: 38, state: 'open', url: '' } }))).toEqual({ text: 'PR #38 open', tone: 'link' });
    expect(prLabel(branch('a', { pr: { number: 41, state: 'merged', url: '' } }))).toBeNull();
  });

  it('says what was deleted', () => {
    expect(deletedMessage(3, 2, 'origin')).toBe('Deleted 3 branches here and 2 on origin');
    expect(deletedMessage(1, 0, 'origin')).toBe('Deleted 1 branch here');
    expect(deletedMessage(0, 2, 'origin')).toBe('Deleted 2 branches on origin');
  });
});
