import { create } from 'zustand';
import type { LiveSession, SessionHostInfo, SessionsChanged, SessionsSnapshot, SessionSummary } from '@switchboard/protocol/client';
import { hostAsLive, isActiveHost } from './hostsStore.ts';
import { mergeSessionChanges, patchedSessions } from './sessionChanges.ts';
import * as panes from './paneState.ts';
import { leafIds, type Tile } from './tiling.ts';
import { useTilingArea } from './tilingArea.ts';
import type { DropTarget, Way } from './tilingGeometry.ts';
import type { RemoteRowInfo } from './remoteRows.ts';
import { useRunOn } from './runOnStore.ts';
import { toast } from './toastStore.ts';

/**
 * `project` is one project's page (`useProjectPage` says which); `projects` is the list of them; `remote` is a session
 * on another computer, or that computer's page (`useComputers` says which).
 */
export type MainView = 'session' | 'new' | 'settings' | 'projects' | 'project' | 'usage' | 'remote';
/** The pages of Settings, listed in its own sidebar. */
export type SettingsSection = 'general' | 'theme' | 'sidebar' | 'sessions' | 'conversation' | 'mods' | 'notifications' | 'focus' | 'profiles' | 'memory' | 'prompts' | 'vscode' | 'remote' | 'backup' | 'diagnostics' | 'about';

/** Shown when there is no room for another pane (a session opened beside, or a pane dropped where it doesn't fit). */
const NO_ROOM = 'There is no room for that. Make the window larger or close a pane first.';

/** The panes as the pure functions in `paneState.ts` take them: the layout and the active pane's session. */
const now = (s: { layout: Tile | null; selectedId: string | null }): panes.PaneState => ({ layout: s.layout, active: s.selectedId });

/**
 * What a change of the panes sets: the layout, the sessions in it (the same array while they don't change, so
 * the sidebar doesn't redraw for a divider moving) and `selectedId`, which always follows the active pane.
 * Nothing at all when the panes didn't change.
 */
function apply(s: { layout: Tile | null; selectedId: string | null; paneIds: readonly string[] }, next: panes.PaneState) {
  if (next.layout === s.layout && next.active === s.selectedId) return {};
  const ids = leafIds(next.layout);
  const same = ids.length === s.paneIds.length && ids.every((id, k) => id === s.paneIds[k]);
  return { layout: next.layout, paneIds: same ? s.paneIds : ids, selectedId: next.active };
}

interface SessionsState {
  sessions: Map<string, SessionSummary>;
  /** Live registry entries keyed by session id. */
  live: Map<string, LiveSession>;
  /** True once the engine finished its first scan of ~/.claude (until then the list is from cache). */
  complete: boolean;
  loaded: boolean;
  /** The session in the active pane (what ⌘O, the palette and notifications act on). Null: Home, no pane is open. */
  selectedId: string | null;
  /** The panes as a tree of splits (`tiling.ts`); a lone pane is a single leaf, null is Home. Every pane shows one session. */
  layout: Tile | null;
  /** The sessions open in the panes, in reading order (left to right, top to bottom). The same array until they change. */
  paneIds: readonly string[];
  view: MainView;
  /** The Settings page shown when Settings opens; kept while the app runs, so ⌘, returns to it. */
  settingsSection: SettingsSection;
  /** What Settings opened over: it stays on screen behind the Settings sheet, and closing Settings returns to it. */
  settingsFrom: Exclude<MainView, 'settings'>;
  /** Bumped each time New session is asked for (⌘N, the sidebar, the palette), so the view focuses its prompt even when already open. */
  newSessionRequest: number;
  filter: string;

