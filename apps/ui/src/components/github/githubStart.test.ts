import { describe, expect, it } from 'vitest';
import { currentCheckoutBlocked, forkCaution, prBranch, readOnlyFork, slugOf, startPrompt, takenWorktreeNames, uniqueWorktreeName, worktreeNameFor } from './githubStart.ts';
import { planGit } from '../git/gitPlan.ts';
import type { WorktreeStatus } from '@seshboard/protocol/client';

describe('the worktree name from an issue', () => {
  it('is the title in lowercase ASCII, words joined by -, cut at 40 characters on a word', () => {
    expect(slugOf('Start a session from a GitHub issue or pull request')).toBe('start-a-session-from-a-github-issue-or');
    expect(slugOf('Start a session from a GitHub issue or pull request').length).toBeLessThanOrEqual(40);
    expect(slugOf('Crash: “café” résumé on Windows (C:\\Users\\x)!')).toBe('crash-cafe-resume-on-windows-c-users-x');
    expect(slugOf('日本語のタイトル')).toBe('');
    expect(slugOf('a'.repeat(60))).toBe('a'.repeat(40));
    expect(worktreeNameFor('issue', 32, 'Start a session from a GitHub issue or pull request')).toBe('issue-32-start-a-session-from-a-github-issue-or');
    expect(worktreeNameFor('pr', 151, 'Start sessions from issues')).toBe('pr-151-start-sessions-from-issues');
    expect(worktreeNameFor('issue', 7, '🎉')).toBe('issue-7');
  });

  it('is a name a worktree takes, on macOS and Windows', () => {
    for (const title of ['A/B\\C:D*E?F"G<H>I|J', 'CON', '. . .', 'x'.repeat(200)]) {
      const name = worktreeNameFor('issue', 123456789, title);
      expect(name).toMatch(/^[A-Za-z0-9._-]{1,60}$/);
      expect(name).not.toMatch(/[. ]$/);
    }
  });

  it('gets -2, -3 and on when a worktree or its branch is there already', () => {
    const taken = takenWorktreeNames(
      [
        { name: 'repo', isMain: true },
        { name: 'issue-32-fix', isMain: false },
      ],
      ['main', 'worktree-issue-32-fix-2', 'feat/x'],
    );
    expect(taken).toEqual(['issue-32-fix', 'issue-32-fix-2']);
    expect(uniqueWorktreeName('issue-32-fix', taken)).toBe('issue-32-fix-3');
    expect(uniqueWorktreeName('issue-33-fix', taken)).toBe('issue-33-fix');
    expect(uniqueWorktreeName('Issue-32-Fix', ['issue-32-fix'])).toBe('Issue-32-Fix-2');
  });
});

describe('New session from an issue or pull request', () => {
  it('starts the prompt for you', () => {
    expect(startPrompt('issue', 32, 'Start a session from a GitHub issue')).toBe('Fix #32: Start a session from a GitHub issue');
    expect(startPrompt('pr', 151, ' Start sessions\nfrom issues ')).toBe('Work on #151: Start sessions from issues');
  });

  it('works on a fork’s pull request in a branch of its own', () => {
    expect(prBranch({ headRefName: 'feat/issue-start', isCrossRepository: false, headOwner: 'estruyf' })).toBe('feat/issue-start');
    expect(prBranch({ headRefName: 'main', isCrossRepository: true, headOwner: 'someone' })).toBe('someone/main');
  });

  it('only offers Current checkout for a folder without changes', () => {
    expect(currentCheckoutBlocked({ uncommitted: 0 })).toBeNull();
    expect(currentCheckoutBlocked(null)).toBeNull();
    expect(currentCheckoutBlocked({ uncommitted: 3 })).toBe('3 changed files. Commit or stash them first.');
    expect(currentCheckoutBlocked({ uncommitted: 1 })).toBe('1 changed file. Commit or stash them first.');
  });
});

describe('fork rules for push and Create pull request', () => {
  it('turns them off where Seshboard can’t push a fork’s pull request back', () => {
    expect(readOnlyFork({ isCrossRepository: false, canPush: true }, 'worktree')).toBe(false);
    expect(readOnlyFork({ isCrossRepository: true, canPush: false }, 'current')).toBe(true);
    expect(readOnlyFork({ isCrossRepository: true, canPush: true }, 'current')).toBe(false);
    expect(readOnlyFork({ isCrossRepository: true, canPush: true }, 'worktree')).toBe(true);
    expect(forkCaution(149)).toBe("#149 is from a fork. Claude can change it here, but Seshboard can't push it back. Create pull request is off for it.");
  });

  it('blocks push and Create PR in the session, and never offers them on the button', () => {
    const status = { branch: 'someone/patch-1', baseBranch: 'main', hasRemote: true, pushRemote: 'origin', upstream: null, behindUpstream: null, unpushed: 2, ahead: 2, uncommitted: 0, isWorktree: true } as unknown as WorktreeStatus;
    const open = planGit(status, false);
    expect(open.blocked.push).toBeNull();
    expect(open.primary).toBe('push');
    const fork = planGit(status, false, true);
    expect(fork.blocked.push).toBe("From a fork you can't push to.");
    expect(fork.blocked.pr).toBe("From a fork you can't push to.");
    expect(fork.primary).toBe('fetch');
  });
});
