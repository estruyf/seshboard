import { create } from 'zustand';
import { agentsToggleStep } from './agentsPanel.ts';
import { frontTab, useRightPanel } from './rightPanelStore.ts';

interface ChangesPanelState {
  /** The sessions whose Changes panel is open (it may sit behind another tab). */
  open: ReadonlySet<string>;
  set(sessionId: string, open: boolean): void;
}

export const useChangesPanel = create<ChangesPanelState>()((set) => ({
  open: new Set(),
  set: (sessionId, open) =>
    set((s) => {
      if (s.open.has(sessionId) === open) return s;
      const next = new Set(s.open);
      if (open) next.add(sessionId);
      else next.delete(sessionId);
      return { open: next };
    }),
}));

/** Whether a session's Changes panel is open. */
export const useSessionChanges = (sessionId: string): boolean => useChangesPanel((s) => s.open.has(sessionId));

export const isChangesOpen = (sessionId: string | null) => !!sessionId && useChangesPanel.getState().open.has(sessionId);

/** Opens the panel in front of the other tabs. */
export function openChanges(sessionId: string): void {
  useChangesPanel.getState().set(sessionId, true);
  useRightPanel.getState().setTab(sessionId, 'changes');
}

export const closeChanges = (sessionId: string) => useChangesPanel.getState().set(sessionId, false);

/**
 * ⌘⇧D, the header's Changes button and Toggle changes: Changes waiting behind another tab comes to the front; otherwise
 * it opens (in front) or closes. It never closes Ask, Agents or Commands. `othersOpen`: another right panel is open too.
 */
export function toggleChangesPanel(sessionId: string, othersOpen: boolean): void {
  const step = agentsToggleStep(isChangesOpen(sessionId), frontTab(sessionId) === 'changes', othersOpen);
  if (step === 'close') closeChanges(sessionId);
  else openChanges(sessionId);
}
