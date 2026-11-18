import { create } from 'zustand';
import type { TouchedFiles } from '../components/files/touchedFiles.ts';
import { useRightPanel } from './rightPanelStore.ts';

/** What the Files panel shows: the tree and the viewer, or Search in files. */
export type FilesMode = 'files' | 'search';

/** A file open in the viewer, as a tab. */
export interface FileTab {
  /** Absolute. */
  path: string;
  /** The line to scroll to and mark, from 1. */
  line?: number;
  /** The last line marked, for a range. */
  endLine?: number;
  /** Goes up on every open, so opening the same file at the same line again scrolls back to it. */
  seq: number;
}

/** The fields of Search in files. */
export interface FileSearchQuery {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  include: string;
  exclude: string;
}

export const EMPTY_SEARCH: FileSearchQuery = { query: '', regex: false, caseSensitive: false, wholeWord: false, include: '', exclude: '' };

/** The Files panel of one session. */
export interface SessionFiles {
  open: boolean;
  /** The panel takes the whole session area. */
  full: boolean;
  mode: FilesMode;
  /** The open files, oldest first. */
  tabs: FileTab[];
  /** The path of the tab in front; null with none. */
  front: string | null;
  /** The tree's open folders, relative to the folder with `/`. */
  folders: ReadonlySet<string>;
  filter: string;
  search: FileSearchQuery;
  /** A command for the viewer (find, go to line) and a nonce so the same one twice still runs. */
  command: { kind: 'find' | 'goto' | 'search'; nonce: number } | null;
}

const EMPTY: SessionFiles = { open: false, full: false, mode: 'files', tabs: [], front: null, folders: new Set(), filter: '', search: EMPTY_SEARCH, command: null };

/** The tree's width limits, and its width when it was never dragged. */
export const TREE_MIN_WIDTH = 180;
export const TREE_MAX_WIDTH = 360;
export const TREE_DEFAULT_WIDTH = 220;
export const clampTreeWidth = (width: number) => Math.round(Math.min(TREE_MAX_WIDTH, Math.max(TREE_MIN_WIDTH, Number.isFinite(width) ? width : TREE_DEFAULT_WIDTH)));

const TREE_WIDTH_KEY = 'ui.filesTreeWidth';
const TREE_HIDDEN_KEY = 'ui.filesTreeHidden';
const sessionKey = (sessionId: string) => `ui.files.${sessionId}`;

// Per window: kept in sessionStorage, so a reload keeps it and another window has its own.
const read = (key: string): string | null => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Remembering is a convenience.
  }
};

let seq = 0;

/** A session's tabs and open folders from this window's sessionStorage; nothing when there are none or they don't read. */
function restore(sessionId: string): SessionFiles {
  try {
    const raw = JSON.parse(read(sessionKey(sessionId)) ?? 'null') as { tabs?: unknown; front?: unknown; folders?: unknown } | null;
    if (!raw) return EMPTY;
    const tabs = Array.isArray(raw.tabs) ? raw.tabs.filter((t): t is { path: string; line?: number } => typeof t?.path === 'string').map((t) => ({ path: t.path, ...(typeof t.line === 'number' ? { line: t.line } : {}), seq: ++seq })) : [];
    const folders = new Set(Array.isArray(raw.folders) ? raw.folders.filter((f): f is string => typeof f === 'string') : []);
    const front = typeof raw.front === 'string' && tabs.some((t) => t.path === raw.front) ? raw.front : (tabs.at(-1)?.path ?? null);
    return { ...EMPTY, tabs, folders, front };
  } catch {
    return EMPTY;
  }
}

/** What each session read back, once, so a session the store hasn't touched yet always gives the same object. */
const restored = new Map<string, SessionFiles>();
function restoredOnce(sessionId: string): SessionFiles {
  let files = restored.get(sessionId);
  if (!files) restored.set(sessionId, (files = restore(sessionId)));
  return files;
}

function persist(sessionId: string, files: SessionFiles) {
  write(sessionKey(sessionId), JSON.stringify({ tabs: files.tabs.map((t) => ({ path: t.path, ...(t.line ? { line: t.line } : {}) })), front: files.front, folders: [...files.folders] }));
}

const NOTHING_TOUCHED: TouchedFiles = { changed: new Set(), read: new Set() };

