import { existsSync } from 'node:fs';
import { git, GitError } from '../git/gitChanges.ts';
import { firstUsefulLine } from '../git/pullRequest.ts';
import { worktreePath } from '../git/worktreeFrom.ts';

/** git (or a check before it) refused to make the run's worktree: what to say, in one line. */
export class RunWorktreeError extends Error {}

/**
 * Makes the one worktree a pipeline run works in, where Claude Code's `--worktree` puts its own
 * (`<root>/.claude/worktrees/<name>`, so Switchboard treats it like one), on a branch of its own, `worktree-<name>`,
 * started from the HEAD of `fromCwd` (where the run was started). Every sub-session of the run then starts in it.
 * Refuses when the folder is taken or git says no. Nothing is pushed.
 */
export async function makeRunWorktree(params: { root: string; name: string; fromCwd: string; env?: Record<string, string> }): Promise<string> {
  const path = worktreePath(params.root, params.name);
  if (existsSync(path)) throw new RunWorktreeError(`There is a worktree named ${params.name} already.`);
  try {
    await git(params.fromCwd, ['worktree', 'add', '--quiet', '-b', `worktree-${params.name}`, path, 'HEAD'], { env: { ...params.env, GIT_TERMINAL_PROMPT: '0' }, timeout: 60_000 });
  } catch (error) {
    const message = error instanceof GitError ? error.message : String(error);
    throw new RunWorktreeError(firstUsefulLine(message) || message);
  }
  return path;
}
