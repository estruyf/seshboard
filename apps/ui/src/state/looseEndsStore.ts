import { useEffect } from 'react';
import { create } from 'zustand';
import type { GitLooseEnd } from '@seshboard/protocol/client';
import { useEngineConnection } from '../engine/useEngine.ts';

const NONE: readonly GitLooseEnd[] = [];

/** What each session (or run row) left behind in git and on GitHub, as the engine last found it (`looseEndsWatcher.ts`). */
export const useLooseEnds = create<{ byOwner: ReadonlyMap<string, readonly GitLooseEnd[]>; reset(map: Record<string, readonly GitLooseEnd[]>): void }>()((set) => ({
  byOwner: new Map(),
  reset: (map) => set({ byOwner: new Map(Object.entries(map)) }),
}));

/** One row's loose ends from git and GitHub (none for another computer's session). */
export const useRowLooseEnds = (id: string): readonly GitLooseEnd[] => useLooseEnds((s) => s.byOwner.get(id) ?? NONE);

/** Keeps the loose ends up to date: the list on connect, then every change. */
export function useLooseEndsSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client) return;
    const off = client.on('sessions.looseEnds', ({ looseEnds }) => useLooseEnds.getState().reset(looseEnds));
    void client.call('sessions.listLooseEnds', {}).then(({ looseEnds }) => useLooseEnds.getState().reset(looseEnds), () => {});
    return off;
  }, [client]);
}
