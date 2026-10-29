/**
 * Recognising a turn that a plan usage limit stopped, and when to resume it. Pure, so it is tested without Claude Code.
 */
import type { LimitsState, RemoteLimitStanding } from '@seshboard/protocol';

/** The API can still refuse right at the reset: a resume waits this long after it. */
export const RESUME_GRACE_MS = 30_000;

/** A resume that hits the limit again (the reset moved) tries again at the new reset, this many times in all. */
export const MAX_RESUME_ATTEMPTS = 3;

/** What a session is sent when it resumes after a usage limit. */
export const RESUME_PROMPT = 'Continue where you left off.';

/** What Claude Code's rate-limit update carries that matters here (`SDKRateLimitInfo`). */
export interface RateLimitUpdate {
  status?: string;
  rateLimitType?: string;
  resetsAt?: number;
}

/** What a limit that stopped a turn says about itself. */
export interface LimitStop {
  kind: string | null;
  resetsAt: number | null;
  message: string | null;
}

/**
 * The SDK's `USAGE_LIMIT_ERROR_PREFIXES` (the messages that mean a usage limit was really reached), when the SDK has
 * them. They are marked alpha: without them, only Claude Code's `rejected` rate-limit update says a limit was reached.
 */
export function limitPrefixes(sdk: unknown): readonly string[] {
  const prefixes = (sdk as { USAGE_LIMIT_ERROR_PREFIXES?: unknown } | null)?.USAGE_LIMIT_ERROR_PREFIXES;
  return Array.isArray(prefixes) ? prefixes.filter((p): p is string => typeof p === 'string' && p !== '') : [];
}

/** Whether Claude Code's message says a usage limit was reached ("You've hit your limit · resets 3pm"). */
export function isUsageLimitText(text: string | null | undefined, prefixes: readonly string[]): boolean {
  if (!text) return false;
  const start = text.trimStart();
  return prefixes.some((prefix) => start.startsWith(prefix));
}

/** A reset time in ms: Claude Code sends seconds, older builds ms. */
export function resetMs(resetsAt: unknown): number | null {
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt) || resetsAt <= 0) return null;
  return resetsAt < 1e12 ? resetsAt * 1000 : resetsAt;
}

/**
 * Whether a failed turn stopped on a usage limit, and what is known about it: Claude Code's message starts as a usage
 * limit's does, or it reported the limit `rejected` during the turn. Null for any other failure.
 */
export function limitStop(input: { error: string | null; rejected: RateLimitUpdate | null; last: RateLimitUpdate | null; prefixes: readonly string[] }): LimitStop | null {
  const byText = isUsageLimitText(input.error, input.prefixes);
  if (!byText && !input.rejected) return null;
  const info = input.rejected ?? input.last;
  return {
    kind: info?.rateLimitType ?? null,
    resetsAt: resetMs(info?.resetsAt),
    message: byText ? input.error!.trim().slice(0, 300) : null,
  };
}

/** When a session armed to resume sends its message: the reset plus the grace period. Null without a reset time. */
export function resumeTime(resetsAt: number | null): number | null {
  return resetsAt === null ? null : resetsAt + RESUME_GRACE_MS;
}

/**
 * When the /usage report says a limit resets, for a stop that came without a time: the meter for its kind (the 5-hour
 * window, or a weekly one), else whichever meter is full.
 */
export function snapshotReset(meters: ReadonlyArray<{ kind: string; percent: number; resetsAt: number | null }>, kind: string | null): number | null {
  const weekly = kind?.startsWith('seven_day') ?? false;
  const matching = meters.filter((m) => m.resetsAt !== null && (kind === 'five_hour' ? m.kind === 'session' : weekly ? m.kind.startsWith('weekly') : false));
  const full = meters.filter((m) => m.resetsAt !== null && m.percent >= 100);
  // The fullest meter of the kind is the one that stopped the turn.
  const pick = [...(matching.length ? matching : full)].sort((a, b) => b.percent - a.percent)[0];
  return pick?.resetsAt ?? null;
}

/**
 * How a session stands with its profile's limit for a phone or another computer (the notice above the message box):
 * null when the profile isn't at one. As `limitStanding` in the app's UI, without the profile's id.
 */
export function remoteLimit(state: LimitsState, sessionId: string, profileId: string): RemoteLimitStanding | null {
  const limit = state.limits.find((l) => l.profileId === profileId);
  if (!limit) return null;
  const resume = state.resumes.find((r) => r.sessionId === sessionId) ?? null;
  const gaveUp = state.gaveUp.includes(sessionId);
  // An armed or given-up session was stopped by it too, even after its resume took it off the list.
  const stopped = limit.sessionIds.includes(sessionId) || resume !== null || gaveUp;
  return { stopped, kind: limit.kind, resetsAt: limit.resetsAt, resumeAt: resume?.at ?? null, gaveUp };
}
