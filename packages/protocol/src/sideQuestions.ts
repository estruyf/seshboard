import { z } from 'zod';

/**
 * A question asked about a session (Ask about this session, or `/btw`) and its answer. Claude answers from the
 * session's conversation and the project, with read-only tools, and nothing of it goes into the conversation: it is
 * kept by Seshboard, per session, apart from the transcript.
 */
export const AskItem = z.object({
  id: z.string(),
  question: z.string(),
  /** The answer as markdown; empty when it failed. */
  answer: z.string(),
  /** Epoch ms when it was asked. */
  at: z.number(),
  /** Why there is no answer. */
  error: z.string().optional(),
});
export type AskItem = z.infer<typeof AskItem>;

/** Questions that follow on from each other: each one is asked with the earlier questions and answers of its thread. */
export const AskThread = z.object({
  id: z.string(),
  /** The first question, shortened. */
  title: z.string(),
  createdAt: z.number(),
  /** Oldest first. */
  items: z.array(AskItem),
});
export type AskThread = z.infer<typeof AskThread>;

/**
 * An answer coming in for `session.ask`: `delta` adds to the answer, `reset` drops what came so far (Claude went
 * on to read something and will write its answer after), then one event with `done` ends it, with the whole
 * `answer`, or `error` when it failed.
 */
export const AskEvent = z.object({
  sessionId: z.string(),
  threadId: z.string(),
  id: z.string(),
  delta: z.string().optional(),
  reset: z.boolean().optional(),
  done: z.boolean().optional(),
  answer: z.string().optional(),
  error: z.string().optional(),
});
export type AskEvent = z.infer<typeof AskEvent>;

/** A session's threads, newest first. */
export const AskThreadList = z.object({ threads: z.array(AskThread) });
export type AskThreadList = z.infer<typeof AskThreadList>;
