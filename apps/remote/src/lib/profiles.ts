import type { RemoteProfileUsage } from '@switchboard/protocol/remote-client';
import { levelOf, visibleLimits, type Level } from './usage.ts';

/**
 * Every profile's usage in little room: the first screen's usage card and the drawer's Home row. Which profiles come
 * first (the closest to a limit), and how they read. Pure, with tests.
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

export interface CompactProfile {
  id: string;
  name: string;
  color: RemoteProfileUsage['profile']['color'];
  /** Rounded, or null with no numbers. */
  percent: number | null;
  level: Level;
}

/**
 * The drawer's Home row: each profile with the highest of its limits ("● Work 82%   ● Personal 18%"), or with three
 * or more only the closest to its limit, plus how many more there are ("+2").
 */
export function compactProfiles(usage: readonly RemoteProfileUsage[]): { items: CompactProfile[]; more: number } {
  if (usage.length < 2) return { items: [], more: 0 };
  const shown = usage.length >= 3 ? byClosest(usage).slice(0, 1) : [...usage];
  return {
    items: shown.map((entry) => {
      const percent = highestPercent(entry);
      return { id: entry.profile.id, name: entry.profile.name, color: entry.profile.color, percent: percent === null ? null : Math.round(Math.min(100, Math.max(0, percent))), level: levelOf(percent ?? 0) };
    }),
    more: usage.length - shown.length,
  };
}

/** The same, as one line: "Work 82%, Personal 18%", "Work 82%, 2 more". For screen readers and tooltips. */
export function compactText(compact: { items: readonly CompactProfile[]; more: number }): string {
  const parts = compact.items.map((item) => (item.percent === null ? item.name : `${item.name} ${item.percent}%`));
  if (compact.more > 0) parts.push(`${compact.more} more`);
  return parts.join(', ');
}
