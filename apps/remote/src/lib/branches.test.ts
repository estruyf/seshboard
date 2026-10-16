import { describe, expect, it } from 'vitest';
import { branchChoices, checkoutBranch } from './branches.ts';

describe('the branch of a new session', () => {
  const branches = { current: 'main', branches: ['feat/login', 'main', 'taken'], checkedOutElsewhere: ['taken'] };

  it('offers the branch checked out first, and not the ones in another worktree', () => {
    expect(branchChoices(branches)).toEqual(['main', 'feat/login']);
    expect(branchChoices({ current: null, branches: ['main'], checkedOutElsewhere: [] })).toEqual(['main']);
  });

  it('checks out only another branch the computer still lists, and never in a new worktree', () => {
    expect(checkoutBranch('feat/login', branches, false)).toBe('feat/login');
    expect(checkoutBranch('main', branches, false)).toBeNull();
    expect(checkoutBranch('feat/login', branches, true)).toBeNull();
    expect(checkoutBranch('gone', branches, false)).toBeNull();
    expect(checkoutBranch(null, null, false)).toBeNull();
  });
});
