import { limitKindName, type LimitResume, type LimitsState, type UsageLimitHit } from '@switchboard/protocol/client';
import { resetLabel } from '../components/usageFormat.ts';

// The words for a plan usage limit that stopped a session: its notice above the message box, the sidebar row, Up
// next and the queue. Pure, so they are tested without React.

/** "5-hour limit", "Weekly Opus limit"; "Usage limit" when Claude Code didn't say which. */
export const limitName = limitKindName;

// "15:16" or "Mon 15:16", and whether a limit still holds by the clock: shared with the queue's rules in the engine.
export { clockTime, limitAhead } from '@switchboard/protocol/client';
import { clockTime } from '@switchboard/protocol/client';

/**
 * The notice's line: "5-hour limit reached. Resets at 15:16 · in 4h 42m". Without a reset time it only says it was
 * reached; once the time has passed, that it has reset (a turn still has to get through to clear it).
 */
export function limitHeadline(limit: Pick<UsageLimitHit, 'kind' | 'resetsAt'>, now = Date.now(), locale?: string): string {
  const name = `${limitName(limit.kind)} reached`;
  if (limit.resetsAt === null) return `${name}.`;
  const at = clockTime(limit.resetsAt, now, locale);
  if (limit.resetsAt <= now) return `${name}. It reset at ${at}.`;
  return `${name}. Resets at ${at} · in ${resetLabel(limit.resetsAt, now, locale)}`;
}

/** "Resumes at 15:16": an armed session, after the grace period. */
export function resumeLine(resume: Pick<LimitResume, 'at'> & Partial<LimitResume>, now = Date.now(), locale?: string): string {
  return `Resumes at ${clockTime(resume.at, now, locale)}`;
}

/** "2 messages held": queued messages waiting for the limit. Null when none are. */
export function heldLine(count: number): string | null {
  if (count === 0) return null;
  return count === 1 ? '1 message held' : `${count} messages held`;
}

/** The sidebar row's line: "Usage limit · resets 15:16", or "Usage limit". */
export function rowLimitLabel(limit: UsageLimitHit, now = Date.now(), locale?: string): string {
  return limit.resetsAt !== null && limit.resetsAt > now ? `Usage limit · resets ${clockTime(limit.resetsAt, now, locale)}` : 'Usage limit';
}

/** The limit a profile is at, or null. */
export function limitOf(state: LimitsState, profileId: string): UsageLimitHit | null {
  return state.limits.find((l) => l.profileId === profileId) ?? null;
}

/** How a session stands with its profile's limit: stopped by it (it offers to resume), only at it, or neither. */
export type LimitStanding = { kind: 'stopped' | 'at'; limit: UsageLimitHit; resume: LimitResume | null; gaveUp: boolean } | null;

export function limitStanding(state: LimitsState, sessionId: string, profileId: string): LimitStanding {
  const limit = limitOf(state, profileId);
  if (!limit) return null;
  const resume = state.resumes.find((r) => r.sessionId === sessionId) ?? null;
  const gaveUp = state.gaveUp.includes(sessionId);
  // An armed or given-up session was stopped by it too, even after its resume took it off the list.
  const stopped = limit.sessionIds.includes(sessionId) || resume !== null || gaveUp;
  return { kind: stopped ? 'stopped' : 'at', limit, resume, gaveUp };
}

/** The limit that stopped this session (it waits to resume), or null; the same object while nothing changes. */
export function stoppedBy(state: LimitsState, sessionId: string, profileId: string): UsageLimitHit | null {
  const standing = limitStanding(state, sessionId, profileId);
  return standing?.kind === 'stopped' ? standing.limit : null;
}
