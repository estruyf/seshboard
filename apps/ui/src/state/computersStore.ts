import { create } from 'zustand';
import type { ComputersStatus, RemoteSessions } from '@switchboard/protocol/client';
import { useSessions } from './sessionsStore.ts';

interface ComputersState {
  /** Paired computers and pairing, from the engine; null until the first answer. */
  status: ComputersStatus | null;
  /** Each connected computer's session list, by computer id. */
  lists: ReadonlyMap<string, RemoteSessions>;
  /** The computer the Computer view shows, and its session open there. */
  openId: string | null;
  sessionId: string | null;
  setStatus(status: ComputersStatus): void;
  setList(computerId: string, list: RemoteSessions): void;
  /** Shows a computer's sessions (and one of them) in the main area. */
  open(computerId: string, sessionId?: string | null): void;
  selectSession(sessionId: string | null): void;
}

/** Other computers this app paired with (docs/remote-access.md): their state and sessions, for the dock and the Computer view. */
export const useComputers = create<ComputersState>()((set) => ({
  status: null,
  lists: new Map(),
  openId: null,
  sessionId: null,
  setStatus: (status) =>
    set((s) => {
      // A forgotten computer's list goes with it.
      const ids = new Set(status.computers.map((c) => c.id));
      const lists = [...s.lists.keys()].every((id) => ids.has(id)) ? s.lists : new Map([...s.lists].filter(([id]) => ids.has(id)));
      return { status, lists, ...(s.openId && !ids.has(s.openId) ? { openId: null, sessionId: null } : {}) };
    }),
  setList: (computerId, list) => set((s) => ({ lists: new Map(s.lists).set(computerId, list) })),
  open: (computerId, sessionId = null) => {
    set((s) => ({ openId: computerId, sessionId: s.openId === computerId && sessionId === null ? s.sessionId : sessionId }));
    useSessions.getState().setView('computer');
  },
  selectSession: (sessionId) => set({ sessionId }),
}));
