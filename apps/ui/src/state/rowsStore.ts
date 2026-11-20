import { create } from 'zustand';
import { useHosts } from './hostsStore.ts';
import { toRows, useSessions, type RowCache, type SessionRowData } from './sessionsStore.ts';

/**
 * The sessions as rows (`toRows`), built once per change and read by every view that lists them: the sidebar, its rail,
 * Home, the queue, the palette, Unsent and the rest. A row is the same object while the session's summary, registry
 * entry and host are, so a view that memoises on the rows (or on one row) skips what did not change: a host event for
 * one session builds one new row. A session with a queued prompt is marked `kept` here already; one with an unsent draft
 * or a loose end is not (`markKept` adds that for the views that list those sessions). Rows are not narrowed to a
 * session scope either (`inScope`). The rows are shared: nobody changes them.
 */
interface RowsState {
  rows: readonly SessionRowData[];
  byId: ReadonlyMap<string, SessionRowData>;
}

const cache: RowCache = new Map();

function build(previous: RowsState | null): RowsState {
  const { sessions, live } = useSessions.getState();
  const rows = toRows(sessions, live, useHosts.getState().hosts, undefined, cache);
  // Every row is the object it was: the same state, so nobody re-renders.
  if (previous && rows.length === previous.rows.length && rows.every((row, i) => row === previous.rows[i])) return previous;
  return { rows, byId: new Map(rows.map((row) => [row.id, row])) };
}

export const useRows = create<RowsState>()(() => build(null));

const refresh = () => {
  const next = build(useRows.getState());
  if (next !== useRows.getState()) useRows.setState(next, true);
};

// Follows what the rows are made from. Each source replaces its Map when something in it changed, so the checks are
// by identity: a change to anything else in these stores (the selected session, the panes) costs nothing.
let last = { sessions: useSessions.getState().sessions, live: useSessions.getState().live, hosts: useHosts.getState().hosts };
const changed = () => {
  const now = { sessions: useSessions.getState().sessions, live: useSessions.getState().live, hosts: useHosts.getState().hosts };
  if (now.sessions === last.sessions && now.live === last.live && now.hosts === last.hosts) return;
  last = now;
  refresh();
};
useSessions.subscribe(changed);
useHosts.subscribe(changed);

/** The current rows without subscribing (event handlers). */
export const currentRows = (): readonly SessionRowData[] => useRows.getState().rows;
