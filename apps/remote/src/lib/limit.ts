import { clockTime, limitKindName, type RemoteLimitStanding } from '@seshboard/protocol/remote-client';
import { countdown } from './usage.ts';

/**
 * The words of the usage limit notice above the message box, as on the computer: "5-hour limit reached. Resets at
 * 15:16 · in 4h42m". Pure, with tests.
 */

/** Without a reset time it only says it was reached; once the time has passed, that it has reset. */
export function limitHeadline(limit: Pick<RemoteLimitStanding, 'kind' | 'resetsAt'>, now: number): string {
  const name = `${limitKindName(limit.kind)} reached`;
  if (limit.resetsAt === null) return `${name}.`;
  const at = clockTime(limit.resetsAt, now);
  if (limit.resetsAt <= now) return `${name}. It reset at ${at}.`;
  return `${name}. Resets at ${at} · in ${countdown(limit.resetsAt, now)}`;
}

/** "Resumes at 15:16": an armed session, after the grace period. */
export function resumeLine(resumeAt: number, now: number): string {
  return `Resumes at ${clockTime(resumeAt, now)}`;
}

/** "2 messages held": queued messages waiting for the limit. Null when none are. */
export function heldLine(count: number): string | null {
  if (count === 0) return null;
  return count === 1 ? '1 message held' : `${count} messages held`;
}

/** Whether a limit still holds by the clock: without a reset time it is assumed to. */
export function limitHolds(limit: Pick<RemoteLimitStanding, 'resetsAt'>, now: number): boolean {
  return limit.resetsAt === null || limit.resetsAt > now;
}
