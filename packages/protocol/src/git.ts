import { z } from 'zod';

/** `uncommitted`: working tree and index against HEAD. `branch`: everything since the branch left its base. */
export const ChangesBase = z.enum(['uncommitted', 'branch']);
export type ChangesBase = z.infer<typeof ChangesBase>;

export const ChangedFile = z.object({
  /** Relative to the repository root. */
  path: z.string(),
  status: z.enum(['added', 'modified', 'deleted', 'renamed', 'untracked', 'conflicted']),
  additions: z.number(),
  deletions: z.number(),
  /** Fully staged (uncommitted mode only). */
  staged: z.boolean(),
});
export type ChangedFile = z.infer<typeof ChangedFile>;

export const GitChanges = z.object({
  root: z.string(),
  branch: z.string().nullable(),
  /** The branch this one would merge into (origin's default, else main/master). */
  baseBranch: z.string().nullable(),
  base: ChangesBase,
  files: z.array(ChangedFile),
  error: z.string().nullable(),
});
export type GitChanges = z.infer<typeof GitChanges>;

export const WorktreeStatus = z.object({
  /** This checkout. */
  path: z.string(),
  /** The main repository. */
  root: z.string(),
  isWorktree: z.boolean(),
  branch: z.string().nullable(),
  baseBranch: z.string().nullable(),
  /** Commits on this branch that the base doesn't have, and the other way round. */
  ahead: z.number(),
  behind: z.number(),
  /** Changed and new files not committed yet. */
  uncommitted: z.number(),
  upstream: z.string().nullable(),
  /** Commits not pushed to the upstream; null without one. */
  unpushed: z.number().nullable(),
  /** Commits on the upstream that this checkout doesn't have yet (as of the last fetch); null without one. */
  behindUpstream: z.number().nullable(),
  hasRemote: z.boolean(),
  /** The remote a branch without an upstream is pushed to: origin when there is one, else the first. */
  pushRemote: z.string().nullable(),
  /** The main checkout, where a merge would happen. */
  mainCheckout: z.object({ branch: z.string().nullable(), dirty: z.boolean() }),
});
export type WorktreeStatus = z.infer<typeof WorktreeStatus>;

/** `fetch` updates the remote branches; `pull` and `push` sync the branch with its upstream. Pull requests go through `git.prCreate`. */
export const GitSyncAction = z.enum(['fetch', 'pull', 'push']);
export type GitSyncAction = z.infer<typeof GitSyncAction>;

/** A pull request template in the checkout, by its path from the top folder. */
export const PrTemplate = z.object({ path: z.string(), content: z.string() });
export type PrTemplate = z.infer<typeof PrTemplate>;

/** Everything the Create pull request dialog fills itself in with, for the branch checked out at a folder. */
export const PrDraft = z.object({
  /** The checkout's top folder. */
  path: z.string(),
  branch: z.string(),
  /** The remote the branch is pushed to, and whether it tracks a branch there already. */
  remote: z.string(),
  hasUpstream: z.boolean(),
  /** Commits that pushing would send. */
  ahead: z.number(),
  /** The commits the pull request would have (on the branch, not on the base), oldest first: subject lines. */
  commits: z.array(z.string()),
  files: z.number(),
  additions: z.number(),
  deletions: z.number(),
  /** The base branch it goes into: the one asked for, else the project's, the remote's default, then main. */
  base: z.string(),
  /** The remote's default branch, when known. */
  remoteDefault: z.string().nullable(),
  /** Branches on the remote that can be the base, most recently changed first. */
  branches: z.array(z.string()),
  /** `owner/name` on the remote's host, when the remote URL says. */
  repo: z.string().nullable(),
  /** Templates in GitHub's order: the single ones first, then the files in `.github/PULL_REQUEST_TEMPLATE/`. */
  templates: z.array(PrTemplate),
  /** The newest pull request for this branch, from `gh` (null: none, or unknown). */
  existingPr: z.object({ number: z.number(), state: z.enum(['open', 'merged', 'closed']), url: z.string(), draft: z.boolean().optional() }).nullable(),
  /** `signedIn` is null when gh couldn't tell (offline). */
  gh: z.object({ installed: z.boolean(), signedIn: z.boolean().nullable(), host: z.string() }),
});
export type PrDraft = z.infer<typeof PrDraft>;

/** Whether gh's account has starred Switchboard; `unavailable` without gh, signed out or offline. */
export const GithubStarStatus = z.enum(['starred', 'not-starred', 'unavailable']);
export type GithubStarStatus = z.infer<typeof GithubStarStatus>;

/** Why creating a pull request stopped, with what the dialog needs to say what to do next. */
export const PrErrorCode = z.enum(['GH_MISSING', 'GH_AUTH', 'PUSH_REJECTED', 'PR_EXISTS', 'BODY_TOO_LONG', 'UNKNOWN']);
export type PrErrorCode = z.infer<typeof PrErrorCode>;

export const PrError = z.object({
  code: PrErrorCode,
  /** One plain line. */
  message: z.string(),
  /** What git or gh printed, for Show output. */
  output: z.string().nullable(),
  /** PR_EXISTS: the pull request that is already there. */
  pr: z.object({ number: z.number(), url: z.string() }).nullable(),
});
export type PrError = z.infer<typeof PrError>;

/**
 * Progress of `git.prCreate`: the push and the create start, then it ends `done` (with the pull request, or the
 * compare page for `web`) or `failed`.
 */
export const PrProgress = z.object({
  jobId: z.string(),
  cwd: z.string(),
  step: z.enum(['push', 'create', 'done', 'failed']),
  pr: z.object({ number: z.number(), url: z.string(), draft: z.boolean() }).nullable(),
  /** `web`: the compare page to open. */
  compareUrl: z.string().nullable(),
  error: PrError.nullable(),
});
export type PrProgress = z.infer<typeof PrProgress>;
