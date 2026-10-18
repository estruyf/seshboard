import { describe, expect, it } from 'vitest';
import { sessionFolder } from './sessionFolder.ts';

describe('sessionFolder', () => {
  it('stays in its folder when Claude cds into a subfolder', () => {
    expect(sessionFolder('/work/app', '/work/app/packages/ui')).toBe('/work/app');
    expect(sessionFolder('/work/app', '/work/app')).toBe('/work/app');
    expect(sessionFolder('E:\\repos\\cad', 'E:\\repos\\cad\\phone-mount-system\\parts')).toBe('E:\\repos\\cad');
    // Windows compares without regard to case or slashes, and keeps the folder as it was written.
    expect(sessionFolder('E:\\repos\\cad', 'e:/repos/cad/parts')).toBe('E:\\repos\\cad');
  });

  it('moves into a worktree Claude Code made in the folder, not into a subfolder of it', () => {
    expect(sessionFolder('/work/app', '/work/app/.claude/worktrees/fix-login')).toBe('/work/app/.claude/worktrees/fix-login');
    expect(sessionFolder('/work/app', '/work/app/.claude/worktrees/fix-login/src')).toBe('/work/app/.claude/worktrees/fix-login');
    expect(sessionFolder('E:\\repos\\app', 'E:\\repos\\app\\.claude\\worktrees\\fix-login')).toBe('E:\\repos\\app\\.claude\\worktrees\\fix-login');
    expect(sessionFolder('/work/app/.claude/worktrees/fix-login', '/work/app/.claude/worktrees/fix-login/src')).toBe('/work/app/.claude/worktrees/fix-login');
  });

  it('follows Claude to a folder outside it, such as back out of a worktree', () => {
    expect(sessionFolder('/work/app/.claude/worktrees/fix-login', '/work/app')).toBe('/work/app');
    expect(sessionFolder('/work/app', '/work/other')).toBe('/work/other');
    expect(sessionFolder('/work/app', '/work/app-two')).toBe('/work/app-two');
  });
});
