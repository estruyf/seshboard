import { z } from 'zod';

/**
 * A side question (`/btw`) and its answer. Claude answers from the session's conversation without tools, and
 * nothing of it goes into the conversation: it is kept by Switchboard, per session, apart from the transcript.
 */
export const SideQuestion = z.object({
  id: z.string(),
  question: z.string(),
  /** The answer as markdown. */
  answer: z.string(),
  /** Epoch ms when it was asked. */
  at: z.number(),
});
export type SideQuestion = z.infer<typeof SideQuestion>;

/**
 * An answer coming in for `session.btw`: `delta` adds to the answer, then one event with `done` ends it, with
 * `error` when it failed (nothing is kept then). Claude Code sends the answer in one piece today, so a real
 * answer is one delta.
 */
export const SideQuestionEvent = z.object({
  sessionId: z.string(),
  id: z.string(),
  delta: z.string().optional(),
  done: z.boolean().optional(),
  error: z.string().optional(),
});
export type SideQuestionEvent = z.infer<typeof SideQuestionEvent>;

/** The side questions kept for a session; `unsupported` when this Claude Code can't show earlier ones. */
export const SideQuestionList = z.object({
  items: z.array(SideQuestion),
  unsupported: z.boolean(),
});
export type SideQuestionList = z.infer<typeof SideQuestionList>;
