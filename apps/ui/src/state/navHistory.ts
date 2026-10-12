import type { ProjectTab } from './projectPageStore.ts';
import type { MainView, Pane, SettingsSection } from './sessionsStore.ts';

/** A place the main area can show, as the mouse's back and forward buttons return to it. Home is a session place with no session. */
export type NavPlace =
  | { view: 'session'; mainId: string | null; splitId: string | null; activePane: Pane }
  | { view: 'new' }
  | { view: 'settings'; section: SettingsSection; from: Exclude<MainView, 'settings'> }
  | { view: 'projects' }
  | { view: 'project'; root: string; tab: ProjectTab };

export interface NavHistory {
  entries: readonly NavPlace[];
  index: number;
  /** When the current entry was visited anew; 0 once back or forward landed on it. */
  at: number;
}

export const HISTORY_LIMIT = 50;
/** A place left this soon after it was visited was only passed through (⌃⇥ walking the sessions): the next one takes its entry. */
export const PASSING_MS = 600;

export const emptyHistory: NavHistory = { entries: [], index: -1, at: 0 };

const samePlace = (a: NavPlace, b: NavPlace) => JSON.stringify(a) === JSON.stringify(b);

/** Another tab of the same project, page of Settings or active pane of the same split: it changes the entry instead of adding one. */
function sameStop(a: NavPlace, b: NavPlace): boolean {
  if (a.view === 'session' && b.view === 'session') return a.mainId === b.mainId && a.splitId === b.splitId;
  if (a.view === 'project' && b.view === 'project') return a.root === b.root;
  return a.view === b.view;
}

const replaceCurrent = (history: NavHistory, place: NavPlace, at: number): NavHistory => ({
  entries: history.entries.map((entry, i) => (i === history.index ? place : entry)),
  index: history.index,
  at,
});

/** Records the place now on screen: a new entry (dropping anything ahead of it), or the current one changed. */
export function record(history: NavHistory, place: NavPlace, now: number): NavHistory {
  const current = history.entries[history.index];
  if (current && samePlace(current, place)) return history;
  if (current && sameStop(current, place)) return replaceCurrent(history, place, history.at);
  if (current && history.at && now - history.at < PASSING_MS) return replaceCurrent(history, place, now);
  const entries = [...history.entries.slice(0, history.index + 1), place].slice(-HISTORY_LIMIT);
  return { entries, index: entries.length - 1, at: now };
}

/** The entry back (-1) or forward (1) that can still be shown, skipping sessions and projects that are gone; null at the end. */
export function step(history: NavHistory, direction: 1 | -1, usable: (place: NavPlace) => boolean): number | null {
  for (let i = history.index + direction; i >= 0 && i < history.entries.length; i += direction) {
    if (usable(history.entries[i]!)) return i;
  }
  return null;
}
