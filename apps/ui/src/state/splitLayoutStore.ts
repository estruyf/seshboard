import { useEffect } from 'react';
import { create } from 'zustand';
import { useEngineConnection } from '../engine/useEngine.ts';
import { DEFAULT_ORIENTATION, otherOrientation, parseOrientation, type SplitOrientation } from './splitLayout.ts';
import { toast } from './toastStore.ts';

const SPLIT_KEY = 'ui.splitLayout';

interface SplitLayoutStore {
  /** The orientation people chose; kept across restarts. How the panes show can differ (`tooShort`). */
  orientation: SplitOrientation;
  /** The saved choice has been read: until then nothing is written back. */
  loaded: boolean;
  /** The panes' area is too short to stack them, so they show side by side for now (set by the panes' view). */
  tooShort: boolean;
  /** Picks an orientation; says so when the window is too short to show it. */
  choose(orientation: SplitOrientation): void;
  /** The other orientation (⌘⇧O). */
  toggle(): void;
  setTooShort(tooShort: boolean): void;
  load(orientation: SplitOrientation): void;
}

export const useSplitLayout = create<SplitLayoutStore>()((set, get) => ({
  orientation: DEFAULT_ORIENTATION,
  loaded: false,
  tooShort: false,
  choose: (orientation) => {
    set({ orientation });
    if (orientation === 'stacked' && get().tooShort) toast('The window is too short to stack the panes. They stack when it is taller.');
  },
  toggle: () => get().choose(otherOrientation(get().orientation)),
  setTooShort: (tooShort) => set((s) => (s.tooShort === tooShort ? {} : { tooShort })),
  load: (orientation) => set((s) => (s.loaded ? {} : { orientation, loaded: true })),
}));

/** Restores the split view's orientation from the engine's app state and saves it when it changes. */
export function useSplitLayoutSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const orientation = useSplitLayout((s) => s.orientation);
  const loaded = useSplitLayout((s) => s.loaded);

  useEffect(() => {
    if (!client) return;
    void client.call('appState.get', { key: SPLIT_KEY }).then(
      ({ value }) => useSplitLayout.getState().load(parseOrientation(value)),
      () => useSplitLayout.getState().load(DEFAULT_ORIENTATION),
    );
  }, [client]);

  useEffect(() => {
    if (client && loaded) void client.call('appState.set', { key: SPLIT_KEY, value: { orientation } });
  }, [client, loaded, orientation]);
}
