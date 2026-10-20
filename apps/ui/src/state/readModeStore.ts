import { create } from 'zustand';
import { DEFAULT_READ_PREFS, readPrefs, type ReadPrefs } from '../components/readMode/readPrefs.ts';
import { useSessions } from './sessionsStore.ts';

const STORAGE_KEY = 'ui.readMode';

/** The preferences saved last time. Read when reading mode first opens, not at import, so nothing touches storage at load. */
function savedPrefs(): ReadPrefs {
  try {
    return readPrefs(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_READ_PREFS;
  }
}

function savePrefs(prefs: ReadPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Private storage can be full or off; reading mode still works, it just forgets.
  }
}

export interface ReadModeOpen {
  sessionId: string;
  /** The turn being read; `'last'` until the session view has found the last reply that can be read. */
  turnKey: string;
  /** The turn it was opened at ('' until known): closing there leaves the session's scroll as it was. */
  openedFrom: string;
}

interface ReadModeState {
  open: ReadModeOpen | null;
  /** The session list over the reading view (⌘B). Cleared when reading mode closes. */
  sidebar: boolean;
  prefs: ReadPrefs;
  /** Where focus goes when it closes: back to the reply's Read button, or nowhere (something else took it: the message box after Reply with quote, the Ask field). */
  leaveTo: 'reply' | 'elsewhere';
  openReply(sessionId: string, turnKey: string): void;
  /** Opens at the last reply that has text; the session view fills in which one that is. */
  openLast(sessionId: string): void;
  /** The session view tells which reply `'last'` turned out to be. */
  resolve(turnKey: string): void;
  /** Moves to another reply of the same session. */
  go(turnKey: string): void;
  close(leaveTo?: 'reply' | 'elsewhere'): void;
  toggleSidebar(): void;
  setPrefs(partial: Partial<ReadPrefs>): void;
}

let ready = false;

/** Loads the saved preferences and starts watching the selection, once, the first time reading mode opens. */
function prepare(): void {
  if (ready) return;
  ready = true;
  useReadMode.setState({ prefs: savedPrefs() });
  // A click in the sidebar, a jump to a waiting session or any other view leaves reading mode.
  useSessions.subscribe((s) => {
    const open = useReadMode.getState().open;
    if (open && (s.selectedId !== open.sessionId || s.view !== 'session')) useReadMode.getState().close();
  });
}

export const useReadMode = create<ReadModeState>((set) => ({
  open: null,
  sidebar: false,
  prefs: DEFAULT_READ_PREFS,
  leaveTo: 'reply',
  openReply: (sessionId, turnKey) => {
    prepare();
    set({ open: { sessionId, turnKey, openedFrom: turnKey }, sidebar: false });
  },
  openLast: (sessionId) => {
    prepare();
    set({ open: { sessionId, turnKey: 'last', openedFrom: '' }, sidebar: false });
  },
  resolve: (turnKey) => set((s) => (s.open?.turnKey === 'last' ? { open: { ...s.open, turnKey, openedFrom: s.open.openedFrom || turnKey } } : {})),
  go: (turnKey) => set((s) => (s.open ? { open: { ...s.open, turnKey } } : {})),
  close: (leaveTo = 'reply') => set((s) => (s.open || s.sidebar ? { open: null, sidebar: false, leaveTo } : {})),
  toggleSidebar: () => set((s) => (s.open ? { sidebar: !s.sidebar } : {})),
  setPrefs: (partial) =>
    set((s) => {
      const prefs = { ...s.prefs, ...partial };
      savePrefs(prefs);
      return { prefs };
    }),
}));
