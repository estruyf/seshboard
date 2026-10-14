import type { SessionsChanged, SessionSummary } from '@switchboard/protocol/client';

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
  for (const change of changes) {
    for (const s of change.upserted) sessions.set(s.id, s);
    for (const id of change.removed) sessions.delete(id);
  }
  return { sessions, complete: changes.at(-1)!.complete };
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
