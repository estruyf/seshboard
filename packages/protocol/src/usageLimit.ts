import { z } from 'zod';

/**
 * A Claude profile's plan stopped a turn: Claude Code said a usage limit was reached. The limit belongs to the
 * profile (its login), not to one session, so every session of the profile is at it until it is cleared: a turn in the
 * profile succeeds, or you resume.
 */
export const UsageLimitHit = z.object({
  profileId: z.string(),
  /** Claude Code's `rateLimitType` (`five_hour`, `seven_day`, `seven_day_opus`…); null when it didn't say. */
  kind: z.string().nullable(),
  /** When the limit resets (ms); null when Claude Code gave no time. */
  resetsAt: z.number().nullable(),
  /** When a turn first stopped on it. */
  since: z.number(),
  /** Claude Code's own words ("You've hit your limit · resets 3pm"), when it sent some. */
  message: z.string().nullable(),
  /** The sessions whose turn it stopped: they show Resume now and Resume when it resets. */
  sessionIds: z.array(z.string()),
});
export type UsageLimitHit = z.infer<typeof UsageLimitHit>;

/** A session that continues by itself once its profile's limit resets (Resume when it resets). */
export const LimitResume = z.object({
  sessionId: z.string(),
  profileId: z.string(),
  /** When it sends the message: the reset plus a grace period (ms). */
  at: z.number(),
  /** How many times it has tried; the limit can still refuse right after a reset. */
  attempts: z.number().int().min(0),
});
export type LimitResume = z.infer<typeof LimitResume>;

/** Every profile at a limit, every armed resume, and the sessions whose resume gave up after too many tries. */
export const LimitsState = z.object({
  limits: z.array(UsageLimitHit),
  resumes: z.array(LimitResume),
  gaveUp: z.array(z.string()),
});
export type LimitsState = z.infer<typeof LimitsState>;
