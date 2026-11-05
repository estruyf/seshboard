import { useMemo } from 'react';
import { useSessions } from './sessionsStore.ts';

/** The first moment of a moment's local day. */
const startOfDay = (at: number) => new Date(at).setHours(0, 0, 0, 0);

/** The sessions with activity today, for Activity's row in the sidebar. From the session list, so it costs no query. */
export function useSessionsToday(now: number): number {
  const sessions = useSessions((s) => s.sessions);
  const start = startOfDay(now);
  return useMemo(() => {
    let count = 0;
    for (const session of sessions.values()) if (session.updatedAt >= start) count++;
    return count;
  }, [sessions, start]);
}
