import { useEffect } from 'react';
import { create } from 'zustand';
import type { OrchestratorInfo, StartedChild } from '@seshboard/protocol/client';
import { useEngineConnection } from '../engine/useEngine.ts';

// The orchestrators (docs/orchestrator.md). The engine keeps which sessions are orchestrators and what each started;
// every window shows the same. The rules the views share are in `orchestrator.ts`.

interface OrchestratorState {
  orchestrators: OrchestratorInfo[];
  /** Sessions other sessions started (start_session): they nest under those the same way. */
  started: StartedChild[];
  set(orchestrators: OrchestratorInfo[], started?: StartedChild[]): void;
}

const NONE: StartedChild[] = [];

export const useOrchestrators = create<OrchestratorState>()((set) => ({
  orchestrators: [],
  started: NONE,
  set: (orchestrators, started) => set({ orchestrators, started: started ?? NONE }),
}));

/** Loads the orchestrators once per connection and follows changes from every window. */
export function useOrchestratorSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client) return;
    const off = client.on('orchestrator.changed', ({ orchestrators, started }) => useOrchestrators.getState().set(orchestrators, started));
    void client.call('orchestrator.list', {}).then(({ orchestrators, started }) => useOrchestrators.getState().set(orchestrators, started), () => {});
    return off;
  }, [client]);
}
