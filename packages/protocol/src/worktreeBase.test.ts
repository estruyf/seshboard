import { describe, expect, it } from 'vitest';
import { branchOfBase, isBranchBase, isWorktreeBase, worktreeRequestBase } from './worktreeBase.ts';

describe('worktree bases', () => {
  it('takes fresh, head and full refs of local and remote branches', () => {
    for (const base of ['fresh', 'head', 'refs/heads/dev', 'refs/heads/feature/login', 'refs/remotes/origin/release/2']) expect(isWorktreeBase(base)).toBe(true);
    for (const base of ['dev', 'refs/heads/', 'refs/remotes/origin', 'refs/heads/-x', 'refs/heads/a..b', 'refs/heads/a b', 'refs/tags/v1', 3, null]) expect(isWorktreeBase(base)).toBe(false);
    expect(isBranchBase('head')).toBe(false);
  });

  it('names the branch as people read it', () => {
    expect(branchOfBase('refs/heads/dev')).toBe('dev');
    expect(branchOfBase('refs/remotes/origin/release/2')).toBe('origin/release/2');
  });

  it('turns a saved base into what session.create takes', () => {
    expect(worktreeRequestBase('fresh')).toBe('fresh');
    expect(worktreeRequestBase('head')).toBe('head');
    expect(worktreeRequestBase('refs/heads/feature/login')).toEqual({ branch: 'feature/login' });
    expect(worktreeRequestBase('refs/remotes/origin/release/2')).toEqual({ remote: 'origin', branch: 'release/2' });
  });
});
