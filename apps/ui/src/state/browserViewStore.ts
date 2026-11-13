import { create } from 'zustand';
import { BROWSER_OWNER, frontTab, type BrowserTab } from '../components/webPreview/browserTabs.ts';
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

/** A favourite from the sidebar or the empty Browser view: in a Browser tab, the one already on it if there is one. */
export function openFavorite(url: string): void {
  useWebPreview.getState().openTab(BROWSER_OWNER, url);
  if (useSessions.getState().view !== 'browser') openBrowserView();
}

/** Whose page is on screen: the Browser view's, or the session's whose browser panel is open; null for none. */
export function pageOwner(view: string, sessionId: string | null, panels: ReadonlySet<string>): string | null {
  if (view === 'browser') return BROWSER_OWNER;
  return view === 'session' && sessionId && panels.has(sessionId) ? sessionId : null;
}

/** The tab on screen in this window (`pageOwner`'s in front), for the palette's page commands. */
export function currentPageTab(): BrowserTab | null {
  const { view, selectedId } = useSessions.getState();
  const state = useWebPreview.getState();
  const owner = pageOwner(view, selectedId, state.panels);
  return owner ? (frontTab(state, owner) ?? null) : null;
}

/** Leaving the Browser view for another (Home, a session, Upcoming): the sidebar shows the sessions again. */
export function followView(): () => void {
  return useSessions.subscribe((state, previous) => {
    if (state.view === previous.view || state.view === 'browser' || state.view === 'settings') return;
    if (useSidebarList.getState().list !== 'sessions') useSidebarList.getState().setList('sessions');
  });
}

/**
 * A session deleted (gone from the sessions store): its tabs, panel and pages go with it. Only a session that was
 * there and went, so tabs restored before the first list arrives stay. Returns the unsubscribe.
 */
export function followDeletedSessions(): () => void {
  return useSessions.subscribe((now, before) => {
    if (now.sessions === before.sessions || before.sessions.size === 0) return;
    const owners = new Set(useWebPreview.getState().tabs.map((t) => t.owner));
    for (const owner of owners) if (owner !== BROWSER_OWNER && before.sessions.has(owner) && !now.sessions.has(owner)) useWebPreview.getState().forget(owner);
  });
}
