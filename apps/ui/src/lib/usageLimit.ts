import type { LimitResume, LimitsState, UsageLimitHit } from '@switchboard/protocol/client';
import { resetLabel } from '../components/usageFormat.ts';

// The words for a plan usage limit that stopped a session: its notice above the message box, the sidebar row, Up
// next and the queue. Pure, so they are tested without React.

/** Claude Code's limit kinds in plain words. */
const KIND_NAME: Record<string, string> = {
  five_hour: '5-hour limit',
  seven_day: 'Weekly limit',
  seven_day_opus: 'Weekly Opus limit',
  seven_day_sonnet: 'Weekly Sonnet limit',
  seven_day_overage_included: 'Weekly limit',
  overage: 'Extra usage limit',
};

/** "5-hour limit", "Weekly Opus limit"; "Usage limit" when Claude Code didn't say which. */
export function limitName(kind: string | null): string {
  return (kind && KIND_NAME[kind]) || 'Usage limit';
}

/** "15:16" today, or "Mon 15:16" further away. `locale` is for tests; the app uses the system's. */
export function clockTime(at: number, now = Date.now(), locale?: string): string {
  const time = new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const sameDay = new Date(at).toDateString() === new Date(now).toDateString();
  return sameDay ? time : `${new Date(at).toLocaleDateString(locale, { weekday: 'short' })} ${time}`;
}

/** Whether the limit still holds by the clock (it has no reset time, or that is still ahead). */
export const limitAhead = (limit: UsageLimitHit, now = Date.now()) => limit.resetsAt === null || limit.resetsAt > now;

/**
 * The notice's line: "5-hour limit reached. Resets at 15:16 · in 4h 42m". Without a reset time it only says it was
 * reached; once the time has passed, that it has reset (a turn still has to get through to clear it).
 */
export function limitHeadline(limit: UsageLimitHit, now = Date.now(), locale?: string): string {
  const name = `${limitName(limit.kind)} reached`;
  if (limit.resetsAt === null) return `${name}.`;
  const at = clockTime(limit.resetsAt, now, locale);
  if (limit.resetsAt <= now) return `${name}. It reset at ${at}.`;
  return `${name}. Resets at ${at} · in ${resetLabel(limit.resetsAt, now, locale)}`;
}

/** "Resumes at 15:16": an armed session, after the grace period. */
export function resumeLine(resume: LimitResume, now = Date.now(), locale?: string): string {
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
