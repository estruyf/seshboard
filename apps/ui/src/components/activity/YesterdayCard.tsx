import { useMemo } from 'react';
import { openActivity } from '../../state/activityStore.ts';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { addDays, countsByDay, dayOf, formatWorked, lastActiveDay, lastDayLabel, plural, statsOf, summaryPlain } from './activityModel.ts';
import { useActivityRange, useDaySummary } from './useActivity.ts';

/**
 * Home's Yesterday: the last day you worked (Friday's on a Monday), its sessions and time and the day in short, with a
 * way to the whole day. Nothing shows without one in the last week.
 */
export function YesterdayCard({ now }: { now: number }) {
  const today = dayOf(now);
  const { rows, loading, settled } = useActivityRange(addDays(today, -7), today, { git: false });
  const counts = useMemo(() => countsByDay(rows), [rows]);
  const day = loading ? null : lastActiveDay(today, counts);
  const ofDay = useMemo(() => rows.filter((row) => row.day === day), [rows, day]);
  const { summary, writing } = useDaySummary(day, ofDay, settled);
  const stats = useMemo(() => statsOf(ofDay), [ofDay]);
  if (!day) return null;
  const label = lastDayLabel(day, today);
  return (
    <section aria-labelledby="home-yesterday" className="grid min-w-0 content-start gap-2.5" data-home-yesterday>
      <SectionHeader as="h2" headingId="home-yesterday">
        {label}
      </SectionHeader>
      <div className="grid gap-1 rounded-xl bg-text/6 px-3.5 py-3">
        <span className="flex min-w-0 items-center gap-2 text-ui">
          <span className="min-w-0 flex-1 truncate font-semibold" data-home-yesterday-stats>
            {plural(stats.sessions, 'session')} · {formatWorked(stats.activeMs)}
          </span>
          <button type="button" className="shrink-0 text-link hover:underline" onClick={() => openActivity(day)} data-home-yesterday-open>
            See the day
          </button>
        </span>
        {summary ? (
          <p className="line-clamp-3 text-ui leading-normal text-muted" data-home-yesterday-summary>
            {summaryPlain(summary.text)}
          </p>
        ) : (
          writing && (
            <p className="text-meta text-faint" aria-busy>
              Writing the day in short…
            </p>
          )
        )}
      </div>
    </section>
  );
}
