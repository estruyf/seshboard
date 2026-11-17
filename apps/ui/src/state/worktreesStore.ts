import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { anyFactsPending, isAbsolutePath, type WorktreeEntry, type WorktreeList, type WorktreeSize } from '@seshboard/protocol/client';
import type { EngineClient } from '../engine/connection.ts';
import { addEarly, applyEarly, listIsFresh, pendingCount, PENDING_STALE_MS, type EarlyFacts } from './worktreeFactsFeed.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { NO_SESSIONS, worktreeRows, type WorktreeRow, type WorktreeSessions } from '../components/worktrees/worktreeGroups.ts';
import { useHosts } from './hostsStore.ts';
import { isBusy } from './queue.ts';
import { toRows, useSessions, type SessionRowData } from './sessionsStore.ts';
import { rowStatus } from './sidebarRows.ts';

/** A project's worktrees as last read. */
export interface WorktreesOf {
  list: WorktreeList | null;
  /** Not a git repository: there is nothing to list. */
  notRepo: boolean;
  error: string | null;
  loading: boolean;
  loadedAt: number | null;
}

const EMPTY: WorktreesOf = { list: null, notRepo: false, error: null, loading: false, loadedAt: null };

interface WorktreesState {
  byRoot: Map<string, WorktreesOf>;
  /** Sizes on disk by worktree path, as the engine measures them. */
  sizes: Map<string, WorktreeSize>;
  patch(root: string, change: Partial<WorktreesOf>): void;
  addSizes(sizes: WorktreeSize[]): void;
}

export const useWorktrees = create<WorktreesState>()((set) => ({
  byRoot: new Map(),
  sizes: new Map(),
  patch: (root, change) =>
    set((s) => {
      const byRoot = new Map(s.byRoot);
      byRoot.set(root, { ...(s.byRoot.get(root) ?? EMPTY), ...change });
      return { byRoot };
    }),
  addSizes: (list) =>
    set((s) => {
      if (list.length === 0) return {};
      const sizes = new Map(s.sizes);
      for (const size of list) sizes.set(size.path, size);
      return { sizes };
    }),
}));

/**
 * Asks for the sizes of a project's worktrees: what is known comes back at once, the rest arrives through
 * `worktrees.sizes` as `du` finishes. `refresh` measures every one again.
 */
export function requestSizes(client: EngineClient, list: WorktreeList, refresh = false): void {
  const paths = list.worktrees.filter((w) => !w.missing).map((w) => w.path);
  if (paths.length) void client.call('worktrees.size', { paths, refresh }).then(({ sizes }) => useWorktrees.getState().addSizes(sizes), () => {});
}

/**
 * Reads a project's worktrees; `fetch` runs `git fetch` first and asks `gh` again. Sizes are asked for separately
 * (`requestSizes`), only where they are shown: the Projects list's pills don't need `du` running in every project.
 */
export async function loadWorktrees(client: EngineClient, root: string, options: { fetch?: boolean } = {}): Promise<WorktreeList | null> {
  const { patch } = useWorktrees.getState();
  patch(root, { loading: true });
  early.delete(root);
  try {
    // The engine answers at once, even for dozens of worktrees: what is slow in them follows with `worktrees.facts`.
    const answer = await client.call('worktrees.list', { root, fetch: options.fetch ?? false });
    // What the list before it knew is not carried over: a change that doesn't move HEAD would still read as clean. The
    // engine keeps the facts of a read under way for reloads (`held`), so they come back in the answer.
    const list = applyEarly(answer, early.get(root));
    early.delete(root);
    patch(root, { list, notRepo: false, error: null, loading: false, loadedAt: Date.now() });
    return list;
  } catch (error) {
    early.delete(root);
    const code = (error as { code?: string }).code;
    patch(root, { loading: false, loadedAt: Date.now(), notRepo: code === 'NOT_A_REPO', error: code === 'NOT_A_REPO' ? null : (error as Error).message });
    return null;
  }
}

/** What reached us while a project's list was being read, to go on the list when it is here. */
const early = new Map<string, EarlyFacts>();

/** Puts late facts or pull requests on a project's list; while it is being read they are kept for the answer, too. */
function takeIn(root: string, event: Parameters<typeof addEarly>[1]): void {
  const state = useWorktrees.getState();
  const current = state.byRoot.get(root);
  if (current?.loading) early.set(root, addEarly(early.get(root), event));
  if (current?.list) state.patch(root, { list: applyEarly(current.list, addEarly(undefined, event)) });
}

