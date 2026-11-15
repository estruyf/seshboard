import { useEffect } from 'react';
import { create } from 'zustand';
import type { OrchestratorInfo } from '@seshboard/protocol/client';
import { useEngineConnection } from '../engine/useEngine.ts';

// The orchestrators (docs/orchestrator.md). The engine keeps which sessions are orchestrators and what each started;
// every window shows the same. The rules the views share are in `orchestrator.ts`.

interface OrchestratorState {
  orchestrators: OrchestratorInfo[];
  set(orchestrators: OrchestratorInfo[]): void;
}

export const useOrchestrators = create<OrchestratorState>()((set) => ({
  orchestrators: [],
  set: (orchestrators) => set({ orchestrators }),
}));

/** Loads the orchestrators once per connection and follows changes from every window. */
export function useOrchestratorSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client) return;
    const off = client.on('orchestrator.changed', ({ orchestrators }) => useOrchestrators.getState().set(orchestrators));
    void client.call('orchestrator.list', {}).then(({ orchestrators }) => useOrchestrators.getState().set(orchestrators), () => {});
    return off;
  }, [client]);
}
