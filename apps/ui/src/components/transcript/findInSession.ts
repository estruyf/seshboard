import { isFoldedMessage, type RenderItem } from './displayItems.ts';

/** One occurrence of the search text: the row it's in, and which occurrence in that row. */
export interface FindMatch {
  index: number;
  nth: number;
}

/**
 * The text find searches in a row: what reads as a message (your prompts, Claude's replies,
 * commands, notices, plans, agent report titles, Claude's messages Skim folded, which open when
 * the search lands on one). Collapsed tool activity is left out, since a match there couldn't be
 * shown.
 */
export function searchableText(item: RenderItem): string | null {
  switch (item.kind) {
    case 'user':
    case 'text':
    case 'notice':
      return item.text;
    case 'command':
      return item.args ? `${item.name} ${item.args}` : item.name;
    case 'agent-report':
      return item.title;
    case 'tool': {
      const plan = item.name === 'ExitPlanMode' ? (item.input as { plan?: unknown } | null)?.plan : null;
      return typeof plan === 'string' ? plan : null;
    }
    case 'activity': {
      const messages = item.items.filter(isFoldedMessage);
      return messages.length > 0 ? messages.map((message) => message.text).join('\n\n') : null;
    }
    default:
      return null;
  }
}

/** Counts case-insensitive, non-overlapping occurrences of `needle` (already lower-cased). */
export function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  const haystack = text.toLowerCase();
  let count = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) count++;
  return count;
}

/** Every occurrence of `query` in the rows, top to bottom. */
export function findMatches(items: readonly RenderItem[], query: string): FindMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const matches: FindMatch[] = [];
  items.forEach((item, index) => {
    const text = searchableText(item);
    const count = text ? countOccurrences(text, needle) : 0;
    for (let nth = 0; nth < count; nth++) matches.push({ index, nth });
  });
  return matches;
}

/**
 * Where a new search starts: the first match at or below the top of what's on screen, so it
 * doesn't jump away from what you're reading; the last match when everything is above it.
 */
export function startMatch(matches: readonly FindMatch[], firstVisibleIndex: number): number {
  if (matches.length === 0) return -1;
  const below = matches.findIndex((m) => m.index >= firstVisibleIndex);
  return below === -1 ? matches.length - 1 : below;
}