  applySnapshot(snapshot: SessionsSnapshot): void;
  /** Applies `sessions.changed` events, oldest first, in one update (a burst of them arrives batched). */
  applyChanged(changes: readonly SessionsChanged[]): void;
  setLive(live: LiveSession[]): void;
  /**
   * Changes a session's summary here at once, ahead of the engine's `sessions.changed` (Mark as read, Archive), so the
   * focus counter and the sidebar follow the click right away. The engine's next update replaces it.
   */
  patchSummary(id: string, patch: Partial<Pick<SessionSummary, 'unread' | 'viewedAt' | 'archivedAt'>>): void;
  /** Shows a session in the active pane (or focuses the pane already showing it). */
  select(id: string | null): void;
  /** Opens a session in a new pane next to the active one (`planOpen`); with no room, says so in a toast instead. */
  openBeside(id: string): void;
  /** Drops a session on a part of a pane or along an edge of the window (`planDrop`): one already open moves there, a new one docks (or replaces a pane's session in its centre). With no room, says so. */
  dropOn(id: string, target: DropTarget): void;
  /** Closes the pane showing a session (the active one by default); its neighbours take the space. A lone pane stays. */
  closePane(id?: string): void;
  /** Closes every pane but the active one. */
  closeOtherPanes(): void;
  /** Closes the open session(s) and shows Home. A working session keeps running. */
  closeSession(): void;
  /** Closes the panes showing any of these sessions (after archiving them); the others take the space, and with none left, Home shows. */
  closeSessions(ids: readonly string[]): void;
  /** Shows Home: what needs you, what is working, and your projects. */
  goHome(): void;
  /** Makes the pane showing a session the active one. */
  focusPane(id: string): void;
  /** Makes the pane next door in a direction active. */
  focusWay(way: Way): void;
  /** Makes the next pane (or with -1 the one before) in reading order active. */
  focusNext(step?: 1 | -1): void;
  /** The active pane trades sessions with the next one; the active pane stays with its session. */
  swapPanes(): void;
  /** The split that holds the active pane turns the other way: side by side becomes stacked, and back. With no room for the result, says so in a toast. */
  flipSplit(): void;
  /** Replaces the layout with one of the same sessions in other sizes (a divider moved). */
  resizePanes(layout: Tile): void;
  setView(view: MainView): void;
  /** Opens Settings, on a given page or the last one shown. */
  openSettings(section?: SettingsSection): void;
  /** Closes Settings and returns to the view it opened over. */
  closeSettings(): void;
  /**
   * Opens the New session view and asks it to focus the prompt. It starts on this computer, or with `runOn: 'last'`
   * (the sidebar's +) on the computer picked last in Run on.
   */
  openNewSession(options?: { runOn?: 'here' | 'last' }): void;
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
  layout: null,
  paneIds: [],
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
  applyChanged: (changes) => {
    if (changes.length > 0) set((state) => mergeSessionChanges(state, changes));
  },
  setLive: (live) => set({ live: new Map(live.map((l) => [l.sessionId, l])) }),
  patchSummary: (id, patch) => set((state) => ({ sessions: patchedSessions(state.sessions, id, patch) })),
  select: (id) => set((s) => ({ ...apply(s, panes.showSession(now(s), id)), view: 'session' })),
  openBeside: (id) => {
    const out = panes.openBeside(now(useSessions.getState()), id, useTilingArea.getState().size);
    if (!out.opened) return toast(NO_ROOM);
    set((s) => ({ ...apply(s, out.state), view: 'session' }));
  },
  dropOn: (id, target) => {
    const out = panes.drop(now(useSessions.getState()), id, target, useTilingArea.getState().size);
    if (out.outcome === 'no-room') return toast(NO_ROOM);
    if (out.outcome === 'done') set((s) => ({ ...apply(s, out.state), view: 'session' }));
  },
  closePane: (id) => set((s) => apply(s, panes.closePane(now(s), id))),
  closeOtherPanes: () => set((s) => apply(s, panes.closeOthers(now(s)))),
  closeSession: () => set((s) => ({ ...apply(s, panes.NO_PANES), view: 'session' })),
  closeSessions: (ids) => set((s) => apply(s, panes.closeSessions(now(s), ids))),
  goHome: () => set((s) => ({ ...apply(s, panes.NO_PANES), view: 'session' })),
  focusPane: (id) => set((s) => apply(s, panes.focusPane(now(s), id))),
  focusWay: (way) => set((s) => apply(s, panes.focusWay(now(s), way))),
  focusNext: (step = 1) => set((s) => apply(s, panes.focusNext(now(s), step))),
  swapPanes: () => set((s) => apply(s, panes.swapWithNext(now(s)))),
  flipSplit: () => {
    const out = panes.flipActive(now(useSessions.getState()), useTilingArea.getState().size);
    if (!out.ok) return toast(NO_ROOM);
    set((s) => apply(s, out.state));
  },
  resizePanes: (layout) => set((s) => apply(s, panes.commitLayout(now(s), layout))),
  setView: (view) => set({ view }),
  openSettings: (section) =>
    set((s) => ({ view: 'settings', settingsSection: section ?? s.settingsSection, settingsFrom: s.view === 'settings' ? s.settingsFrom : s.view })),
  closeSettings: () => set((s) => (s.view === 'settings' ? { view: s.settingsFrom } : {})),
  openNewSession: (options) => {
    useRunOn.getState().openOn(options?.runOn ?? 'here');
    set((s) => ({ view: 'new', newSessionRequest: s.newSessionRequest + 1 }));
  },
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
  /**
   * A session on another computer (`remoteRows`): its computer, its id there and its state. Its row's `id` is
   * `remoteRowId`, never a local session id; `live` and `summary` are null.
   */
  remote?: RemoteRowInfo | null;
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
