import { create } from 'zustand';
import { clampAskWidth, readTab, type RightTab } from '../components/ask/askWidth.ts';
import { useOverlay } from './overlayStore.ts';

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

/** The right side's tab (when Changes and Ask are both open) and the Ask panel's width, per window. */
interface RightPanelLayout {
  tab: RightTab;
  /** The Ask panel's width, also of both panels as tabs. */
  width: number;
  setTab(tab: RightTab): void;
  setWidth(width: number): void;
}

export const useRightPanel = create<RightPanelLayout>()((set) => ({
  tab: readTab(read(TAB_KEY)),
  width: clampAskWidth(Number(read(WIDTH_KEY)), window.innerWidth),
  setTab: (tab) => {
    write(TAB_KEY, tab);
    set({ tab });
  },
  setWidth: (width) => {
    const next = clampAskWidth(width, window.innerWidth);
    write(WIDTH_KEY, String(next));
    set({ width: next });
  },
}));

/**
 * ⌘⇧D, the header's Changes button and Toggle changes: Changes waiting behind another tab comes to the front;
 * otherwise it opens (in front) or closes. It never closes Ask or Agents. `othersOpen`: Ask or Agents is open in the
 * session it is for.
 */
export function toggleChangesPanel(othersOpen: boolean): void {
  const overlay = useOverlay.getState();
  const panel = useRightPanel.getState();
  if (overlay.changesOpen && othersOpen && panel.tab !== 'changes') return panel.setTab('changes');
  if (!overlay.changesOpen) panel.setTab('changes');
  overlay.toggleChanges();
}
