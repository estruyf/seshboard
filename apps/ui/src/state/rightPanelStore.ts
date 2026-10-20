import { create } from 'zustand';
import { clampAskWidth, readTab, type RightTab } from '../components/ask/askWidth.ts';
import { useTerminals } from './terminalsStore.ts';

const TAB_KEY = 'ui.rightPanelTab';
const WIDTH_KEY = 'ui.askWidth';

// Per window: kept in sessionStorage, so a reload keeps it and another window has its own.
const read = (key: string): string | null => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Remembering is a convenience.
  }
};

/**
 * The right side's tab (when two or more of its panels are open) per session, and the panels' width per window. A
 * session that has not picked a tab starts on the one picked last in this window.
 */
interface RightPanelLayout {
  /** The tab picked last in this window, for sessions that have not picked one. */
  tab: RightTab;
  /** The tab in front in each session that picked one. */
  tabs: ReadonlyMap<string, RightTab>;
  /** The Ask panel's width, also of both panels as tabs. */
  width: number;
  /** `owner` is the session, or the window's own terminal. */
  setTab(owner: string, tab: RightTab): void;
  setWidth(width: number): void;
}

export const useRightPanel = create<RightPanelLayout>()((set) => ({
  tab: readTab(read(TAB_KEY)),
  tabs: new Map(),
  width: clampAskWidth(Number(read(WIDTH_KEY)), window.innerWidth),
  setTab: (owner, tab) => {
    write(TAB_KEY, tab);
    set((s) => ({ tab, tabs: new Map(s.tabs).set(owner, tab) }));
  },
  setWidth: (width) => {
    const next = clampAskWidth(width, window.innerWidth);
    write(WIDTH_KEY, String(next));
    set({ width: next });
  },
}));

/** The tab a session's right side shows in front, when it has several open. */
export const frontTab = (owner: string): RightTab => {
  const { tabs, tab } = useRightPanel.getState();
  return tabs.get(owner) ?? tab;
};

/** The tab in front in a session, as it shows it. */
export function useRightTab(owner: string): RightTab {
  return useRightPanel((s) => s.tabs.get(owner) ?? s.tab);
}

/**
 * ⌘J, the header's Terminal button and Toggle terminal: a terminal docked right and waiting behind another tab comes to
 * the front; otherwise it opens or closes. `owner`: the session, or the window's own terminal.
 */
export function toggleTerminalPanel(owner: string): void {
  const behind = document.querySelector(`[data-current-session="${CSS.escape(owner)}"] [data-right-tab="terminal"][aria-selected="false"]`);
  if (behind) return useRightPanel.getState().setTab(owner, 'terminal');
  useTerminals.getState().togglePanel(owner);
}
