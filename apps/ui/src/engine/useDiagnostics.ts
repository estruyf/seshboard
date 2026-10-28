import { useEffect, useState } from 'react';
import type { LogEntry, SystemInfo } from '@seshboard/protocol/client';
import { useEngineConnection } from './useEngine.ts';
import { measurePing } from './useReadyReport.ts';

export interface Diagnostics {
  info: SystemInfo | null;
  /** Median round trip of a burst of pings, in ms. */
  pingMs: number | null;
  logs: LogEntry[];
  error: string | null;
}

const MAX_LOGS = 200;

/** Loads engine diagnostics for the current connection and re-runs after every reconnect. */
export function useDiagnostics(): Diagnostics & { refreshPing: () => void } {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [state, setState] = useState<Diagnostics>({ info: null, pingMs: null, logs: [], error: null });
  const [pingRun, setPingRun] = useState(0);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    const off = client.on('engine.log', (entry) =>
      setState((s) => ({ ...s, logs: [...s.logs, entry].slice(-MAX_LOGS) })),
    );
    Promise.all([client.call('system.info', {}), measurePing(client)])
      .then(([info, pingMs]) => !cancelled && setState((s) => ({ ...s, info, pingMs, error: null })))
      .catch((error: unknown) => {
        if (!cancelled) setState((s) => ({ ...s, error: error instanceof Error ? error.message : String(error) }));
      });
    return () => {
      cancelled = true;
      off();
    };
  }, [client]);

  useEffect(() => {
    if (!client || pingRun === 0) return;
    let cancelled = false;
    void measurePing(client).then((pingMs) => !cancelled && setState((s) => ({ ...s, pingMs })));
    return () => {
      cancelled = true;
    };
  }, [client, pingRun]);

  return { ...state, refreshPing: () => setPingRun((n) => n + 1) };
}
