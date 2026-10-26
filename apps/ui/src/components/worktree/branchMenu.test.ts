import { describe, expect, it } from 'vitest';
import type { LiveSession } from '@seshboard/protocol/client';
import { branchButton, filterBranches, sharedWarning, sharingCheckout } from './branchMenu.ts';

const live = (sessionId: string, cwd: string | null): LiveSession => ({
  sessionId,
  pid: 1,
  cwd,
  projectRoot: null,
  status: 'idle',
  rawStatus: 'idle',
  name: null,
  origin: 'cli',
  startedAt: null,
  updatedAt: null,
  profileId: 'default',
});

describe('sharingCheckout', () => {
  it('finds other sessions in the checkout or a folder inside it, not in worktrees or elsewhere', () => {
    const sessions = [
      live('self', '/p/app'),
      live('same', '/p/app'),
      live('sub', '/p/app/packages/ui'),
      live('worktree', '/p/app/.claude/worktrees/fix'),
      live('sibling', '/p/app-two'),
      live('parent', '/p'),
      live('nowhere', null),
      live('same', '/p/app'),
    ];
    expect(sharingCheckout('/p/app/', 'self', sessions)).toEqual(['same', 'sub']);
  });
});

describe('filterBranches', () => {
  const branches = ['feature/login', 'main', 'fix-typo', 'Feature/search'];
  it('puts the current branch first and keeps the rest in order', () => {
    expect(filterBranches(branches, 'main', '')).toEqual(['main', 'feature/login', 'fix-typo', 'Feature/search']);
    expect(filterBranches(branches, null, '')).toEqual(branches);
    expect(filterBranches(branches, 'gone', '')).toEqual(branches);
  });
  it('filters by name, ignoring case', () => {
    expect(filterBranches(branches, 'main', ' feature ')).toEqual(['feature/login', 'Feature/search']);
    expect(filterBranches(branches, 'main', 'nothing')).toEqual([]);
  });
});

describe('branchButton', () => {
  it('names the branch, or says HEAD is detached', () => {
    expect(branchButton('main', false)).toEqual({ label: 'main', tooltip: 'On main. Switch branch' });
    expect(branchButton(null, false)).toEqual({ label: 'detached', tooltip: 'Detached HEAD. Switch branch' });
  });
  it('says why it is unavailable while Claude works', () => {
    expect(branchButton('main', true).tooltip).toBe('Wait for Claude to finish (or stop it) to switch branches');
  });
});

describe('sharedWarning', () => {
  it('counts the other sessions', () => {
    expect(sharedWarning(1)).toBe("1 other session works in this folder; it'll see the new branch too.");
    expect(sharedWarning(3)).toBe("3 other sessions work in this folder; they'll see the new branch too.");
  });
});
