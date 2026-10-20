import { z } from 'zod';
import { LaterDraft } from './later.ts';
import { ruleProblem, type ScheduleRule } from './schedules.ts';

// Scheduled sessions (#173): what is stored and sent. The rules themselves (next runs, words) are in `schedules.ts`,
// without zod, for the UI.

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Pick a time');

/** On which days and at what local time a schedule runs. A week needs at least one day. */
export const ScheduleRuleSchema: z.ZodType<ScheduleRule> = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('once'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'), time: Time }),
    z.object({ kind: z.literal('daily'), time: Time }),
    z.object({ kind: z.literal('weekdays'), time: Time }),
    z.object({ kind: z.literal('weekly'), days: z.array(z.number().int().min(0).max(6)).max(7), time: Time }),
    z.object({ kind: z.literal('monthly'), day: z.number().int().min(1).max(31), time: Time }),
  ])
  .superRefine((rule, ctx) => {
    const problem = ruleProblem(rule);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

export const ScheduleMissedSchema = z.enum(['run', 'skip']);
export const ScheduleRunResultSchema = z.enum(['started', 'queued', 'skipped', 'missed', 'failed']);

/** The last run of a schedule. */
export const ScheduleLastRun = z.object({
  /** When it was due (or when Run now ran it). */
  at: z.number(),
  result: ScheduleRunResultSchema,
  /** The session it started (`started`), or the one that was still busy (`skipped`). */
  sessionId: z.string().max(200).nullable().default(null),
  /** The queued item it became (`queued`), while it is in the queue. */
  itemId: z.string().max(100).nullable().default(null),
  /** Why, in a few words: "the last run was still working", "Folder not found". */
  reason: z.string().max(300).nullable().default(null),
});
export type ScheduleLastRun = z.infer<typeof ScheduleLastRun>;

/** How many runs a schedule remembers (Upcoming shows today's past runs from them). */
export const SCHEDULE_HISTORY = 20;
/** How many single runs a schedule can have skipped ahead (Skip this run). */
export const SCHEDULE_SKIPS = 100;

/** A schedule: a prompt with its choices (a queued item's draft) that starts a new session at set times. */
export const Schedule = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  /** The prompt and New session's choices, kept like a queued item's (images included). */
  draft: LaterDraft,
  rule: ScheduleRuleSchema,
  /** What to do with runs that were due while Switchboard was closed: run once at the next start, or skip them. */
  missed: ScheduleMissedSchema.default('run'),
  paused: z.boolean().default(false),
  /** Why it was paused by Switchboard rather than by you ("Folder not found"); null when you paused it. */
  pausedReason: z.string().max(200).nullable().default(null),
  lastRun: ScheduleLastRun.nullable().default(null),
  /** Its last runs, newest first (at most `SCHEDULE_HISTORY`). */
  runs: z.array(ScheduleLastRun).max(SCHEDULE_HISTORY).default([]),
  /** Single runs you skipped (Skip this run), as ISO times. The timer treats them as done; past ones are cleaned up. */
  skippedRuns: z.array(z.iso.datetime()).max(SCHEDULE_SKIPS).default([]),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Schedule = z.infer<typeof Schedule>;
export type ScheduleInput = z.input<typeof Schedule>;

/** What `schedules.save` takes: a schedule without its times, runs and skipped runs (kept from the stored one). */
export const ScheduleSave = Schedule.omit({ createdAt: true, updatedAt: true, lastRun: true, runs: true, skippedRuns: true, pausedReason: true }).extend({
  id: z.string().min(1).max(100).optional(),
});
export type ScheduleSave = z.input<typeof ScheduleSave>;

/** A session a schedule started: the list shows the repeat icon on it. */
export const ScheduleSession = z.object({ sessionId: z.string(), scheduleId: z.string() });
export type ScheduleSession = z.infer<typeof ScheduleSession>;

/** One run, as main's notifier hears it. */
export const ScheduleRunEvent = z.object({
  scheduleId: z.string(),
  name: z.string(),
  result: ScheduleRunResultSchema,
  /** The session it started, or the busy last run's (`skipped`). */
  sessionId: z.string().nullable(),
  /** The new session's title ("Review open pull requests · Mon 19 Oct"). */
  title: z.string().nullable(),
  projectName: z.string(),
  reason: z.string().nullable(),
  /** It was due while Switchboard was closed or the computer slept. */
  missed: z.boolean(),
});
export type ScheduleRunEvent = z.infer<typeof ScheduleRunEvent>;
