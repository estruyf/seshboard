import type { ProjectTab } from './projectPageStore.ts';
import type { MainView, SettingsSection } from './sessionsStore.ts';
import { leafIds, type Tile } from './tiling.ts';

/** A place the main area can show, as the mouse's back and forward buttons return to it. Home is a session place with no session. */
export type NavPlace =
  | { view: 'session'; layout: Tile | null; active: string | null }
  | { view: 'new' }
  | { view: 'settings'; section: SettingsSection; from: Exclude<MainView, 'settings'> }
  | { view: 'projects' }
  | { view: 'project'; root: string; tab: ProjectTab }
  | { view: 'usage'; profileId: string | null }
  /** A paired computer's page (its sessions are panes, in a session place). */
  | { view: 'remote'; computerId: string };

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

/** Another tab of the same project, page of Settings, or arrangement, sizes or active pane of the same sessions: it changes the entry instead of adding one. */
function sameStop(a: NavPlace, b: NavPlace): boolean {
  // The same sessions in any arrangement (panes moved, swapped, resized, another one active) are the same stop; opening or closing a pane is a new one.
  if (a.view === 'session' && b.view === 'session') return JSON.stringify(leafIds(a.layout).sort()) === JSON.stringify(leafIds(b.layout).sort());
  if (a.view === 'project' && b.view === 'project') return a.root === b.root;
  // Another remote session is another stop, as another local one is.
  if (a.view === 'remote' && b.view === 'remote') return a.computerId === b.computerId;
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

/**
 * The page of Settings a project page was opened from (Memory's list of projects), or null. Closing Settings opened
 * over the same project also puts it right after Settings: that is a return, not an open from Settings.
 */
export function settingsOrigin(history: NavHistory, root: string | null): SettingsSection | null {
  const { entries, index } = history;
  const here = entries[index];
  const before = entries[index - 1];
  if (here?.view !== 'project' || here.root !== root || before?.view !== 'settings') return null;
  const under = entries[index - 2];
  if (before.from === 'project' && under?.view === 'project' && under.root === root) return null;
  return before.section;
}