/** Takes in sizes, and the facts of the worktrees, as the engine measures and reads them. Mount once. */
export function useWorktreesSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client) return;
    const offs = [
      client.on('worktrees.sizes', ({ sizes }) => useWorktrees.getState().addSizes(sizes)),
      client.on('worktrees.facts', ({ root, facts }) => takeIn(root, { facts })),
      client.on('worktrees.pullRequests', ({ root, pullRequests }) => takeIn(root, { pullRequests })),
    ];
    return () => offs.forEach((off) => off());
  }, [client]);
}

/** A project's worktrees, read when first shown and again once the list is older than half a minute. */
export function useWorktreesOf(root: string | null): WorktreesOf {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const state = useWorktrees((s) => (root ? s.byRoot.get(root) : undefined));
  useEffect(() => {
    if (!client || !root || !isAbsolutePath(root)) return;
    const current = useWorktrees.getState().byRoot.get(root);
    if (current?.loading || (current?.loadedAt && listIsFresh(current.loadedAt, current.list, Date.now()))) return;
    void loadWorktrees(client, root);
  }, [client, root]);
  // A list that is still being read after a while may have lost a fact (a worktree moved on, an event missed): read it
  // again. The engine joins reads already under way, so a slow repository isn't started over.
  // The timer starts over with every fact that comes in: only 15 seconds without progress count as stuck, so a big
  // repository that is slowly being read is left alone.
  const waiting = pendingCount(state?.list);
  const readAt = state?.loadedAt ?? null;
  useEffect(() => {
    if (!client || !root || waiting === 0) return;
    const timer = setTimeout(() => {
      const current = useWorktrees.getState().byRoot.get(root);
      if (current && !current.loading && current.list && anyFactsPending(current.list)) void loadWorktrees(client, root);
    }, PENDING_STALE_MS);
    return () => clearTimeout(timer);
  }, [client, root, waiting, readAt]);
  return state ?? EMPTY;
}

/** Asks for the sizes of a project's worktrees whenever its list is read again (the Worktrees tab, the Overview's card). */
export function useWorktreeSizes(list: WorktreeList | null): ReadonlyMap<string, WorktreeSize> {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  // Facts arriving one by one make a new list each time; the sizes are only asked for again when the worktrees change.
  const paths = list ? list.worktrees.filter((w) => !w.missing).map((w) => w.path).join('\n') : null;
  useEffect(() => {
    if (client && list && paths !== null) requestSizes(client, list);
  }, [client, paths]);
  return useWorktrees((s) => s.sizes);
}

/** How each worktree's sessions stand, from the sidebar's rows (every session, whatever the sidebar's scope). */
export function sessionsIn(entry: WorktreeEntry, rows: ReadonlyMap<string, SessionRowData>): WorktreeSessions {
  if (entry.sessions.length === 0) return NO_SESSIONS;
  const counts = { busy: 0, needsYou: 0, open: 0, total: 0 };
  for (const id of entry.sessions) {
    const row = rows.get(id);
    counts.total++;
    if (!row) continue;
    if (isBusy(row)) counts.busy++;
    if (rowStatus(row) === 'needs-you') counts.needsYou++;
    if (row.live) counts.open++;
  }
  return counts;
}

/** Every session the app knows, with its live state, by id. */
export function useAllSessionRows(): Map<string, SessionRowData> {
  const sessions = useSessions((s) => s.sessions);
  const live = useSessions((s) => s.live);
  const hosts = useHosts((s) => s.hosts);
  return useMemo(() => new Map(toRows(sessions, live, hosts).map((row) => [row.id, row])), [sessions, live, hosts]);
}

/** A project's worktrees grouped for the overview, with their sessions' live state. */
export function useWorktreeRows(root: string | null): { state: WorktreesOf; rows: WorktreeRow[] } {
  const state = useWorktreesOf(root);
  const sessionRows = useAllSessionRows();
  const rows = useMemo(() => (state.list ? worktreeRows(state.list.worktrees, (entry) => sessionsIn(entry, sessionRows), Date.now()) : []), [state.list, sessionRows]);
  return { state, rows };
}
