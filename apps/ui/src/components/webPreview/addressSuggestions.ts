import type { BrowserFavorite, BrowserHistoryEntry } from '@seshboard/protocol/client';
import type { BrowserTab } from './browserTabs.ts';

/*
 * The address bar's suggestions as plain data: what you typed matched against the owner's open tabs, your favourites
 * and the history. Pure, so the ranking is tested on its own; `BrowserPane` shows the list.
 */

/** A page the address bar offers: an open tab switches to it, the others open in the tab. */
export interface AddressSuggestion {
  kind: 'tab' | 'favorite' | 'history';
  url: string;
  title: string;
  favicon: string | null;
  /** The open tab it switches to (`kind: 'tab'`). */
  tabId?: string;
  /** Its address starts with what was typed: Enter may open it (`autoPick`). */
  prefix: boolean;
}

/** How many suggestions the list shows. */
export const SUGGESTIONS_MAX = 8;

/** An address as it is matched: no scheme, no `www.`, no trailing slash, any case. */
export function bareAddress(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '').toLowerCase();
}

/** The same page for a suggestion: the same address, whatever its `#`. */
const pageKey = (url: string): string => bareAddress(url.replace(/#.*$/, ''));

/** How well a page matches what was typed: its address starts with it, then a word starts with it, then it holds it; 0 is no match. */
export function matchScore(query: string, url: string, title: string): number {
  const typed = query.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^www\./, '');
  if (!typed) return 0;
  const address = bareAddress(url);
  const name = title.toLowerCase();
  if (address.startsWith(typed)) return 100;
  const startsWord = (text: string) => text.split(/[^a-z0-9]+/).some((word) => word.startsWith(typed));
  if (startsWord(address) || startsWord(name)) return 60;
  if (address.includes(typed) || name.includes(typed)) return 30;
  return 0;
}

interface Sources {
  /** The owner's open tabs; the one on screen is left out. */
  tabs: readonly Pick<BrowserTab, 'id' | 'url' | 'title' | 'name' | 'favicon'>[];
  favorites: readonly BrowserFavorite[];
  history: readonly BrowserHistoryEntry[];
  /** The tab the address bar belongs to. */
  currentTabId?: string | null;
}

/**
 * What the address bar offers for `query`: the best matches first, one row per page (an open tab before a favourite
 * before the history, with the best title and icon of the three). A tab and a favourite rank a little higher, and so
 * does a page opened often; at the same score, the shorter address first.
 */
export function addressSuggestions(query: string, sources: Sources, max = SUGGESTIONS_MAX): AddressSuggestion[] {
  const rows = new Map<string, AddressSuggestion & { score: number; visits: number; lastVisit: number }>();
  const add = (row: Omit<AddressSuggestion, 'prefix'>, bonus: number, visits = 0, lastVisit = 0) => {
    const score = matchScore(query, row.url, row.title);
    if (!score) return;
    const key = pageKey(row.url);
    const known = rows.get(key);
    if (known) {
      // The first kind stays (a tab, then a favourite); the history adds how often it was opened.
      known.score = Math.max(known.score, score + bonus) + (row.kind === 'history' ? Math.min(visits, 20) / 2 : 0);
      known.visits = Math.max(known.visits, visits);
      known.lastVisit = Math.max(known.lastVisit, lastVisit);
      known.title ||= row.title;
      known.favicon ??= row.favicon;
      return;
    }
    rows.set(key, { ...row, prefix: score >= 100, score: score + bonus + Math.min(visits, 20) / 2, visits, lastVisit });
  };
  for (const tab of sources.tabs) {
    if (!tab.url || tab.id === sources.currentTabId) continue;
    add({ kind: 'tab', url: tab.url, title: tab.name || (tab.title === tab.url ? '' : tab.title), favicon: tab.favicon, tabId: tab.id }, 8);
  }
  for (const favorite of sources.favorites) add({ kind: 'favorite', url: favorite.url, title: favorite.title === favorite.url ? '' : favorite.title, favicon: favorite.favicon }, 6);
  for (const entry of sources.history) add({ kind: 'history', url: entry.url, title: entry.title, favicon: null }, 0, entry.visits, entry.lastVisit);
  return [...rows.values()]
    .sort((a, b) => b.score - a.score || b.lastVisit - a.lastVisit || a.url.length - b.url.length)
    .slice(0, max)
    .map(({ score: _s, visits: _v, lastVisit: _l, ...row }) => row);
}

/**
 * Whether Enter opens the first suggestion rather than what was typed: only when what was typed is no address of its own
 * (`sesh`, not `localhost:3000`) and the first suggestion's address starts with it.
 */
export function autoPick(suggestions: readonly AddressSuggestion[], typedIsAddress: boolean): boolean {
  return !typedIsAddress && !!suggestions[0]?.prefix;
}
