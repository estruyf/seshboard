import { useEffect } from 'react';
import { useEngineConnection } from '../engine/useEngine.ts';
import { useCatchUp } from './catchUpStore.ts';

/** Mirrors the engine's catch-up cards: every session's on connect, then each one as it is made or cleared. */
export function useCatchUpSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client) return;
    const off = client.on('catchup.changed', ({ sessionId, catchUp }) => useCatchUp.getState().set(sessionId, catchUp));
    void client.call('catchup.list', {}).then(({ catchUps }) => useCatchUp.getState().reset(catchUps), () => {});
    return off;
  }, [client]);
}
