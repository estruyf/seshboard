import type { MainWindowRequest } from '@switchboard/protocol/bridge';
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
 * In a pop-out, asks the main window to show a view this window doesn't have (Settings, Usage, a project, New
 * session) and returns true, so the caller stops. In the main window it does nothing and returns false.
 */
export function showInMain(request: MainWindowRequest): boolean {
  if (!popoutSession) return false;
  window.switchboard?.showInMain(request);
  return true;
}

/**
 * Shows a session in a window of its own (or brings its pop-out to the front). Unsent text is relayed to the
 * pop-out by main; the panes here close it when main says it is out (`usePopoutsSync`).
 */
export function popOut(id: string): void {
  window.switchboard?.popOut(id);
}
