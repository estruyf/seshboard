import { useMemo } from 'react';
import { useSchedules } from './schedulesStore.ts';
import { nextScheduledRun, upcomingCount, upcomingHint, upcomingNavLabel, type UpcomingHint } from './upcoming.ts';
import { useQueue } from './useQueue.ts';
import { useSessions } from './sessionsStore.ts';

/** What the Upcoming entry (sidebar row, rail button) shows: the count, its hint, and its label for screen readers. */
export interface UpcomingSummary {
  count: number;
  ready: number;
  hint: UpcomingHint | null;
  label: string;
}

/**
 * Upcoming's count and hint across every project, from the queue, the schedules and the reminders (Remind me later).
 * `now` moves the next run on.
 */
export function useUpcomingSummary(now: number): UpcomingSummary {
  const queue = useQueue();
  const schedules = useSchedules((s) => s.schedules);
  // The snoozed sessions' times, joined: a string only changes when a reminder does.
  const reminders = useSessions((s) => [...s.sessions.values()].flatMap((x) => (x.remindAt != null && x.remindedAt == null ? [x.remindAt] : [])).sort((a, b) => a - b).join(','));
  return useMemo(() => {
    const times = reminders ? reminders.split(',').map(Number) : [];
    const count = upcomingCount(queue.entries.length, schedules, now) + times.length;
    const scheduled = nextScheduledRun(schedules, now);
    const nextRun = [scheduled, times[0] ?? null].filter((t): t is number => t !== null).reduce<number | null>((min, t) => (min === null || t < min ? t : min), null);
    const input = { ready: queue.readyCount, nextRun, count, now };
    return { count, ready: queue.readyCount, hint: upcomingHint(input), label: upcomingNavLabel(input) };
  }, [queue.entries.length, queue.readyCount, schedules, now, reminders]);
}
