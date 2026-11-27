import type { MainView } from './sessionsStore.ts';

/**
 * What the panel lists, one per item on the nav rail: the sessions, the Browser view's tabs, the projects, Upcoming's and
 * Activity's project filters, Settings' sections, or what is running (the focus limit). Computers is a hover menu on the
 * rail instead: it holds too little for a list. Pure, with tests.
 */
export type SidebarList = 'sessions' | 'browser' | 'projects' | 'upcoming' | 'activity' | 'settings' | 'running';

/** The lists a view renders itself into the panel (`usePanelSlot`); the panel draws the others. */
export const VIEW_LISTS: readonly SidebarList[] = ['projects', 'upcoming', 'activity', 'settings'];

/** The list that goes with a view in the main area: its own, or the sessions. */
export function listForView(view: MainView): SidebarList {
  if (view === 'projects' || view === 'project') return 'projects';
  if (view === 'upcoming' || view === 'activity' || view === 'settings' || view === 'browser') return view;
  return 'sessions';
}

/**
 * The list the panel shows after the main area moves from `from` to `to`, or null to keep the one it shows: between the
 * list of projects and a project's page it stays (Sessions picked over a project stays too).
 */
export function listAfterMove(from: MainView, to: MainView): SidebarList | null {
  if (from === to) return null;
  const projects = (view: MainView) => view === 'projects' || view === 'project';
  if (projects(from) && projects(to)) return null;
  return listForView(to);
}
