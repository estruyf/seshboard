// The focus limit's rules are shared with the engine (`@switchboard/protocol/client`); what is left here is wording.
export { focusLevel, focusSessions, focusVerdict, type FocusInput, type FocusLevel, type FocusPrefs, type FocusSession, type FocusState, type FocusVerdict } from '@switchboard/protocol/client';

/** "4th": the position a new session would take, for "Start a 4th session?". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long a session has waited: "now", "12m", "1h 12m", "2d 3h". */
export function waitedFor(since: number, now: number): string {
  const ms = Math.max(0, now - since);
  if (ms < MINUTE) return 'now';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`;
  if (ms < DAY) {
    const minutes = Math.floor((ms % HOUR) / MINUTE);
    return minutes ? `${Math.floor(ms / HOUR)}h ${minutes}m` : `${Math.floor(ms / HOUR)}h`;
  }
  const hours = Math.floor((ms % DAY) / HOUR);
  return hours ? `${Math.floor(ms / DAY)}d ${hours}h` : `${Math.floor(ms / DAY)}d`;
}

/** When a prompt was saved for later, in words: "just now", "5m ago", "3h ago", "yesterday", "3d ago", "Sep 21". */
export function savedAgo(at: number, now: number): string {
  const ms = Math.max(0, now - at);
  if (ms < MINUTE) return 'just now';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m ago`;
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  if (at >= midnight.getTime()) return `${Math.floor(ms / HOUR)}h ago`;
  if (at >= midnight.getTime() - DAY) return 'yesterday';
  if (ms < 7 * DAY) return `${Math.max(2, Math.round(ms / DAY))}d ago`;
  const date = new Date(at);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}
