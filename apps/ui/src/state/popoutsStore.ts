import { create } from 'zustand';

/** The session this window shows on its own when it is a pop-out; null in the main window. */
export const popoutSession: string | null = typeof window === 'undefined' ? null : (window.switchboard?.popout ?? null);

interface PopoutsState {
  /** Sessions shown in a window of their own, as main reports them (`onPopoutsChanged`). */
  ids: ReadonlySet<string>;
  setIds(ids: readonly string[]): void;
}

export const usePopouts = create<PopoutsState>()((set) => ({
  ids: new Set(typeof window === 'undefined' ? [] : (window.switchboard?.popouts ?? [])),
  setIds: (ids) => set({ ids: new Set(ids) }),
}));

/**
 * A session shown in another window than this one: its pop-out, or (from a pop-out) any other session, which
 * lives in the main window.
 */
export function shownElsewhere(id: string): boolean {
  if (popoutSession) return id !== popoutSession;
  return usePopouts.getState().ids.has(id);
}

/**
 * Shows a session in a window of its own (or brings its pop-out to the front). Unsent text is relayed to the
 * pop-out by main; the panes here close it when main says it is out (`usePopoutsSync`).
 */
export function popOut(id: string): void {
  window.switchboard?.popOut(id);
}
