import { create } from 'zustand';
import { useSidebarList, type SidebarList } from './browserViewStore.ts';

/**
 * Where the panel holds a view's own list (Projects, Upcoming, Activity, Settings): the view renders it there (a portal),
 * so the list keeps one owner for its state and its keys, and the page beside it gets the main area. Null while the
 * panel is closed or lists the sessions, the Browser's tabs, the computers or what is running.
 */
export const usePanelSlot = create<{ slot: HTMLElement | null; setSlot(el: HTMLElement | null): void }>()((set) => ({
  slot: null,
  setSlot: (slot) => set({ slot }),
}));

/** The panel's slot while it shows `list`, for that view to render its list into; null otherwise. */
export function usePanelView(list: SidebarList): HTMLElement | null {
  const slot = usePanelSlot((s) => s.slot);
  const current = useSidebarList((s) => s.list);
  return current === list ? slot : null;
}
