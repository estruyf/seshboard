import { z } from 'zod';

/** A local day, `YYYY-MM-DD`, in the time zone of whoever asks. */
export const ActivityDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export type ActivityDay = z.infer<typeof ActivityDay>;

/** A pull request on a row of Activity. */
export const ActivityPr = z.object({ number: z.number().int(), url: z.string() });
export type ActivityPr = z.infer<typeof ActivityPr>;

/**
 * What one session did on one day, for Activity. A session that spans days has an entry per day it had turns, with only
 * that day's time. Everything is read from what Seshboard already keeps: the times from the transcripts (`usage_messages`,
 * `usage_prompts`), `did` from the catch-ups, the commits from git, the cost from the tokens.
 */
export const ActivityEntry = z.object({
  day: ActivityDay,
  sessionId: z.string(),
  title: z.string(),
  /** The session it sits under, for a computer's Mine filter. */
  parentId: z.string().nullable().optional(),
  /** Null only for a session whose folder is not known any more. */
  projectRoot: z.string().nullable(),
  projectName: z.string(),
  /** Its first and last moment that day. */
  firstAt: z.number(),
  lastAt: z.number(),
  /** The time Claude worked that day: the moments of its transcript, without the pauses between them. */
  activeMs: z.number().int().min(0),
  /** Your prompts that day. */
  turns: z.number().int().min(0),
  /** At API list prices, in US dollars. Null when no model's price is known. */
  costUsd: z.number().nullable(),
  /** The working time per local hour, 24 values. */
  hours: z.array(z.number().int().min(0)).length(24),
  /** The commits made during it that day, and the files they changed. */
  commits: z.number().int().min(0),
  files: z.number().int().min(0),
  prs: z.array(ActivityPr),
  /** What the catch-ups of that day's turns say it did, in order. */
  did: z.array(z.string()),
  /** What you asked that day, in order, shortened: all a session without catch-ups has to say. */
  asks: z.array(z.string()),
  /** Whether the session can still be opened: Claude Code deletes old transcripts. */
  available: z.boolean(),
});
export type ActivityEntry = z.infer<typeof ActivityEntry>;

/** Another computer's entry on its way here: its project as a name, never its folders. */
export const RemoteActivityEntry = ActivityEntry.omit({ projectRoot: true });
export type RemoteActivityEntry = z.infer<typeof RemoteActivityEntry>;

/** The day in short: a few lines by Haiku from that day's catch-ups. */
export const ActivitySummary = z.object({
  text: z.string(),
  generatedAt: z.number(),
  /** How many sessions it was written from. */
  sessions: z.number().int().min(0),
});
export type ActivitySummary = z.infer<typeof ActivitySummary>;

/** Why there is no summary, or that there is: `off` in Settings, `empty` a day without sessions, `failed` no answer in time. */
export const ActivitySummaryState = z.enum(['ok', 'off', 'empty', 'failed']);
export type ActivitySummaryState = z.infer<typeof ActivitySummaryState>;

/** A session from another computer that the day in short should count too (the engine only knows its own). */
export const ActivitySummaryExtra = z.object({
  title: z.string().max(300),
  projectName: z.string().max(300),
  activeMs: z.number().int().min(0),
  did: z.array(z.string().max(300)).max(8),
  asks: z.array(z.string().max(300)).max(8),
});
export type ActivitySummaryExtra = z.infer<typeof ActivitySummaryExtra>;

export { ACTIVITY_MAX_DAYS } from './activityConstants.ts';
