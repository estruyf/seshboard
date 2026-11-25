import { resolve } from 'node:path';
import { git } from './gitChanges.ts';
import { sessionsBlocking, type SessionActivity } from './worktrees.ts';

/** What `releaseBranch` did: the branch it let go, or why it left the folder as it was. */
export type ReleaseResult = { released: string } | { skipped: 'NOT_A_WORKTREE' | 'MAIN' | 'DETACHED' | 'SESSION_BUSY' | 'GIT_FAILED'; reason: string };

/**
 * Lets a linked worktree's branch go (`git switch --detach`), so another worktree can check it out: a review of the
 * same pull request, or you. The folder, its commits and its uncommitted changes stay, since HEAD stays on the same
 * commit. Never touches the main checkout, a folder that is already detached, or one where a session works or another
 * app has Claude Code open (`activity`, as for a removal).
 */
export async function releaseBranch(folder: string, activity: readonly SessionActivity[]): Promise<ReleaseResult> {
  let top: string;
  let gitDir: string;
  let commonDir: string;
  try {
    // `--path-format=absolute` (git 2.31): both answers are paths to compare, whatever the folder is.
    const out = (await git(folder, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir'])).trim().split('\n');
    [top, gitDir, commonDir] = out.map((line) => resolve(line.trim())) as [string, string, string];
  } catch (error) {
    return { skipped: 'NOT_A_WORKTREE', reason: (error as Error).message };
  }
  // A linked worktree has its own git dir under the common one; the main checkout's are the same.
  if (gitDir === commonDir) return { skipped: 'MAIN', reason: 'The main checkout keeps its branch.' };
  const branch = (await git(top, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowExitCodes: [1] }).catch(() => '')).trim();
  if (!branch) return { skipped: 'DETACHED', reason: 'It has no branch checked out.' };
  const blocking = sessionsBlocking(top, activity);
  if (blocking.refusal) return { skipped: 'SESSION_BUSY', reason: blocking.refusal.message };
  try {
    await git(top, ['switch', '--quiet', '--detach']);
  } catch (error) {
    return { skipped: 'GIT_FAILED', reason: (error as Error).message };
  }
  return { released: branch };
}
