import { matchOffsets } from '../../lib/findHighlights.ts';
import type { SettingsSection } from '../../state/sessionsStore.ts';

/** One thing in Settings you can search for: a control, or a heading over a group of them. */
export interface SettingEntry {
  /** Unique, and stable: the smoke test reports by it. */
  id: string;
  page: SettingsSection;
  /** The label, word for word as Settings shows it. */
  label: string;
  /** The line under it, shortened if it's long. */
  detail?: string;
  /** Other words people use for it, which the page doesn't say ("dark mode" for Appearance). */
  keywords?: string;
  /** A selector for an element in the setting's row, on its page: where a result jumps to. */
  target: string;
  /** Where to go when `target` isn't on screen, such as the switch that shows it. */
  fallback?: string;
  /** Shown on this platform only. */
  os?: 'darwin' | 'win32';
}

/** [start, end) offsets of the query's words in a text, for highlighting. */
export type Span = [number, number];

export interface SettingMatch {
  entry: SettingEntry;
  score: number;
  label: Span[];
  detail: Span[];
}

/** The query's words, lower-cased: each one has to be found somewhere in a setting. */
export const queryWords = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

const atWordStart = (text: string, at: number) => at === 0 || /[\s\-_/.:·(‘'"]/.test(text[at - 1]!);

/** Sorted, with overlapping and touching spans joined. */
function merge(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const [start, end] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

/**
 * The settings that hold every word of the query, in their label, the line under it, their keywords or
 * the name of their page. Best first: a word in the label counts most, more so at the start of a word.
 * Ties keep the order of the index, which is the order of the pages.
 */
export function searchSettings(query: string, entries: readonly SettingEntry[], pageLabel: (page: SettingsSection) => string, platform: string): SettingMatch[] {
  const words = queryWords(query);
  if (!words.length) return [];
  const found: Array<SettingMatch & { order: number }> = [];
  entries.forEach((entry, order) => {
    if (entry.os && entry.os !== platform) return;
    const label = entry.label.toLowerCase();
    const detail = (entry.detail ?? '').toLowerCase();
    const keywords = (entry.keywords ?? '').toLowerCase();
    const page = pageLabel(entry.page).toLowerCase();
    let score = 0;
    for (const word of words) {
      const inLabel = label.indexOf(word);
      if (inLabel !== -1) score += atWordStart(label, inLabel) ? 4 : 3;
      else if (keywords.includes(word)) score += 2;
      else if (page.includes(word)) score += 1.5;
      else if (detail.includes(word)) score += 1;
      else return;
    }
    found.push({
      entry,
      score,
      order,
      label: merge(words.flatMap((word) => matchOffsets(entry.label, word))),
      detail: merge(words.flatMap((word) => matchOffsets(entry.detail ?? '', word))),
    });
  });
  return found.sort((a, b) => b.score - a.score || a.order - b.order).map(({ order: _, ...match }) => match);
}

/** The matches grouped by page, the pages in the order of Settings' menu (`pageOrder`); within a page, best first. */
export function groupByPage(matches: readonly SettingMatch[], pageOrder: (page: SettingsSection) => number): Array<{ page: SettingsSection; matches: SettingMatch[] }> {
  const groups = new Map<SettingsSection, SettingMatch[]>();
  for (const match of matches) {
    const group = groups.get(match.entry.page);
    if (group) group.push(match);
    else groups.set(match.entry.page, [match]);
  }
  return [...groups].sort(([a], [b]) => pageOrder(a) - pageOrder(b)).map(([page, list]) => ({ page, matches: list }));
}
