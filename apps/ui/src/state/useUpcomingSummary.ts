import { useMemo } from 'react';
import { useSchedules } from './schedulesStore.ts';
import { nextScheduledRun, upcomingCount, upcomingHint, upcomingNavLabel, type UpcomingHint } from './upcoming.ts';
import { useQueue } from './useQueue.ts';

/** What the Upcoming entry (sidebar row, rail button) shows: the count, its hint, and its label for screen readers. */
export interface UpcomingSummary {
  count: number;
  ready: number;
  hint: UpcomingHint | null;
  label: string;
}

/** Upcoming's count and hint across every project, from the queue and the schedules. `now` moves the next run on. */
export function useUpcomingSummary(now: number): UpcomingSummary {
  const queue = useQueue();
  const schedules = useSchedules((s) => s.schedules);
  return useMemo(() => {
    const count = upcomingCount(queue.entries.length, schedules, now);
    const nextRun = nextScheduledRun(schedules, now);
    const input = { ready: queue.readyCount, nextRun, count, now };
    return { count, ready: queue.readyCount, hint: upcomingHint(input), label: upcomingNavLabel(input) };
  }, [queue.entries.length, queue.readyCount, schedules, now]);
}
