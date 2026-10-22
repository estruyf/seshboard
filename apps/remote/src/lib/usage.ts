import type { RemoteProfileUsage, UsageLimit, UsageSnapshot } from '@switchboard/protocol/remote-client';

/**
 * Plan usage on Home, as the computer's Home shows it: a bar per window in the level's colour, with when it resets.
 * Pure, with tests; the same rules as the app's `usageFormat.ts` and `levels.ts`.
 */

/** The 5-hour and weekly windows, plus scoped ones (a model's week) once they're in use. */
export function visibleLimits(limits: readonly UsageLimit[]): UsageLimit[] {
  return limits.filter((l) => l.kind === 'session' || l.kind === 'weekly_all' || l.percent >= 1);
}

/** "5h", "Week", "Week · Opus". */
export function limitName(limit: UsageLimit): string {
  const base = limit.kind === 'session' ? '5h' : limit.group === 'weekly' || limit.kind.startsWith('weekly') ? 'Week' : limit.kind.replace(/_/g, ' ');
  return limit.scope ? `${base} · ${limit.scope}` : base;
}

/** "4h3m", "3d1h", "12m", "now". */
export function countdown(resetsAt: number, now: number): string {
  const minutes = Math.max(0, Math.round((resetsAt - now) / 60_000));
  if (minutes < 1) return 'now';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${mins}m`;
  return `${mins}m`;
}

/** "5-hour limit: 44% used, resets in 3h2m", for screen readers (the bar and "5h" don't read well). */
export function spokenLimit(limit: UsageLimit, now: number): string {
  const name = limit.kind === 'session' ? '5-hour limit' : limitName(limit).startsWith('Week') ? 'Weekly limit' : `${limit.kind.replace(/_/g, ' ')} limit`;
  const scoped = limit.scope ? `${name} (${limit.scope})` : name;
  const reset = limit.resetsAt ? `, resets in ${countdown(limit.resetsAt, now)}` : '';
  return `${scoped}: ${Math.round(limit.percent)}% used${reset}`;
}

export type Level = 'ok' | 'caution' | 'high';

/** Green under 60%, orange from 60% to 85%, red from 85% on (AGENTS.md, Status colours). */
export function levelOf(percent: number): Level {
  if (!Number.isFinite(percent) || percent < 60) return 'ok';
  return percent < 85 ? 'caution' : 'high';
}

export const LEVEL_FILL: Record<Level, string> = { ok: 'bg-ok', caution: 'bg-caution', high: 'bg-error' };
export const LEVEL_TEXT: Record<Level, string> = { ok: '', caution: 'text-caution', high: 'text-error' };

/** "On mystic and studio", "On mystic, studio and laptop": the computers a profile's account is on. */
export function onComputers(names: readonly string[]): string {
  return names.length < 2 ? `On ${names[0] ?? ''}` : `On ${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** What a card says while it has no bars to show. */
export function usageMessage(entry: Pick<RemoteProfileUsage, 'usage' | 'error'>): string {
  if (entry.error && !entry.usage) return 'Usage unavailable';
  return 'No plan limits reported.';
}

/**
 * The list after `usage.changed`: the profile's new numbers, or its old ones when the check brought none (they are
 * still the best guess). A profile the list doesn't have waits for the next `usage.get`.
 */
export function withUsage(list: readonly RemoteProfileUsage[], profileId: string, usage: UsageSnapshot | null): RemoteProfileUsage[] {
  return list.map((entry) => (entry.profile.id === profileId && usage ? { ...entry, usage, error: null } : entry));
}
