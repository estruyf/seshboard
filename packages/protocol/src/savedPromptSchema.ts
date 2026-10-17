import { z } from 'zod';
import { AbsolutePath } from './absolutePath.ts';
import { PROMPT_NAME_MAX, PROMPT_TEXT_MAX } from './savedPrompts.ts';


export const SavedPromptId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'Use lowercase letters, digits and dashes');

/**
 * Where a saved prompt is kept: `global` in every project, `personal` in one project just for you (both in the
 * engine's database), or `shared` in one project's .switchboard.json, under `prompts`, for everyone who has it.
 */
export const PromptScope = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }),
  z.object({ kind: z.literal('personal'), root: AbsolutePath }),
  z.object({ kind: z.literal('shared'), root: AbsolutePath }),
]);
export type PromptScope = z.infer<typeof PromptScope>;

/** What is saved of a prompt: its blanks are written in the text (see `savedPrompts.ts`). */
export const SavedPromptInput = z.object({
  /** Leave out to create one: the id is made from the name. */
  id: SavedPromptId.optional(),
  name: z.string().trim().min(1, 'Give the prompt a name').max(PROMPT_NAME_MAX),
  text: z.string().min(1, 'Write the prompt').max(PROMPT_TEXT_MAX),
  scope: PromptScope,
});
export type SavedPromptInput = z.infer<typeof SavedPromptInput>;

export const SavedPrompt = z.object({
  id: SavedPromptId,
  name: z.string(),
  text: z.string(),
  scope: PromptScope,
  createdAt: z.number(),
  updatedAt: z.number(),
  /** How often it was sent, and when last: for ordering. Shared prompts' counts are yours, never in the file. */
  uses: z.number().int(),
  lastUsedAt: z.number().nullable(),
});
export type SavedPrompt = z.infer<typeof SavedPrompt>;

/** An open pull request, for a `pr` blank. */
export const GithubPullRequest = z.object({
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  draft: z.boolean(),
  /** "approved", "changes requested", "review required", or null when GitHub says nothing. */
  review: z.string().nullable(),
  /** How many reviews it has. */
  reviews: z.number().int(),
  branch: z.string(),
});
export type GithubPullRequest = z.infer<typeof GithubPullRequest>;

export const GithubIssue = z.object({ number: z.number().int(), title: z.string(), url: z.string() });
export type GithubIssue = z.infer<typeof GithubIssue>;
