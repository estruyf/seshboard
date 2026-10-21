import { describe, expect, it } from 'vitest';
import { branchLabel, branchNote, type BranchRoute } from './trayLabels.ts';

const route = (patch: Partial<BranchRoute>): BranchRoute => ({
  worktree: false,
  baseRef: 'fresh',
  remote: 'origin',
  baseBranch: 'develop/5.5',
  current: 'feature/login',
  checkoutBranch: null,
  isGitRepo: true,
  ...patch,
});

describe('branch label', () => {
  it('names the branch to work on in the current checkout', () => {
    expect(branchLabel(route({}))).toBe('feature/login');
    expect(branchLabel(route({ checkoutBranch: 'develop/5.5' }))).toBe('develop/5.5');
    expect(branchLabel(route({ current: null }))).toBe('…');
    expect(branchLabel(route({ isGitRepo: false, current: null }))).toBe('no git');
  });

  it('names the base of a new worktree', () => {
    expect(branchLabel(route({ worktree: true }))).toBe('From origin/develop/5.5');
    // A branch picked for the checkout doesn't matter to a worktree.
    expect(branchLabel(route({ worktree: true, checkoutBranch: 'other' }))).toBe('From origin/develop/5.5');
    expect(branchLabel(route({ worktree: true, baseRef: 'head' }))).toBe('From feature/login');
    expect(branchLabel(route({ worktree: true, baseRef: 'head', current: null }))).toBe('From HEAD');
    expect(branchLabel(route({ worktree: true, remote: null, baseBranch: 'main' }))).toBe('From main');
    expect(branchLabel(route({ worktree: true, baseBranch: null }))).toBe("From origin's default branch");
    expect(branchLabel(route({ worktree: true, baseRef: 'refs/heads/dev' }))).toBe('From dev');
    expect(branchLabel(route({ worktree: true, baseRef: 'refs/remotes/origin/release/2' }))).toBe('From origin/release/2');
  });
});

describe('branch note', () => {
  it('marks the current branch and how far its upstream is ahead', () => {
    expect(branchNote('main', 'main', null)).toBe('current');
    expect(branchNote('main', 'main', 0)).toBe('current');
    expect(branchNote('main', 'main', 3)).toBe('current · ↓3');
    expect(branchNote('dev', 'main', 3)).toBeUndefined();
  });
});
