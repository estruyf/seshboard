import { create } from 'zustand';
import { agentsToggleStep } from './agentsPanel.ts';
import { frontTab, useRightPanel } from './rightPanelStore.ts';

/** The sessions whose Note panel is open (it may sit behind another tab), per session like Agents and Commands. */
export const useNotePanel = create<{ open: ReadonlySet<string>; set(sessionId: string, open: boolean): void }>()((set) => ({
  open: new Set(),
  set: (sessionId, open) =>
    set((s) => {
      const next = new Set(s.open);
      if (open) next.add(sessionId);
      else next.delete(sessionId);
      return { open: next };
    }),
}));

export const isNoteOpen = (sessionId: string) => useNotePanel.getState().open.has(sessionId);

/** Opens the panel in front of the other tabs. */
export function openNote(sessionId: string): void {
  useNotePanel.getState().set(sessionId, true);
  useRightPanel.getState().setTab(sessionId, 'note');
}

export const closeNote = (sessionId: string) => useNotePanel.getState().set(sessionId, false);

/** The header's note and the rail's Note button: open, bring to the front, or close. `othersOpen`: another right panel is open too. */
export function toggleNotePanel(sessionId: string, othersOpen: boolean): void {
  const step = agentsToggleStep(isNoteOpen(sessionId), frontTab(sessionId) === 'note', othersOpen);
  if (step === 'close') closeNote(sessionId);
  else openNote(sessionId);
}
