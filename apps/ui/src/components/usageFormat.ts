import type { UsageLimit, UsageSnapshot } from '@switchboard/protocol/client';

/** "5h", "7d", "7d · Fable" for the server's meter kinds. */
export function limitLabel(limit: UsageLimit): string {
  const base = limit.kind === 'session' ? '5h' : limit.group === 'weekly' || limit.kind.startsWith('weekly') ? '7d' : limit.kind.replace(/_/g, ' ');
  return limit.scope ? `${base} · ${limit.scope}` : base;
}

/** "4h3m", "3d1h", "12m", "now". */
export function countdown(resetsAt: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((resetsAt - now) / 60_000));
  if (minutes < 1) return 'now';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${mins}m`;
  return `${mins}m`;
}

/**
 * When a window resets, for the line after its meter: "3h 10m" or "45m" within a day, else the
 * weekday ("Mon"). `locale` is for tests; the app uses the system's.
 */
export function resetLabel(resetsAt: number, now = Date.now(), locale?: string): string {
  const minutes = Math.max(0, Math.round((resetsAt - now) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes >= 24 * 60) return new Date(resetsAt).toLocaleDateString(locale, { weekday: 'short' });
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (!hours) return `${mins}m`;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

/** The 5-hour and weekly windows, plus scoped ones once they're in use. */
export function visibleLimits(limits: UsageLimit[]): UsageLimit[] {
  return limits.filter((l) => l.kind === 'session' || l.kind === 'weekly_all' || l.percent >= 1);
}

/** "5-hour limit: 6% used, resets in 4h3m": a meter's pill in words, for VoiceOver (the ring and "5h" don't read well). */
export function spokenLimit(limit: UsageLimit, now = Date.now()): string {
  const name = limit.kind === 'session' ? '5-hour limit' : limitLabel(limit).startsWith('7d') ? 'Weekly limit' : `${limit.kind.replace(/_/g, ' ')} limit`;
  const scoped = limit.scope ? `${name} (${limit.scope})` : name;
  const severity = limit.severity === 'critical' ? ', nearly used up' : limit.severity === 'warning' ? ', getting close' : '';
  const reset = limit.resetsAt ? `, resets in ${countdown(limit.resetsAt, now)}` : '';
  return `${scoped}: ${Math.round(limit.percent)}% used${severity}${reset}`;
}

/**
 * A usage bar's tooltip: every window on a line ("5h: 38% used, resets in 2h14m"), then what a click does.
 */
export function usageSummary(limits: UsageLimit[], now = Date.now()): string {
  const lines = limits.map((l) => `${limitLabel(l)}: ${Math.round(l.percent)}% used${l.resetsAt ? `, resets in ${countdown(l.resetsAt, now)}` : ''}`);
  return [...lines, 'Click to see what used it'].join('\n');
}

/** A profile's usage once it has been asked for: the numbers (null when there are none) and why the last fetch failed. */
export interface UsageEntry {
  usage: UsageSnapshot | null;
  error: string | null;
}

/**
 * The entry after a fetch or an update. A failed fetch keeps the numbers already shown (they are
 * still the best guess) and records why; any new numbers clear the error.
 */
export function nextUsageEntry(prev: UsageEntry | undefined, result: { usage: UsageSnapshot | null; error?: string | null }): UsageEntry {
  if (result.usage) return { usage: result.usage, error: null };
  if (result.error) return { usage: prev?.usage ?? null, error: result.error };
  return { usage: null, error: null };
}

/** What a usage card says while it has no limits to show. */
export function usageMessage(entry: UsageEntry | undefined): string {
  if (!entry) return 'Loading usage…';
  if (entry.error && !entry.usage) return 'Usage unavailable';
  return 'No plan limits reported.';
}
