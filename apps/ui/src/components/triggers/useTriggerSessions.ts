import { useCallback } from 'react';
import { runIsBusy, type TriggerEvent } from '@switchboard/protocol/client';
import { useHosts } from '../../state/hostsStore.ts';
import { useLater } from '../../state/laterStore.ts';
import { usePipelines } from '../../state/pipelinesStore.ts';
import { runEventState, type EventSessionState } from '../../state/triggers.ts';

/**
 * Where the work on each started event is, from this window's hosts (a session) or runs (a pipeline run): working,
 * waiting for you, or finished. And which events hold a slot under their trigger's `maxAtOnce`: a busy session, a
 * run that goes on (once, whatever its steps do), or a queued item still on the queue.
 */
export function useTriggerSessions() {
  const hosts = useHosts((s) => s.hosts);
  const runs = usePipelines((s) => s.runs);
  const queued = useLater((s) => s.items);
  const stateOf = useCallback(
    (event: Pick<TriggerEvent, 'sessionId' | 'runId'>): EventSessionState => {
      if (event.runId) return runEventState(runs.get(event.runId)?.run.status ?? null);
      const host = event.sessionId ? hosts.get(event.sessionId) : undefined;
      if (host?.state === 'needs-you') return 'needs-you';
      if (host?.state === 'running' || host?.state === 'starting') return 'working';
      return 'finished';
    },
    [hosts, runs],
  );
  const busy = useCallback(
    (event: TriggerEvent) => {
      if (event.status === 'queued') return !!event.itemId && queued.some((i) => i.id === event.itemId);
      if (event.status !== 'started') return false;
      if (event.runId) {
        const state = runs.get(event.runId);
        return !!state && runIsBusy(state.run);
      }
      return stateOf(event) !== 'finished';
    },
    [stateOf, runs, queued],
  );
  return { stateOf, busy };
}
