import type { RemoteProfileUsage } from '@seshboard/protocol/remote-client';
import { visibleLimits } from './usage.ts';

/**
 * Every profile's usage in little room: the first screen's usage card. Which profiles come first (the closest to a limit), and how they read. Pure, with tests.
 */

/** The highest share used of a profile's windows, or null with no numbers. */
export function highestPercent(entry: RemoteProfileUsage): number | null {
  const limits = entry.usage ? visibleLimits(entry.usage.limits) : [];
  return limits.length ? Math.max(...limits.map((l) => l.percent)) : null;
}

/** The share used of one window (`session`: the 5 hours, `weekly_all`: the week), or null when it isn't reported. */
export function windowPercent(entry: RemoteProfileUsage, kind: 'session' | 'weekly_all'): number | null {
  return entry.usage?.limits.find((l) => l.kind === kind)?.percent ?? null;
}

/** Closest to a limit first; profiles without numbers last, each group in the computer's order. */
export function byClosest(usage: readonly RemoteProfileUsage[]): RemoteProfileUsage[] {
  return usage
    .map((entry, index) => ({ entry, index, percent: highestPercent(entry) }))
    .sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1) || a.index - b.index)
    .map((p) => p.entry);
}

/**
 * The rows of the first screen's usage card: every profile up to two, else the two closest to a limit and how many
 * more there are ("+N"). With two or fewer they keep the computer's order (the default first).
 */
export function cardRows(usage: readonly RemoteProfileUsage[]): { rows: RemoteProfileUsage[]; more: number } {
  if (usage.length <= 2) return { rows: [...usage], more: 0 };
  return { rows: byClosest(usage).slice(0, 2), more: usage.length - 2 };
}
