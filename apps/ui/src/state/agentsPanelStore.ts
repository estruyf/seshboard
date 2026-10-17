import { create } from 'zustand';
import { agentsToggleStep } from './agentsPanel.ts';
import { frontTab, useRightPanel } from './rightPanelStore.ts';

/** One session's Agents panel: whether it is open (it may sit behind another tab) and the agent on show (a tool call id). */
interface SessionAgents {
  open: boolean;
  picked: string | null;
}

const EMPTY: SessionAgents = { open: false, picked: null };

interface AgentsPanelState {
  sessions: ReadonlyMap<string, SessionAgents>;
  /** Which of the two lists are unfolded, for this window. */
  sections: { active: boolean; finished: boolean };
  update(sessionId: string, change: Partial<SessionAgents>): void;
  toggleSection(section: 'active' | 'finished'): void;
}

export const useAgentsPanel = create<AgentsPanelState>()((set) => ({
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

/** One session's Agents panel, as it shows it. */
export function useSessionAgents(sessionId: string): SessionAgents {
  return useAgentsPanel((s) => s.sessions.get(sessionId)) ?? EMPTY;
}

export const isAgentsOpen = (sessionId: string | null) => !!sessionId && !!useAgentsPanel.getState().sessions.get(sessionId)?.open;

/** Opens the panel in front of the other tabs, on `agent` (a tool call id) when given, else on the one that was on show. */
export function openAgents(sessionId: string, agent?: string): void {
  useAgentsPanel.getState().update(sessionId, { open: true, ...(agent ? { picked: agent } : {}) });
  useRightPanel.getState().setTab(sessionId, 'agents');
}

export const closeAgents = (sessionId: string) => useAgentsPanel.getState().update(sessionId, { open: false });
export const pickAgent = (sessionId: string, agent: string) => useAgentsPanel.getState().update(sessionId, { picked: agent });

/** The header's Agents button, its shortcut and the palette: open, bring to the front, or close. `othersOpen`: Changes or Ask is open too. */
export function toggleAgentsPanel(sessionId: string, othersOpen: boolean): void {
  const step = agentsToggleStep(isAgentsOpen(sessionId), frontTab(sessionId) === 'agents', othersOpen);
  if (step === 'close') closeAgents(sessionId);
  else openAgents(sessionId);
}
