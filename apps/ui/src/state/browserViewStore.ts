import { create } from 'zustand';
import { BROWSER_OWNER } from '../components/webPreview/browserTabs.ts';
import { showInMain } from './popoutsStore.ts';
import { useSessions } from './sessionsStore.ts';
import { browserOn, useWebPreview } from './webPreviewStore.ts';

/** What the sidebar lists under its views: the sessions, or the Browser view's tabs. */
export type SidebarList = 'sessions' | 'browser';

const LIST_KEY = 'ui.sidebarList';

// Per window: kept in sessionStorage, so a reload keeps it and another window has its own.
const readList = (): SidebarList => {
  try {
    return sessionStorage.getItem(LIST_KEY) === 'browser' ? 'browser' : 'sessions';
  } catch {
    return 'sessions';
  }
};

export const useSidebarList = create<{ list: SidebarList; setList(list: SidebarList): void }>()((set) => ({
  list: readList(),
  setList: (list) => {
    try {
      sessionStorage.setItem(LIST_KEY, list);
    } catch {
      // Remembering is a convenience.
    }
    set({ list });
  },
}));

/**
 * Browser in the sidebar's views (⌘⇧B outside a session): the Browser view, with its tabs listed in the sidebar. Again
 * while the list shows, the sessions come back. A pop-out has no Browser view: the main window shows it.
 */
export function openBrowserView(): void {
  if (!browserOn()) return;
  if (showInMain({ kind: 'browser' })) return;
  const { list, setList } = useSidebarList.getState();
  const here = useSessions.getState().view === 'browser';
  if (here && list === 'browser') {
    setList('sessions');
    return;
  }
  setList('browser');
  useSessions.getState().setView('browser');
}

/** A new Browser tab, in front (⌘T in the Browser view, Open tab). */
export function newBrowserTab(): void {
  useWebPreview.getState().openTab(BROWSER_OWNER, null);
  if (useSessions.getState().view !== 'browser') openBrowserView();
}

/** Leaving the Browser view for another (Home, a session, Upcoming): the sidebar shows the sessions again. */
export function followView(): () => void {
  return useSessions.subscribe((state, previous) => {
    if (state.view === previous.view || state.view === 'browser' || state.view === 'settings') return;
    if (useSidebarList.getState().list !== 'sessions') useSidebarList.getState().setList('sessions');
  });
}
