import { z } from 'zod';

/** What a catch-up asks of you next, which picks its colour and its primary action. */
export const CatchUpNeedKind = z.enum(['commit', 'reply', 'permission', 'question', 'review', 'none']);
export type CatchUpNeedKind = z.infer<typeof CatchUpNeedKind>;

/** The test run of a turn: the last test command that ran, with its counts when the output had them. */
export const CatchUpTests = z.object({
  state: z.enum(['passed', 'failed', 'notRun']),
  passed: z.number().int().min(0).optional(),
  failed: z.number().int().min(0).optional(),
  /** The command as it ran (shortened). */
  command: z.string().max(300).optional(),
});
export type CatchUpTests = z.infer<typeof CatchUpTests>;

/**
 * A short briefing at the top of a session when a turn finishes or the session waits for you, so you can decide what to
 * do next in a few seconds. One per session (the latest turn); a new message clears it. The signals are worked out from
 * the turn's tool calls and git, never by a model; `ask`, `did`, `skipped` and `need` come from a short Haiku summary
 * (`source: 'model'`) or, without one, from the tool calls (`fallback`). Waiting for you, `need` always comes from the
 * request itself.
 */
export const CatchUp = z.object({
  sessionId: z.string(),
  /** The assistant turn it summarises (the uuid of its last message); a new turn replaces it. */
  turnId: z.string(),
  generatedAt: z.number(),
  source: z.enum(['model', 'fallback']),
  /** How the turn stands: finished, stopped with an error, or waiting for a permission or an answer. */
  state: z.enum(['finished', 'error', 'waiting']),
  /** The prompt that started this piece of work. */
  ask: z.string().max(240),
  /** What Claude did, as 1–5 short plain lines. */
  did: z.array(z.string().max(200)).max(5),
  /** What was skipped, failed or not finished. */
  skipped: z.array(z.string().max(200)).max(3),
  need: z.object({
    kind: CatchUpNeedKind,
    /** "Commit the changes", "Allow a command". */
    title: z.string().max(120),
    /** One or two sentences. */
    text: z.string().max(400),
  }),
  signals: z.object({
    tests: CatchUpTests,
    diff: z.object({ files: z.number().int().min(0), add: z.number().int().min(0), del: z.number().int().min(0) }).nullable(),
    /** Changed files outside the plan, or outside what the ask names, relative to the checkout (absolute outside it). */
    outOfScope: z.array(z.string()).max(200),
    /** The scope `outOfScope` was checked against ("apps/ui"), for the chip; null without one. */
    scope: z.string().nullable(),
    /** Null when the session had no plan. */
    plan: z.enum(['followed', 'deviated']).nullable(),
  }),
  /** About how long it takes to look this over, 1–30. */
  reviewMinutes: z.number().int().min(1).max(30),
});
export type CatchUp = z.infer<typeof CatchUp>;
