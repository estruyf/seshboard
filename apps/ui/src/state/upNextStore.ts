import { useEffect } from 'react';
import { create } from 'zustand';
import type { QueuedMessage } from '@switchboard/protocol/client';
import { useEngineConnection } from '../engine/useEngine.ts';

/**
 * Up next for every session, as the engine keeps it: also for sessions that aren't running (stopped, or from before
 * the app quit), whose host info isn't there to say.
 */
interface UpNextState {
  queues: ReadonlyMap<string, readonly QueuedMessage[]>;
  replace(lists: ReadonlyArray<{ sessionId: string; queue: QueuedMessage[] }>): void;
  set(sessionId: string, queue: QueuedMessage[]): void;
}

export const useUpNext = create<UpNextState>()((set) => ({
  queues: new Map(),
  replace: (lists) => set({ queues: new Map(lists.map(({ sessionId, queue }) => [sessionId, queue])) }),
  set: (sessionId, queue) =>
    set((s) => {
      const queues = new Map(s.queues);
      if (queue.length) queues.set(sessionId, queue);
      else queues.delete(sessionId);
      return { queues };
    }),
}));

/** Loads every session's Up next once per connection and follows changes from every window. */
export function useUpNextSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client) return;
    const off = client.on('upNext.changed', ({ sessionId, queue }) => useUpNext.getState().set(sessionId, queue));
    void client.call('upNext.list', {}).then(({ queues }) => useUpNext.getState().replace(queues), () => {});
    return off;
  }, [client]);
}
