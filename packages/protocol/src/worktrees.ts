import { z } from 'zod';
import { AbsolutePath } from './absolutePath.ts';

/** A pull request for a worktree's branch, from `gh` (when it is installed and signed in). */
export const WorktreePullRequest = z.object({
  number: z.number(),
  state: z.enum(['open', 'merged', 'closed']),
  url: z.string(),
});
export type WorktreePullRequest = z.infer<typeof WorktreePullRequest>;

/** One entry of `git worktree list`, with what it takes to decide whether it can go. */
export const WorktreeEntry = z.object({
  path: z.string(),
  /** The folder's name (the worktree's name under `.claude/worktrees/`). */
  name: z.string(),
  /** Null on a detached HEAD. */
  branch: z.string().nullable(),
  head: z.string().nullable(),
  /** The repository's own checkout: never removed. */
  isMain: z.boolean(),
  isLocked: z.boolean(),
  lockReason: z.string().nullable(),
  /** The folder is gone but git still lists it (`prunable`); `git worktree prune` clears it. */
  missing: z.boolean(),
  /** Inside `<root>/.claude/worktrees/`, where Claude Code makes them. Only these are suggested for clean-up. */
  underClaudeDir: z.boolean(),
  /** Changed and new files not committed yet. */
  uncommitted: z.number(),
  /** Commits on the branch that the base (origin's default branch) doesn't have, and the other way round. Null without a base. */
  ahead: z.number().nullable(),
  behind: z.number().nullable(),
  /** The branch has commits of its own and all of them are in the base (by ancestry with `origin/<base>`). */
  merged: z.boolean(),
  /** The newest pull request for the branch; null without one, or without `gh`. */
  pr: WorktreePullRequest.nullable(),
  upstream: z.string().nullable(),
  /** Commits beyond the base that no remote has: what deleting the branch would lose. */
  unpushed: z.number(),
  /** It has an upstream with everything on it, or its own commits are all on a remote. */
  pushed: z.boolean(),
  /** The newest of the last commit, the folder's change time and the latest session in it. */
  lastActivity: z.number().nullable(),
  /** Known sessions whose folder is in this worktree (not in a worktree nested inside it). */
  sessions: z.array(z.string()),
});
export type WorktreeEntry = z.infer<typeof WorktreeEntry>;

export const WorktreeList = z.object({
  /** The main checkout. */
  root: z.string(),
  /** The branch worktrees merge into; null when none was found. */
  baseBranch: z.string().nullable(),
  /** `gh` answered, so pull requests are known. */
  pullRequests: z.boolean(),
  worktrees: z.array(WorktreeEntry),
});
export type WorktreeList = z.infer<typeof WorktreeList>;

/** A worktree's size on disk, and when it was measured. */
export const WorktreeSize = z.object({ path: z.string(), bytes: z.number(), at: z.number() });
export type WorktreeSize = z.infer<typeof WorktreeSize>;

export const WorktreeRemoveItem = z.object({
  path: AbsolutePath,
  deleteBranch: z.boolean().default(false),
  /** Save the branch's tip under `refs/switchboard/removed/<branch>-<date>` first. */
  recoveryRef: z.boolean().default(false),
});
export type WorktreeRemoveItem = z.infer<typeof WorktreeRemoveItem>;

export const WorktreeRemoveResult = z.object({
  path: z.string(),
  ok: z.boolean(),
  /** Why it was refused or failed: MAIN, LOCKED, UNCOMMITTED, SESSION_BUSY, NOT_FOUND, GIT_FAILED. */
  code: z.string().nullable(),
  error: z.string().nullable(),
  /** The worktree's folder was removed, or its stale entry pruned. */
  removed: z.boolean(),
  branchDeleted: z.boolean(),
  /** The ref that keeps the branch's commits, when one was saved. */
  recoveryRef: z.string().nullable(),
});
export type WorktreeRemoveResult = z.infer<typeof WorktreeRemoveResult>;
