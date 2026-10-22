import { failureOf } from './github.ts';
import { runGh, type GhCommand } from './pullRequest.ts';
import { countUncommitted } from './worktrees.ts';

/** Why a pull request wasn't checked out: the folder has changes, or gh said no. */
export class PrCheckoutError extends Error {
  constructor(
    readonly code: 'DIRTY' | 'GH_FAILED',
    message: string,
  ) {
    super(message);
  }
}

/** "3 changed files. Commit or stash them first.": why Current checkout can't take a pull request now. */
export const dirtyReason = (changed: number) => `${changed === 1 ? '1 changed file' : `${changed} changed files`}. Commit or stash them first.`;

/**
 * New session's Current checkout for a pull request: `gh pr checkout <n>` in the project folder, before the session
 * starts. Only in a folder without changes (staged, unstaged or untracked), so nothing of yours is carried over or in
 * the way; gh fetches the branch (from a fork too) and switches to it. Throws `PrCheckoutError` with what to say.
 */
export async function checkoutPullRequest(cwd: string, pr: { number: number; repo: string }, options: { gh: GhCommand; env: Record<string, string> }): Promise<void> {
  const changed = await countUncommitted(cwd);
  if (changed > 0) throw new PrCheckoutError('DIRTY', dirtyReason(changed));
  const result = await runGh(options.gh, ['pr', 'checkout', String(pr.number), '--repo', pr.repo], { cwd, env: options.env, timeout: 120_000 });
  if (result.code !== 0 || result.missing) throw new PrCheckoutError('GH_FAILED', `Couldn't check out #${pr.number}: ${failureOf(result).message}`);
}
