import { useEffect, useSyncExternalStore } from 'react';
import { useEngineConnection } from '../engine/useEngine.ts';
import { clearStreaming } from './streamingStore.ts';
import { canSee, createWatchCounts } from './streamWatchCounts.ts';

/**
 * Whether this window can be seen: main says when it is shown and not minimised (the page can't tell a minimised window:
 * Seshboard's windows keep painting there), and the page says when it is hidden. A window out of sight watches no streams.
 */
const bridge = typeof window === 'undefined' ? undefined : window.seshboard;
const listeners = new Set<() => void>();
bridge?.onWindowShown?.(() => {
  for (const listener of [...listeners]) listener();
});
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  document.addEventListener('visibilitychange', listener);
  return () => {
    listeners.delete(listener);
    document.removeEventListener('visibilitychange', listener);
  };
};
const seenNow = () => canSee(bridge?.windowShown?.() ?? true, typeof document === 'undefined' ? 'visible' : document.visibilityState);

/** The sessions each engine connection of this window watches the stream of. */
const watching = new WeakMap<object, ReturnType<typeof createWatchCounts>>();
const countsFor = (client: object) => {
  let counts = watching.get(client);
  if (!counts) watching.set(client, (counts = createWatchCounts()));
  return counts;
};

/** Whether this window watches the session's stream on `client`: a delta for another one (in flight from before) is dropped. */
export const watchesStream = (client: object, sessionId: string): boolean => watching.get(client)?.has(sessionId) ?? false;

/**
 * Gets `session.stream` for the session while this view is mounted and its window can be seen: the engine sends each
 * session's streaming text only to the views that show it (the session view, Home's Working card). Views of one window
 * share one watch. When the last one stops, the window drops what it had; a later watch starts with a `clear` and the
 * engine's copy of the reply so far.
 */
export function useStreamWatch(sessionId: string | null): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const visible = useSyncExternalStore(subscribe, seenNow, () => true);
  useEffect(() => {
    if (!client || !sessionId || !visible) return;
    const counts = countsFor(client);
    if (counts.add(sessionId)) void client.call('stream.watch', { sessionId }).catch(() => {});
    return () => {
      if (!counts.remove(sessionId)) return;
      void client.call('stream.unwatch', { sessionId }).catch(() => {});
      clearStreaming(sessionId);
    };
  }, [client, sessionId, visible]);
}
