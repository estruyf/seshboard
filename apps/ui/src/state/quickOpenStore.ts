import { create } from 'zustand';
import { useProjectPage } from './projectPageStore.ts';
import { useSessions } from './sessionsStore.ts';

/** Where Quick open looks: the session in front and its folder, or outside a session the selected project. */
export interface QuickOpenTarget {
  sessionId: string | null;
  /** The folder to search; null when there is none (no session, no project picked). */
  cwd: string | null;
}

interface QuickOpenState {
  target: QuickOpenTarget | null;
  /** Opens Quick open for the session in front, or the selected project; the same key again closes it. */
  toggle(target?: QuickOpenTarget): void;
  close(): void;
}

/** The session in front (in a session view), else the project page's project. */
export function quickOpenTarget(): QuickOpenTarget {
  const { view, selectedId, sessions, live } = useSessions.getState();
  if (view === 'session' && selectedId) {
    const cwd = sessions.get(selectedId)?.cwd ?? live.get(selectedId)?.cwd ?? null;
    return { sessionId: selectedId, cwd };
  }
  const root = view === 'project' || view === 'projects' ? useProjectPage.getState().root : null;
  return { sessionId: null, cwd: root };
}

export const useQuickOpen = create<QuickOpenState>()((set, get) => ({
  target: null,
  toggle: (target) => set({ target: get().target ? null : (target ?? quickOpenTarget()) }),
  close: () => set({ target: null }),
}));
