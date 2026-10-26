import { useEffect } from 'react';
import { create } from 'zustand';
import type { LimitsState } from '@seshboard/protocol/client';
import { useEngineConnection } from '../engine/useEngine.ts';

/**
 * The Claude profiles at a plan usage limit, the sessions armed to resume when it resets, and those whose resume gave
 * up, as the engine keeps them: also for sessions that aren't running.
 */
interface LimitsStore {
  state: LimitsState;
  set(state: LimitsState): void;
}

export const EMPTY_LIMITS: LimitsState = { limits: [], resumes: [], gaveUp: [] };

export const useLimits = create<LimitsStore>()((set) => ({
  state: EMPTY_LIMITS,
  set: (state) => set({ state }),
}));

/** Loads the limits once per connection and follows changes from every window. */
export function useLimitsSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client) return;
    const off = client.on('limits.changed', (state) => useLimits.getState().set(state));
    void client.call('limits.state', {}).then((state) => useLimits.getState().set(state), () => {});
    return off;
  }, [client]);
}
