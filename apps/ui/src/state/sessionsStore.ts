import { create } from 'zustand';
import type { LiveSession, SessionHostInfo, SessionsChanged, SessionsSnapshot, SessionSummary } from '@switchboard/protocol/client';
import { hostAsLive, isActiveHost } from './hostsStore.ts';

/** `project` is one project's page (`useProjectPage` says which); `projects` is the list of them. */
export type MainView = 'session' | 'new' | 'settings' | 'projects' | 'project' | 'usage';
/** The pages of Settings, listed in its own sidebar. */
export type SettingsSection = 'general' | 'theme' | 'sidebar' | 'sessions' | 'conversation' | 'notifications' | 'focus' | 'profiles' | 'memory' | 'vscode' | 'backup' | 'diagnostics' | 'about';
export type Pane = 'main' | 'split';

const other = (pane: Pane): Pane => (pane === 'main' ? 'split' : 'main');
type PaneState = { mainId: string | null; splitId: string | null; activePane: Pane };
/** The pane fields plus `selectedId`, which always follows the active pane. */
const panes = (next: PaneState) => ({ ...next, selectedId: next.activePane === 'split' ? next.splitId : next.mainId });

interface SessionsState {
  sessions: Map<string, SessionSummary>;
  /** Live registry entries keyed by session id. */
  live: Map<string, LiveSession>;
  /** True once the engine finished its first scan of ~/.claude (until then the list is from cache). */
  complete: boolean;
  loaded: boolean;
  /** The session in the active pane (what ⌘O, the palette and notifications act on). */
  selectedId: string | null;
  /** Two sessions side by side: the left (main) pane, the optional right (split) pane, and which is active. */
  mainId: string | null;
  splitId: string | null;
  activePane: Pane;
  view: MainView;
  /** The Settings page shown when Settings opens; kept while the app runs, so ⌘, returns to it. */
  settingsSection: SettingsSection;
  /** What Settings opened over: it stays on screen behind the Settings sheet, and closing Settings returns to it. */
  settingsFrom: Exclude<MainView, 'settings'>;
  /** Bumped each time New session is asked for (⌘N, the sidebar, the palette), so the view focuses its prompt even when already open. */
  newSessionRequest: number;
  filter: string;

  applySnapshot(snapshot: SessionsSnapshot): void;
  applyChanged(change: SessionsChanged): void;
  setLive(live: LiveSession[]): void;
  /** Shows a session in the active pane (or focuses the pane already showing it). */
  select(id: string | null): void;
  /** Shows a session in the other pane, opening the split if needed. */
  openBeside(id: string): void;
  /** Closes one pane (default: the right one); the other takes the full width. */
  closePane(pane?: Pane): void;
  /** Closes the open session(s) and shows Home. A working session keeps running. */
  closeSession(): void;
  /** Closes the panes showing any of these sessions (after archiving them); the other pane takes the full width, and with none left, Home shows. */
  closeSessions(ids: readonly string[]): void;
  /** Shows Home: what needs you, what is working, and your projects. */
  goHome(): void;
  focusPane(pane: Pane): void;
  setView(view: MainView): void;
  /** Opens Settings, on a given page or the last one shown. */
  openSettings(section?: SettingsSection): void;
  /** Closes Settings and returns to the view it opened over. */
  closeSettings(): void;
  /** Opens the New session view and asks it to focus the prompt. */
  openNewSession(): void;
  setFilter(filter: string): void;
}

/** Claude Code records `HEAD` when there is no branch (e.g. before the first commit); that is not a name worth showing. */
export const realBranch = (branch: string | null) => (branch && branch !== 'HEAD' ? branch : null);

