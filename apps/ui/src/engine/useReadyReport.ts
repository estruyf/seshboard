import { useEffect } from 'react';
import { firstSnapshot } from '../state/useSessionsSync.ts';
import type { EngineClient } from './connection.ts';
import { useEngineConnection } from './useEngine.ts';

/** Ready is reported once per connection, even though StrictMode runs effects twice in dev. */
let lastReportedGeneration = 0;

export async function measurePing(client: EngineClient, samples = 20): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    await client.call('system.ping', { sentAt: Date.now() });
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return Math.round(times[Math.floor(times.length / 2)]! * 100) / 100;
}

/** Tells main when this window can talk to the engine (startup timing and the smoke test). */
export function useReadyReport(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const generation = connection.status === 'connected' ? connection.generation : 0;

  useEffect(() => {
    if (!client || generation <= lastReportedGeneration) return;
    let cancelled = false;
    let connectedAt = 0;
    // system.info waits on the login shell and `claude --version`; the ping shows when the engine itself is usable.
    const ping = measurePing(client).then((pingMs) => ((connectedAt = Date.now()), pingMs));
    // The count comes from the list the sessions sync loads anyway, not a second full list.
    void Promise.all([client.call('system.info', {}), firstSnapshot(client), ping]).then(([info, sessions, pingMs]) => {
      if (cancelled || generation <= lastReportedGeneration) return;
      lastReportedGeneration = generation;
      window.seshboard?.reportReady({
        connectedAt,
        engineVersion: info.engineVersion,
        claudeVersion: info.claude?.version ?? null,
        pingMs,
        sessionCount: sessions.sessions.length,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [client, generation]);
}
