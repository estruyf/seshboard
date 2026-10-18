import { joinPath, pathInside } from '@switchboard/protocol';

/** `.claude/worktrees/<name>` at the start of a path inside a folder: a worktree Claude Code made there. */
const CLAUDE_WORKTREE = /^\.claude[\\/]worktrees[\\/][^\\/]+/;

/**
 * The session's folder once Claude Code reports `reported` at the start of a turn. Claude Code reports the folder its
 * shell is in, which follows `cd`: a subfolder of the session's folder leaves the session where it was, so file names
 * in replies, @-mentions and the terminal stay relative to it. A worktree it made in the folder (`--worktree`,
 * EnterWorktree) is where the session runs from then on, and so is any folder outside it (leaving the worktree).
 */
export function sessionFolder(current: string, reported: string): string {
  const inside = pathInside(reported, current);
  if (inside === null) return reported;
  const worktree = CLAUDE_WORKTREE.exec(inside)?.[0];
  return worktree ? joinPath(current, worktree) : current;
}
