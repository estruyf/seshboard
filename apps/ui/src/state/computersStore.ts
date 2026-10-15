import { create } from 'zustand';
import type { ComputersStatus, RemoteSessions } from '@switchboard/protocol/client';
import type { RemoteRef } from './remoteSelection.ts';
import { useSessions } from './sessionsStore.ts';

const HIDDEN_KEY = 'ui.computersHidden';

// The filter is per window: kept in sessionStorage, so a reload keeps it and another window has its own.
function readHidden(): Set<string> {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(HIDDEN_KEY) ?? '[]');
    return new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeHidden(hidden: ReadonlySet<string>): void {
  try {
    sessionStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
  } catch {
    // Remembering is a convenience.
  }
}

interface ComputersState {
  /** Paired computers and pairing, from the engine; null until the first answer. */
  status: ComputersStatus | null;
  /** Each computer's last session list, by computer id. An offline computer keeps its last one. */
  lists: ReadonlyMap<string, RemoteSessions>;
  /** The remote session the main area shows (view `remote`). */
  selected: RemoteRef | null;
  /** The computer whose page shows instead (view `remote` without a session): no sessions there, or pair it again. */
  pageId: string | null;
  /** A session New session just started there, until its list has it: the view says it is starting. */
  starting: RemoteRef | null;
  /**
   * The computers whose sessions the sidebar leaves out (`THIS_COMPUTER` for this one's own), per window: the
   * Computers strip and "Show sessions from".
   */
  hidden: ReadonlySet<string>;
  setStatus(status: ComputersStatus): void;
  setList(computerId: string, list: RemoteSessions): void;
  /** Opens a session on another computer in the main area; `starting` for one New session just started there. */
  openSession(ref: RemoteRef, options?: { starting?: boolean }): void;
  /** Shows a computer's page: what is wrong, or that it has no sessions. */
  openPage(computerId: string): void;
  setHidden(hidden: ReadonlySet<string>): void;
}

/** Other computers this app paired with (docs/remote-access.md): their state and sessions, for the sidebar and the remote session view. */
export const useComputers = create<ComputersState>()((set) => ({
  status: null,
  lists: new Map(),
  selected: null,
  pageId: null,
  starting: null,
  hidden: readHidden(),
  setStatus: (status) =>
    set((s) => {
      // A forgotten computer's list (and its rows, and its place in the filter) goes with it.
      const ids = new Set(status.computers.map((c) => c.id));
      const lists = [...s.lists.keys()].every((id) => ids.has(id)) ? s.lists : new Map([...s.lists].filter(([id]) => ids.has(id)));
      return {
        status,
        lists,
        ...(s.selected && !ids.has(s.selected.computerId) ? { selected: null } : {}),
        ...(s.pageId && !ids.has(s.pageId) ? { pageId: null } : {}),
      };
    }),
  setList: (computerId, list) => set((s) => ({ lists: new Map(s.lists).set(computerId, list) })),
  openSession: (ref, options) => {
    const selected = { computerId: ref.computerId, sessionId: ref.sessionId };
    set({ selected, pageId: null, starting: options?.starting ? selected : null });
    useSessions.getState().setView('remote');
  },
  openPage: (computerId) => {
    set({ selected: null, pageId: computerId });
    useSessions.getState().setView('remote');
  },
  setHidden: (hidden) => {
    writeHidden(hidden);
    set({ hidden: new Set(hidden) });
  },
}));
