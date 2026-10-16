import { create } from 'zustand';
import { agentsToggleStep } from './agentsPanel.ts';
import { useRightPanel } from './rightPanelStore.ts';

/** One session's Commands panel: whether it is open (it may sit behind another tab) and the command on show (a task id). */
interface SessionCommands {
  open: boolean;
  picked: string | null;
}

const EMPTY: SessionCommands = { open: false, picked: null };

interface CommandsPanelState {
  sessions: ReadonlyMap<string, SessionCommands>;
  /** Which of the two lists are unfolded, for this window. */
  sections: { active: boolean; finished: boolean };
  update(sessionId: string, change: Partial<SessionCommands>): void;
  toggleSection(section: 'active' | 'finished'): void;
}

export const useCommandsPanel = create<CommandsPanelState>()((set) => ({
  sessions: new Map(),
  sections: { active: true, finished: true },
  update: (sessionId, change) =>
    set((s) => {
      const sessions = new Map(s.sessions);
      sessions.set(sessionId, { ...(s.sessions.get(sessionId) ?? EMPTY), ...change });
      return { sessions };
    }),
  toggleSection: (section) => set((s) => ({ sections: { ...s.sections, [section]: !s.sections[section] } })),
}));

/** One session's Commands panel, as it shows it. */
export function useSessionCommands(sessionId: string): SessionCommands {
  return useCommandsPanel((s) => s.sessions.get(sessionId)) ?? EMPTY;
}

export const isCommandsOpen = (sessionId: string | null) => !!sessionId && !!useCommandsPanel.getState().sessions.get(sessionId)?.open;

/** Opens the panel in front of the other tabs, on `taskId` when given, else on the one that was on show. */
export function openCommands(sessionId: string, taskId?: string): void {
  useCommandsPanel.getState().update(sessionId, { open: true, ...(taskId ? { picked: taskId } : {}) });
  useRightPanel.getState().setTab('commands');
}

export const closeCommands = (sessionId: string) => useCommandsPanel.getState().update(sessionId, { open: false });
export const pickCommand = (sessionId: string, taskId: string) => useCommandsPanel.getState().update(sessionId, { picked: taskId });

/** The header's Commands button, its shortcut and the palette: open, bring to the front, or close. `othersOpen`: another right panel is open too. */
export function toggleCommandsPanel(sessionId: string, othersOpen: boolean): void {
  const step = agentsToggleStep(isCommandsOpen(sessionId), useRightPanel.getState().tab === 'commands', othersOpen);
  if (step === 'close') closeCommands(sessionId);
  else openCommands(sessionId);
}
