import { useCallback } from 'react';
import type { TriggerEvent } from '@switchboard/protocol/client';
import { useHosts } from '../../state/hostsStore.ts';
import { useLater } from '../../state/laterStore.ts';
import type { EventSessionState } from '../../state/triggers.ts';

/**
 * Where each triggered session is, from this window's hosts: working, waiting for you, or finished. And which events
 * hold a slot under their trigger's `maxAtOnce`: a busy session, or a queued item still on the queue.
 */
export function useTriggerSessions() {
  const hosts = useHosts((s) => s.hosts);
  const queued = useLater((s) => s.items);
  const stateOf = useCallback(
    (sessionId: string | null): EventSessionState => {
      const host = sessionId ? hosts.get(sessionId) : undefined;
      if (host?.state === 'needs-you') return 'needs-you';
      if (host?.state === 'running' || host?.state === 'starting') return 'working';
      return 'finished';
    },
    [hosts],
  );
  const busy = useCallback(
    (event: TriggerEvent) => (event.status === 'started' && stateOf(event.sessionId) !== 'finished') || (event.status === 'queued' && !!event.itemId && queued.some((i) => i.id === event.itemId)),
    [stateOf, queued],
  );
  return { stateOf, busy };
}
