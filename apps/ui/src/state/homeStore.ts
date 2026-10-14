import { useEffect } from 'react';
import { create } from 'zustand';
import { useEngineConnection } from '../engine/useEngine.ts';

/** The engine's home folder, where the window's terminal starts: null until the engine has told us. */
export const useHome = create<{ home: string | null }>()(() => ({ home: null }));

/** The home folder, asked of the engine once. Guessing it from session folders fails when it is not under Users. */
export function useHomeFolder(): string | null {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const home = useHome((s) => s.home);
  useEffect(() => {
    if (!client || home !== null) return;
    let cancelled = false;
    client.call('system.info', {}).then(
      (info) => !cancelled && useHome.setState({ home: info.paths.home }),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [client, home]);
  return home;
}
