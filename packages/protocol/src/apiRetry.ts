import type { ApiRetry } from './host.ts';

/**
 * The line under a reply while Claude Code retries a failed API call, as the desktop and the phone say it. Pure, with
 * tests (`apiRetry.test.ts`).
 */

/** What went wrong, from the HTTP status: 529 is Anthropic's "overloaded", 429 a rate limit; anything else is an API error. */
export function apiRetryCause(status: number | null): string {
  if (status === 529) return 'API overloaded';
  if (status === 429) return 'API rate limited';
  return 'API error';
}

/** 8s, 1m 5s: the wait until the next try, rounded up so it never says 0s while it still waits. */
function wait(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/**
 * "API overloaded, retrying (3 of 10) in 8s". `now` counts the wait down; null (the phone, whose clock isn't this
 * computer's) leaves the time out, and so does a wait that is over: the try is on its way.
 */
export function apiRetryLine(retry: ApiRetry, now: number | null): string {
  const left = now === null ? 0 : retry.at + retry.delayMs - now;
  const tries = retry.maxRetries > 0 ? ` (${retry.attempt} of ${retry.maxRetries})` : '';
  return `${apiRetryCause(retry.status)}, retrying${tries}${left > 0 ? ` in ${wait(left)}` : ''}`;
}
