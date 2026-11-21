/**
 * How many views of one window watch each session's stream (`useStreamWatch`): the first one starts the engine's watch,
 * the last one ends it, and the window takes deltas only for the sessions in here. Pure, with tests.
 */
export function createWatchCounts() {
  const counts = new Map<string, number>();
  return {
    /** One more view; true when it is the first (start watching). */
    add(sessionId: string): boolean {
      const views = (counts.get(sessionId) ?? 0) + 1;
      counts.set(sessionId, views);
      return views === 1;
    },
    /** One view fewer; true when it was the last (stop watching). */
    remove(sessionId: string): boolean {
      const left = (counts.get(sessionId) ?? 1) - 1;
      if (left > 0) {
        counts.set(sessionId, left);
        return false;
      }
      counts.delete(sessionId);
      return true;
    },
    has: (sessionId: string): boolean => counts.has(sessionId),
  };
}

/** Whether a window can be seen: main says it is shown and not minimised, and the page isn't hidden. */
export const canSee = (shownFromMain: boolean, visibilityState: string): boolean => shownFromMain && visibilityState !== 'hidden';
