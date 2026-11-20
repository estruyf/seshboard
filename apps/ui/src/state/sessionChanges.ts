import type { SessionsChanged, SessionSummary } from '@seshboard/protocol/client';

/**
 * Applies `sessions.changed` events, oldest first, to a copy of the sessions map: one copy however many events
 * there are, so a burst of hundreds of new sessions costs one pass instead of one copy per event. With no events
 * it returns what it was given (the same map), so the store doesn't tell anyone something changed.
 */
export function mergeSessionChanges(
  current: { sessions: Map<string, SessionSummary>; complete: boolean },
  changes: readonly SessionsChanged[],
): { sessions: Map<string, SessionSummary>; complete: boolean } {
  if (changes.length === 0) return current;
  const sessions = new Map(current.sessions);
  let changed = false;
  for (const change of changes) {
    for (const s of change.upserted) {
      // The engine sends a summary again whenever its file was written: one that came out the same keeps the object
      // it had, so the rows built from it (and the sidebar's memoised rows) stay as they were.
      const had = sessions.get(s.id);
      if (had && sameSummary(had, s)) continue;
      sessions.set(s.id, s);
      changed = true;
    }
    for (const id of change.removed) changed = sessions.delete(id) || changed;
  }
  const complete = changes.at(-1)!.complete;
  // Nothing different at all: the same state, so nobody re-renders.
  return changed || complete !== current.complete ? { sessions: changed ? sessions : current.sessions, complete } : current;
}

/** Two summaries that say the same (they are plain data). */
export function sameSummary(a: SessionSummary, b: SessionSummary): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** Runs `run` later; returns a function that cancels it. */
export type Schedule = (run: () => void) => () => void;

/**
 * Collects items and hands them over together, in the order they came, once per scheduled run (an animation
 * frame in the window). `flush()` hands them over now, for when waiting would show something stale (the first list).
 */
export function createBatcher<T>(apply: (items: T[]) => void, schedule: Schedule) {
  let pending: T[] = [];
  let cancel: (() => void) | null = null;
  const flush = () => {
    cancel?.();
    cancel = null;
    if (pending.length === 0) return;
    const items = pending;
    pending = [];
    apply(items);
  };
  return {
    push(item: T): void {
      pending.push(item);
      cancel ??= schedule(flush);
    },
    flush,
    /** Drops what is waiting (the connection it came from is gone). */
    cancel(): void {
      cancel?.();
      cancel = null;
      pending = [];
    },
  };
}

/**
 * The sessions with one summary changed here, ahead of the engine (Mark as read in the sidebar, Archive from the catch-up), or the same
 * map when the session isn't known.
 */
export function patchedSessions(
  sessions: Map<string, SessionSummary>,
  id: string,
  patch: Partial<Pick<SessionSummary, 'unread' | 'viewedAt' | 'archivedAt' | 'note'>>,
): Map<string, SessionSummary> {
  const summary = sessions.get(id);
  return summary ? new Map(sessions).set(id, { ...summary, ...patch }) : sessions;
}