interface FilesPanelState {
  sessions: ReadonlyMap<string, SessionFiles>;
  /** The files Claude changed and read in each session, relative to its folder (the session view works them out). */
  touched: ReadonlyMap<string, TouchedFiles>;
  setTouched(sessionId: string, touched: TouchedFiles): void;
  /** The tree's width in this window. */
  treeWidth: number;
  /** The tree is hidden (at Full, its toggle). */
  treeHidden: boolean;
  get(sessionId: string): SessionFiles;
  setOpen(sessionId: string, open: boolean): void;
  setFull(sessionId: string, full: boolean): void;
  setMode(sessionId: string, mode: FilesMode): void;
  /** Opens a file in the viewer (a tab, in front), opening the panel in front of the others on the right. */
  openFile(sessionId: string, path: string, at?: { line?: number; endLine?: number; full?: boolean }): void;
  closeTab(sessionId: string, path: string): void;
  setFront(sessionId: string, path: string): void;
  setFolders(sessionId: string, folders: ReadonlySet<string>): void;
  setFilter(sessionId: string, filter: string): void;
  setSearch(sessionId: string, search: Partial<FileSearchQuery>): void;
  /** Asks the viewer to show its find bar or Go to line, or Search to take focus. */
  command(sessionId: string, kind: 'find' | 'goto' | 'search'): void;
  setTreeWidth(width: number): void;
  setTreeHidden(hidden: boolean): void;
}

export const useFilesPanel = create<FilesPanelState>()((set, get) => {
  const update = (sessionId: string, change: (files: SessionFiles) => SessionFiles, save = false) => {
    const next = change(get().get(sessionId));
    if (save) persist(sessionId, next);
    set((s) => ({ sessions: new Map(s.sessions).set(sessionId, next) }));
  };
  return {
    sessions: new Map(),
    touched: new Map(),
    setTouched: (sessionId, touched) =>
      set((s) => {
        const before = s.touched.get(sessionId);
        const same = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((x) => b.has(x));
        if (before && same(before.changed, touched.changed) && same(before.read, touched.read)) return s;
        return { touched: new Map(s.touched).set(sessionId, touched) };
      }),
    treeWidth: clampTreeWidth(Number(read(TREE_WIDTH_KEY) ?? TREE_DEFAULT_WIDTH)),
    treeHidden: read(TREE_HIDDEN_KEY) === 'on',
    get: (sessionId) => get().sessions.get(sessionId) ?? restoredOnce(sessionId),
    setOpen: (sessionId, open) => {
      update(sessionId, (f) => ({ ...f, open, full: open ? f.full : false }));
      if (open) useRightPanel.getState().setTab(sessionId, 'files');
    },
    setFull: (sessionId, full) => update(sessionId, (f) => ({ ...f, full })),
    setMode: (sessionId, mode) => update(sessionId, (f) => ({ ...f, mode })),
    openFile: (sessionId, path, at = {}) => {
      const tab: FileTab = { path, seq: ++seq, ...(at.line ? { line: at.line } : {}), ...(at.line && at.endLine && at.endLine > at.line ? { endLine: at.endLine } : {}) };
      update(
        sessionId,
        (f) => {
          const tabs = f.tabs.some((t) => t.path === path) ? f.tabs.map((t) => (t.path === path ? tab : t)) : [...f.tabs, tab];
          return { ...f, open: true, mode: 'files', tabs, front: path, full: at.full ?? f.full };
        },
        true,
      );
      useRightPanel.getState().setTab(sessionId, 'files');
    },
    closeTab: (sessionId, path) =>
      update(
        sessionId,
        (f) => {
          const at = f.tabs.findIndex((t) => t.path === path);
          const tabs = f.tabs.filter((t) => t.path !== path);
          const front = f.front !== path ? f.front : (tabs[Math.min(at, tabs.length - 1)]?.path ?? null);
          return { ...f, tabs, front };
        },
        true,
      ),
    setFront: (sessionId, path) => update(sessionId, (f) => ({ ...f, front: path }), true),
    setFolders: (sessionId, folders) => update(sessionId, (f) => ({ ...f, folders }), true),
    setFilter: (sessionId, filter) => update(sessionId, (f) => ({ ...f, filter })),
    setSearch: (sessionId, search) => update(sessionId, (f) => ({ ...f, search: { ...f.search, ...search } })),
    command: (sessionId, kind) => update(sessionId, (f) => ({ ...f, command: { kind, nonce: (f.command?.nonce ?? 0) + 1 } })),
    setTreeWidth: (width) => {
      const treeWidth = clampTreeWidth(width);
      write(TREE_WIDTH_KEY, String(treeWidth));
      set({ treeWidth });
    },
    setTreeHidden: (treeHidden) => {
      write(TREE_HIDDEN_KEY, treeHidden ? 'on' : 'off');
      set({ treeHidden });
    },
  };
});

/** A session's Files panel, as it shows it. */
export function useSessionFiles(sessionId: string): SessionFiles {
  return useFilesPanel((s) => s.sessions.get(sessionId)) ?? useFilesPanel.getState().get(sessionId);
}

/** The tab in front of a session's viewer, or null. */
export function frontTabOf(files: SessionFiles): FileTab | null {
  return files.tabs.find((t) => t.path === files.front) ?? null;
}

/** What Claude changed and read in a session; nothing before the session view worked it out. */
export function useTouched(sessionId: string | null): TouchedFiles {
  return useFilesPanel((s) => (sessionId ? s.touched.get(sessionId) : undefined)) ?? NOTHING_TOUCHED;
}
