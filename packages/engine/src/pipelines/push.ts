import { commitAll, git, GitError, worktreeStatus } from '../git/gitChanges.ts';
import { createPullRequest, firstUsefulLine, PrFailure, type GhCommand } from '../git/pullRequest.ts';

/** What a push step does, as the Push card has it after your edits. */
export interface PushPlan {
  /** Commit what the steps changed first. */
  commit: boolean;
  /** The commit message; needed when there is something to commit. */
  message: string | null;
  /** Open a pull request after pushing; null pushes only. */
  pullRequest: { title: string; body: string; base: string | null; draft: boolean } | null;
}

export interface PushResult {
  commit: { sha: string; files: number } | null;
  pr: { number: number; url: string; draft: boolean } | null;
  /** GitHub's compare page, when no pull request could be made by gh. */
  compareUrl: string | null;
  /** One line for the parent's transcript: “Pull request #152 opened”. */
  note: string;
}

/** The push step failed: what to say, in a sentence or two. */
export class PushError extends Error {}

export interface PushOptions {
  env: Record<string, string>;
  gh: GhCommand;
  /** Each step as it starts, for the button's label. */
  onStep(step: 'commit' | 'push' | 'create'): void;
}

/**
 * The push step (docs/pipelines.md): commit what the run changed (hooks run), push the branch and open the pull
 * request, through the helpers the Create pull request button uses. Nothing is forced and nothing can ask for a
 * password. A commit with nothing to commit is fine (the steps may have committed already); a branch that is already
 * pushed isn't pushed again. Throws `PushError` with the reason.
 */
export async function runPush(cwd: string, plan: PushPlan, options: PushOptions): Promise<PushResult> {
  let committed: PushResult['commit'] = null;
  let status = await worktreeStatus(cwd).catch((error: Error) => {
    throw new PushError(error.message);
  });
  if (plan.commit && status.uncommitted > 0) {
    const message = plan.message?.trim();
    if (!message) throw new PushError('Write a commit message first.');
    options.onStep('commit');
    const result = await commitAll(cwd, message, options.env);
    if (!result.ok) throw new PushError(`The commit failed. ${firstUsefulLine(result.output) || result.output}`);
    committed = { sha: result.sha, files: result.files };
    status = await worktreeStatus(cwd).catch((error: Error) => {
      throw new PushError(error.message);
    });
  }
  if (!status.branch) throw new PushError('The run’s folder isn’t on a branch, so there is nothing to push.');
  if (!status.hasRemote || !status.pushRemote) throw new PushError('This repository has no remote to push to.');
  if (plan.pullRequest) {
    const base = plan.pullRequest.base ?? status.baseBranch ?? 'main';
    try {
      const result = await createPullRequest(
        status,
        { title: plan.pullRequest.title.trim() || status.branch, body: plan.pullRequest.body, base, draft: plan.pullRequest.draft, web: false },
        { env: options.env, gh: options.gh, onStep: options.onStep },
      );
      if ('pr' in result) return { commit: committed, pr: result.pr, compareUrl: null, note: `Pull request #${result.pr.number} opened` };
      return { commit: committed, pr: null, compareUrl: result.compareUrl, note: 'Pushed. Open the pull request on GitHub' };
    } catch (error) {
      if (error instanceof PrFailure) throw new PushError(error.error.message);
      throw error;
    }
  }
  if (!status.upstream || (status.unpushed ?? 0) > 0) {
    options.onStep('push');
    try {
      // Pre-push hooks can run tests: give them time.
      await git(status.path, status.upstream ? ['push'] : ['push', '-u', status.pushRemote, status.branch], { env: { ...options.env, GIT_TERMINAL_PROMPT: '0' }, timeout: 10 * 60_000 });
    } catch (error) {
      const output = error instanceof GitError ? error.message : String(error);
      throw new PushError(`The push failed. ${firstUsefulLine(output) || output}`);
    }
  }
  return { commit: committed, pr: null, compareUrl: null, note: committed ? `Committed ${committed.files === 1 ? '1 file' : `${committed.files} files`} and pushed ${status.branch}` : `Pushed ${status.branch}` };
}
