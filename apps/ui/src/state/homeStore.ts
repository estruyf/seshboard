import { useEffect } from 'react';
import { create } from 'zustand';
import type { EngineClient } from '../engine/connection.ts';
import { useEngineConnection } from '../engine/useEngine.ts';

/** The engine's home folder (`~` in paths, and where the window's terminal starts): null until the engine has told us. */
export const useHome = create<{ home: string | null }>()(() => ({ home: null }));

/** Each connection is asked once, however many views want the home folder at the same time. */
const asked = new WeakSet<EngineClient>();

/**
 * The home folder, from the engine. Guessing it from known folders fails when it is not under Users (some Linux and
 * managed setups, a Windows profile on another drive).
 */
export function useHomeFolder(): string | null {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const home = useHome((s) => s.home);
  useEffect(() => {
    if (!client || home !== null || asked.has(client)) return;
    asked.add(client);
    client.call('system.info', {}).then(
      (info) => useHome.setState({ home: info.paths.home }),
      // Asked again by the next view that needs it.
      () => asked.delete(client),
    );
  }, [client, home]);
  return home;
}
