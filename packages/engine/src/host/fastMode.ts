import type { SessionHostInfo } from '@seshboard/protocol';

/** The notification Claude Code sends each turn a fast request is refused for lack of usage credits. */
export const FAST_CREDITS_NOTIFICATION = 'fast-mode-overage-rejected';

/** `fastModeBlocked` for those turns: Claude Code goes on reporting `on` while they run at standard speed. */
export const FAST_CREDITS_OUT = 'credits_exhausted';

/**
 * Reasons that aren't a problem to show. An SDK session reports `sdk_opt_in_required` until it asks for fast mode, and
 * `pending` while Claude Code checks whether it may.
 */
const NOT_BLOCKED = new Set(['sdk_opt_in_required', 'pending']);

const STATES = new Set(['off', 'on', 'cooldown']);

/**
 * The fast mode fields of an `init` or `result` message, for `SessionHostInfo`. Null for a Claude Code that doesn't send
 * them. Being out of credits stays until a request ran fast again (`blocked` is null then), since only that says so.
 */
export function fastModeReport(message: { fast_mode_state?: unknown; fast_mode_disabled_reason?: unknown }, blocked: string | null | undefined): Pick<SessionHostInfo, 'fastMode' | 'fastModeBlocked'> | null {
  const state = message.fast_mode_state;
  if (typeof state !== 'string' || !STATES.has(state)) return null;
  const reason = message.fast_mode_disabled_reason;
  const stated = typeof reason === 'string' && !NOT_BLOCKED.has(reason) ? reason : null;
  return { fastMode: state as SessionHostInfo['fastMode'], fastModeBlocked: stated ?? (state === 'on' && blocked === FAST_CREDITS_OUT ? blocked : null) };
}
