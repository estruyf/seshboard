import { useEffect, useState } from 'react';
import type { PlanHistory, UsageBreakdown, UsageGroup, UsagePeriod } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** How often an open view asks again, to pick up new turns between the engine's notices. */
const POLL_MS = 60_000;

/**
 * A profile's token breakdown for a period, asked again whenever the engine reads new tokens for it (often during
 * the first read of the transcripts) and every minute. Null until the first answer.
 */
export function useBreakdown(profileId: string | null, period: UsagePeriod, groupBy: UsageGroup, model: string | null = null): UsageBreakdown | null {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [data, setData] = useState<UsageBreakdown | null>(null);
  useEffect(() => {
    if (!client || !profileId) return;
    let alive = true;
    const load = () =>
      void client.call('usage.breakdown', { profileId, period, groupBy, model, timeZone: timeZone() }).then(
        (result) => alive && setData(result),
        () => {},
      );
    load();
    const off = client.on('usage.tokens', ({ profileIds }) => profileIds.includes(profileId) && load());
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      off();
      clearInterval(timer);
    };
  }, [client, profileId, period, groupBy, model]);
  // A different question starts empty rather than showing the last answer under new labels.
  useEffect(() => setData(null), [profileId, period, groupBy, model]);
  return data;
}

/** A profile's plan % history for a period, asked again when its usage changes. */
export function usePlanHistory(profileId: string | null, period: UsagePeriod): PlanHistory | null {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [data, setData] = useState<PlanHistory | null>(null);
  useEffect(() => {
    if (!client || !profileId) return;
    let alive = true;
    const load = () =>
      void client.call('usage.history', { profileId, period, timeZone: timeZone() }).then(
        (result) => alive && setData(result),
        () => {},
      );
    load();
    const off = client.on('usage.changed', (event) => event.profileId === profileId && load());
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      off();
      clearInterval(timer);
    };
  }, [client, profileId, period]);
  return data;
}
