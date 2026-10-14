import { useSyncExternalStore } from 'react';
import { engineConnection, type ConnectionState } from './connection.ts';

export function useEngineConnection(): ConnectionState {
  return useSyncExternalStore(engineConnection.subscribe, engineConnection.getSnapshot);
}

/** The engine is connected but stopped answering (it hangs); false again on its next answer or a reconnect. */
export function useEngineStalled(): boolean {
  return useSyncExternalStore(engineConnection.subscribe, engineConnection.isStalled);
}
