import { z } from 'zod';

/**
 * GitHub issues and pull requests through the GitHub CLI (`gh`), for the `#` list in the message box, New session from
 * an issue or pull request, and saved prompts' `issue` and `pr` blanks. Seshboard only reads from GitHub.
 */

/**
 * Why a list is empty or old, or `ok`. `no-gh`: the GitHub CLI isn't installed; `not-signed-in`: `gh auth login`
 * hasn't been run; `not-github`: the project has no remote on GitHub. The rest come from a call that failed:
 * `rate-limited`, `offline` and `failed` (anything else), and keep the last list that worked.
 */
export const GithubReason = z.enum(['ok', 'no-gh', 'not-signed-in', 'not-github', 'rate-limited', 'offline', 'failed']);
export type GithubReason = z.infer<typeof GithubReason>;

export const GithubItemType = z.enum(['issue', 'pr']);
export type GithubItemType = z.infer<typeof GithubItemType>;

/** A label, with its colour as GitHub has it (six hex digits, no `#`). */
export const GithubLabel = z.object({ name: z.string(), color: z.string() });
export type GithubLabel = z.infer<typeof GithubLabel>;

/** An issue or pull request in the `#` list. The pull request fields are only there for a pull request. */
export const GithubListItem = z.object({
  type: GithubItemType,
  /** `owner/name`. */
  repo: z.string(),
  number: z.number().int(),
  title: z.string(),
  state: z.enum(['open', 'closed', 'merged']),
  labels: z.array(GithubLabel),
  /** The login of who opened it. */
  author: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  url: z.string(),
  /** Its branch. */
  headRefName: z.string().optional(),
  isDraft: z.boolean().optional(),
  /** From a fork. */
  isCrossRepository: z.boolean().optional(),
  /** The owner of the fork (or of the repository) the branch is in. */
  headOwner: z.string().nullable().optional(),
  /** Review threads not resolved yet; left out when GitHub didn't say. */
  unresolved: z.number().int().optional(),
});
export type GithubListItem = z.infer<typeof GithubListItem>;

/** A review comment on a thread that isn't resolved: where, who, and its first comment. */
export const GithubReviewComment = z.object({
  path: z.string(),
  line: z.number().int().nullable(),
  author: z.string().nullable(),
  body: z.string(),
});
export type GithubReviewComment = z.infer<typeof GithubReviewComment>;

/** An issue with its text, for the chip and for what Claude gets. */
export const GithubIssueDetail = GithubListItem.extend({
  body: z.string(),
  /** How many comments it has. */
  comments: z.number().int(),
});
export type GithubIssueDetail = z.infer<typeof GithubIssueDetail>;

/** A pull request with its text, branches and the review comments still open. */
export const GithubPrDetail = GithubIssueDetail.extend({
  headRefName: z.string(),
  baseRefName: z.string(),
  /** The commit its branch is at. */
  headOid: z.string(),
  isDraft: z.boolean(),
  isCrossRepository: z.boolean(),
  headOwner: z.string().nullable(),
  /** You can push to its branch (your repository, your fork, or a fork that lets maintainers change it). */
  canPush: z.boolean(),
  reviewComments: z.array(GithubReviewComment),
});
export type GithubPrDetail = z.infer<typeof GithubPrDetail>;

/** What `github.search` finds: open issues and pull requests (at most 10 of each), and why there are none. */
export const GithubSearchResult = z.object({
  /** The project's repository on GitHub, `owner/name`; null when it has none. */
  repo: z.string().nullable(),
  reason: GithubReason,
  /** What went wrong, in gh's words, when `reason` is a failure. */
  message: z.string().nullable(),
  issues: z.array(GithubListItem),
  pullRequests: z.array(GithubListItem),
  /** The lists are the last ones that worked, kept because this call failed. */
  stale: z.boolean(),
});
export type GithubSearchResult = z.infer<typeof GithubSearchResult>;

/**
 * Where a session started from: the issue or pull request New session filled in. `readOnly` is a pull request from a
 * fork you can't push to: Seshboard doesn't push or create a pull request from that session.
 */
export const GithubOrigin = z.object({
  type: GithubItemType,
  repo: z.string().regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/),
  number: z.number().int().positive(),
  readOnly: z.boolean().default(false),
});
export type GithubOrigin = z.infer<typeof GithubOrigin>;
