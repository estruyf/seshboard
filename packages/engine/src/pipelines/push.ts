import type { PushPreview, WorktreeStatus } from '@seshboard/protocol';
import { commitContext } from '../git/commitMessage.ts';
import { git, GitError, stageForCommit, worktreeStatus } from '../git/gitChanges.ts';
import { createPullRequest, draftRefusal, firstUsefulLine, PrFailure, readPrDraft, type GhCommand } from '../git/pullRequest.ts';

export interface PushDeps {
  env: Record<string, string>;
  gh: GhCommand;
  /** The project's base branch for pull requests, when it has one set. */
  projectBase: string | null;
}

/**
 * What Push shows before it runs: Haiku's commit message from the diff (as Ask Claude to commit writes it), how many
 * files go in it, and the branch and base. `write` asks Haiku; a run with nothing to commit but commits to push still
 * pushes them, without a message.
 */
export async function previewPush(cwd: string, write: (input: NonNullable<Awaited<ReturnType<typeof commitContext>>>) => Promise<string | null>, deps: PushDeps): Promise<PushPreview> {
  let status: WorktreeStatus;
  try {
    status = await worktreeStatus(cwd);
  } catch {
    return { message: '', files: 0, branch: null, base: null, problem: 'This folder isn’t a git repository.' };
  }
  const refusal = draftRefusal(status);
  const base = refusal ? status.baseBranch : (await readPrDraft(status, { projectBase: deps.projectBase }).catch(() => null))?.base ?? status.baseBranch;
  const context = await commitContext(cwd).catch(() => null);
  if (!context && status.ahead === 0) return { message: '', files: 0, branch: status.branch, base, problem: 'There is nothing to commit or push.' };
  const message = context ? ((await write(context).catch(() => null)) ?? '') : '';
  return { message, files: context ? status.uncommitted : 0, branch: status.branch, base, problem: refusal?.message ?? null };
}

/** Commits everything with `message` (when there is anything to commit), pushes, and opens the pull request. */
export async function commitAndOpen(cwd: string, request: { message: string; title: string; body: string; draft: boolean }, deps: PushDeps): Promise<{ number: number; url: string } | null> {
  const files = await stageForCommit(cwd);
  if (files > 0) {
    if (!request.message.trim()) throw new Error('Write a commit message first.');
    try {
      // Commit hooks can run tests: give them time.
      await git(cwd, ['commit', '-m', request.message.trim()], { env: deps.env, timeout: 10 * 60_000 });
    } catch (error) {
      throw new Error(`The commit failed: ${firstUsefulLine(error instanceof GitError ? error.message : String(error))}`);
    }
  }
  const status = await worktreeStatus(cwd);
  const refusal = draftRefusal(status);
  if (refusal) throw new Error(refusal.message);
  const draft = await readPrDraft(status, { projectBase: deps.projectBase });
  try {
    const result = await createPullRequest(status, { title: request.title, body: request.body, base: draft.base, draft: request.draft, web: false }, { env: deps.env, gh: deps.gh, onStep: () => {} });
    return 'pr' in result ? { number: result.pr.number, url: result.pr.url } : null;
  } catch (error) {
    if (error instanceof PrFailure) throw new Error(error.error.message);
    throw error;
  }
}
