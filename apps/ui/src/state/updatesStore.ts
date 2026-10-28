import { useEffect } from 'react';
import { create } from 'zustand';
import type { UpdateState } from '@seshboard/protocol/bridge';

interface UpdatesState {
  /** Null in a plain browser (no preload). */
  state: UpdateState | null;
  replace(state: UpdateState): void;
}

export const useUpdates = create<UpdatesState>()((set) => ({
  // The preload reads it synchronously, so the first render already has it.
  state: window.seshboard?.updateState ?? null,
  replace: (state) => set({ state }),
}));

/** Follows the updater in main. */
export function useUpdatesSync(): void {
  useEffect(() => window.seshboard?.onUpdateState((state) => useUpdates.getState().replace(state)), []);
}
