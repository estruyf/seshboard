import { create } from 'zustand';
import type { ComputersStatus, RemoteSessions } from '@seshboard/protocol/client';
import type { ComputerScope } from './remoteRows.ts';
import { parseRemoteRowId, remoteRowId, type RemoteRef } from './remoteSelection.ts';
import { useSessions } from './sessionsStore.ts';

const HIDDEN_KEY = 'ui.computersHidden';
const SCOPES_KEY = 'ui.computerScopes';

// Each computer's Mine / All: kept with the UI's own choices (localStorage), so it survives a restart; each window reads
// it when it opens and keeps its own from then on.
function readScopes(): Map<string, ComputerScope> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SCOPES_KEY) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return new Map();
    return new Map(Object.entries(value).filter((entry): entry is [string, ComputerScope] => entry[1] === 'mine' || entry[1] === 'all'));
  } catch {
    return new Map();
  }
}

function writeScopes(scopes: ReadonlyMap<string, ComputerScope>): void {
  try {
    localStorage.setItem(SCOPES_KEY, JSON.stringify(Object.fromEntries(scopes)));
  } catch {
    // Remembering is a convenience.
  }
}

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
  /** The computer whose page the main area shows (view `remote`): no sessions there, or pair it again. */
  pageId: string | null;
  /** A session New session just started there, until its list has it: its pane says it is starting. */
  starting: RemoteRef | null;
  /**
   * The computers whose sessions the sidebar leaves out (`THIS_COMPUTER` for this one's own), per window: the
   * Computers strip and "Show sessions from".
   */
  hidden: ReadonlySet<string>;
  /** Each computer's Mine / All filter (its chip's menu), by computer id; a computer not in it shows Mine. */
  scopes: ReadonlyMap<string, ComputerScope>;
  /** The computer whose notifications Settings › Remote opens on (from its chip's menu), until it has. */
  notifyFor: string | null;
  setStatus(status: ComputersStatus): void;
  setList(computerId: string, list: RemoteSessions): void;
  /**
   * Opens a session on another computer in a pane, as a local one opens: in the active pane, or with `beside` in a
   * new one next to it. `starting` for one New session just started there.
   */
  openSession(ref: RemoteRef, options?: { starting?: boolean; beside?: boolean }): void;
  /** Shows a computer's page: what is wrong, or that it has no sessions. */
  openPage(computerId: string): void;
  setHidden(hidden: ReadonlySet<string>): void;
  setScope(computerId: string, scope: ComputerScope): void;
  /** Opens Settings › Remote at a computer's notifications. */
  openNotifications(computerId: string): void;
  clearNotifyFor(): void;
}

/** Other computers this app paired with (docs/remote-access.md): their state and sessions, for the sidebar and their sessions' panes. */
export const useComputers = create<ComputersState>()((set) => ({
  status: null,
  lists: new Map(),
  pageId: null,
  starting: null,
  hidden: readHidden(),
  scopes: readScopes(),
  notifyFor: null,
  setStatus: (status) => {
    // A forgotten computer's list (and its rows, its panes and its place in the filter) goes with it.
    const ids = new Set(status.computers.map((c) => c.id));
    set((s) => ({
      status,
      lists: [...s.lists.keys()].every((id) => ids.has(id)) ? s.lists : new Map([...s.lists].filter(([id]) => ids.has(id))),
      ...(s.pageId && !ids.has(s.pageId) ? { pageId: null } : {}),
    }));
    const sessions = useSessions.getState();
    const gone = sessions.paneIds.filter((id) => {
      const ref = parseRemoteRowId(id);
      return ref !== null && !ids.has(ref.computerId);
    });
    if (gone.length) sessions.closeSessions(gone);
  },
  setList: (computerId, list) => set((s) => ({ lists: new Map(s.lists).set(computerId, list) })),
  openSession: (ref, options) => {
    const id = remoteRowId(ref);
    set({ pageId: null, starting: options?.starting ? { computerId: ref.computerId, sessionId: ref.sessionId } : null });
    if (options?.beside) useSessions.getState().openBeside(id);
    else useSessions.getState().select(id);
  },
  openPage: (computerId) => {
    set({ pageId: computerId });
    useSessions.getState().setView('remote');
  },
  setHidden: (hidden) => {
    writeHidden(hidden);
    set({ hidden: new Set(hidden) });
  },
  setScope: (computerId, scope) =>
    set((s) => {
      const scopes = new Map(s.scopes).set(computerId, scope);
      writeScopes(scopes);
      return { scopes };
    }),
  openNotifications: (computerId) => {
    set({ notifyFor: computerId });
    useSessions.getState().openSettings('remote');
  },
  clearNotifyFor: () => set({ notifyFor: null }),
}));