export const useSessions = create<SessionsState>()((set) => ({
  sessions: new Map(),
  live: new Map(),
  complete: false,
  loaded: false,
  selectedId: null,
  mainId: null,
  splitId: null,
  activePane: 'main',
  view: 'session',
  settingsSection: 'general',
  settingsFrom: 'session',
  newSessionRequest: 0,
  filter: '',

  applySnapshot: (snapshot) =>
    set({
      sessions: new Map(snapshot.sessions.map((s) => [s.id, s])),
      live: new Map(snapshot.live.map((l) => [l.sessionId, l])),
      complete: snapshot.complete,
      loaded: true,
    }),
  applyChanged: (change) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      for (const s of change.upserted) sessions.set(s.id, s);
      for (const id of change.removed) sessions.delete(id);
      return { sessions, complete: change.complete };
    }),
  setLive: (live) => set({ live: new Map(live.map((l) => [l.sessionId, l])) }),
  select: (id) =>
    set((s) => {
      if (id && s.splitId) {
        if (id === s.mainId) return { ...panes({ ...s, activePane: 'main' }), view: 'session' };
        if (id === s.splitId) return { ...panes({ ...s, activePane: 'split' }), view: 'session' };
      }
      const next = { mainId: s.mainId, splitId: s.splitId, activePane: s.splitId ? s.activePane : ('main' as Pane) };
      if (next.activePane === 'split') next.splitId = id;
      else next.mainId = id;
      return { ...panes(next), view: 'session' };
    }),
  openBeside: (id) =>
    set((s) => {
      if (!s.mainId) return { ...panes({ mainId: id, splitId: null, activePane: 'main' }), view: 'session' };
      if (id === s.mainId || id === s.splitId) return { ...panes({ ...s, activePane: id === s.mainId ? 'main' : 'split' }), view: 'session' };
      const target = s.splitId ? other(s.activePane) : 'split';
      const next = { mainId: s.mainId, splitId: s.splitId, activePane: target };
      if (target === 'split') next.splitId = id;
      else next.mainId = id;
      return { ...panes(next), view: 'session' };
    }),
  closePane: (pane = 'split') =>
    set((s) => {
      if (!s.splitId) return {};
      return panes({ mainId: pane === 'main' ? s.splitId : s.mainId, splitId: null, activePane: 'main' });
    }),
  closeSession: () => set({ ...panes({ mainId: null, splitId: null, activePane: 'main' }), view: 'session' }),
  closeSessions: (ids) =>
    set((s) => {
      const keepMain = s.mainId !== null && !ids.includes(s.mainId);
      const keepSplit = s.splitId !== null && !ids.includes(s.splitId);
      if (keepMain === (s.mainId !== null) && keepSplit === (s.splitId !== null)) return {};
      return panes({ mainId: keepMain ? s.mainId : keepSplit ? s.splitId : null, splitId: keepMain && keepSplit ? s.splitId : null, activePane: keepMain && keepSplit ? s.activePane : 'main' });
    }),
  goHome: () => set({ ...panes({ mainId: null, splitId: null, activePane: 'main' }), view: 'session' }),
  focusPane: (pane) => set((s) => (s.activePane === pane || (pane === 'split' && !s.splitId) ? {} : panes({ ...s, activePane: pane }))),
  setView: (view) => set({ view }),
  openSettings: (section) =>
    set((s) => ({ view: 'settings', settingsSection: section ?? s.settingsSection, settingsFrom: s.view === 'settings' ? s.settingsFrom : s.view })),
  closeSettings: () => set((s) => (s.view === 'settings' ? { view: s.settingsFrom } : {})),
  openNewSession: () => set((s) => ({ view: 'new', newSessionRequest: s.newSessionRequest + 1 })),
  setFilter: (filter) => set({ filter }),
}));

/** A session as the sidebar shows it: the summary (if indexed) merged with its live state. */
export interface SessionRowData {
  id: string;
  title: string;
  projectRoot: string;
  updatedAt: number;
  branch: string | null;
  isWorktree: boolean;
  live: LiveSession | null;
  summary: SessionSummary | null;
  pinned: boolean;
  archivedAt: number | null;
  /** When the user unarchived it by hand: in the main list until there's activity after it. */
  restoredAt: number | null;
  unread: boolean;
  /** Started, forked or continued in Switchboard, or running in it now. */
  inApp: boolean;
  /** The last run in this app failed. */
  error: boolean;
  /** The Claude profile the session belongs to. */
  profileId: string;
}

export function toRows(
  sessions: Map<string, SessionSummary>,
  live: Map<string, LiveSession>,
  hosts: Map<string, SessionHostInfo> = new Map(),
): SessionRowData[] {
  const rows: SessionRowData[] = [];
  // Sessions running in this app report their own state; it is more precise than the registry.
  const liveFor = (id: string) => {
    const host = hosts.get(id);
    return isActiveHost(host) ? hostAsLive(host) : (live.get(id) ?? null);
  };
  for (const s of sessions.values()) {
    const l = liveFor(s.id);
    rows.push({
      id: s.id,
      title: l?.name && !s.customTitle ? l.name : s.title,
      projectRoot: s.projectRoot,
      // An idle process says nothing new happened (Claude Code reopening a session marks it idle "now").
      updatedAt: Math.max(s.updatedAt, l && l.status !== 'idle' ? (l.updatedAt ?? 0) : 0),
      branch: s.worktree?.branch ?? realBranch(s.gitBranch),
      isWorktree: s.worktree !== null,
      live: l,
      summary: s,
      pinned: s.pinned,
      archivedAt: s.archivedAt,
      restoredAt: s.restoredAt,
      unread: s.unread,
      inApp: s.inApp || l?.origin === 'app',
      error: hosts.get(s.id)?.state === 'error',
      profileId: s.profileId,
    });
  }
  // Running sessions that have not written a transcript yet still deserve a row.
  const seen = new Set(sessions.keys());
  const pending = [
    ...[...hosts.values()].filter(isActiveHost).flatMap((h) => hostAsLive(h) ?? []),
    ...live.values(),
  ];
  for (const l of pending) {
    if (seen.has(l.sessionId)) continue;
    // SDK processes without a conversation are helpers (command lists, usage, tools) or
    // background workers, from this app or another; they aren't sessions to show.
    if (l.origin === 'sdk') continue;
    seen.add(l.sessionId);
    rows.push({
      id: l.sessionId,
      title: l.name ?? 'New session',
      projectRoot: l.projectRoot ?? l.cwd ?? 'Unknown folder',
      updatedAt: l.updatedAt ?? l.startedAt ?? Date.now(),
      branch: null,
      isWorktree: false,
      live: l,
      summary: null,
      pinned: false,
      archivedAt: null,
      restoredAt: null,
      unread: false,
      inApp: l.origin === 'app',
      error: false,
      profileId: l.profileId,
    });
  }
  return rows;
}
