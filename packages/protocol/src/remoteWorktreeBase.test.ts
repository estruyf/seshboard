import { describe, expect, it } from 'vitest';
import { remoteBaseChoices, remoteBaseListed, remoteBaseName, remoteFreshBase } from './remoteWorktreeBase.ts';

const branches = { current: 'feat/a', branches: ['feat/a', 'dev', 'main'], checkedOutElsewhere: [], remoteBranches: ['origin/main', 'origin/dev'], remote: 'origin', baseBranch: 'main' };

describe('remote worktree base', () => {
  it('names what fresh starts from, also when the computer says less', () => {
    expect(remoteFreshBase(branches)).toBe('origin/main');
    expect(remoteFreshBase({ remote: 'origin', baseBranch: null })).toBe("origin's default branch");
    expect(remoteFreshBase({})).toBe('the default branch');
  });

  it('lists fresh and HEAD first, then the other local and remote branches', () => {
    const choices = remoteBaseChoices(branches, 'fresh');
    expect(choices.map((c) => c.value)).toEqual(['fresh', 'head', 'refs/heads/dev', 'refs/heads/main', 'refs/remotes/origin/dev']);
    expect(choices[1]).toMatchObject({ label: 'feat/a', separatorAfter: true });
    // A base no longer listed stays, so the chip keeps it checked.
    expect(remoteBaseChoices(branches, 'refs/heads/gone')[2]).toMatchObject({ value: 'refs/heads/gone', label: 'gone' });
    // An older computer sends no remote branches.
    expect(remoteBaseChoices({ current: 'main', branches: ['main'], checkedOutElsewhere: [] }, 'fresh').map((c) => c.value)).toEqual(['fresh', 'head']);
  });

  it('names a base and knows whether it is still listed', () => {
    expect(remoteBaseName('head', branches)).toBe('feat/a');
    expect(remoteBaseName('refs/remotes/origin/dev', branches)).toBe('origin/dev');
    expect(remoteBaseListed('refs/remotes/origin/dev', branches)).toBe(true);
    expect(remoteBaseListed('refs/heads/gone', branches)).toBe(false);
    expect(remoteBaseListed('fresh', branches)).toBe(true);
  });
});
