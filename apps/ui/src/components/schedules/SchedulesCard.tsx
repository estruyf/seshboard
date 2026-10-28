import { Info, Plus, Repeat } from 'lucide-react';
import { currentPlatform } from '../../lib/platform.ts';
import { openToSchedule, useSchedules } from '../../state/schedulesStore.ts';
import { listedSchedules } from '../../state/upcoming.ts';
import { Button } from '../ui/Button.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { useScheduleMenu } from './scheduleMenu.tsx';
import { ScheduleRow } from './ScheduleRow.tsx';
import { SeeAllInUpcoming } from '../upcoming/SeeAllInUpcoming.tsx';

/** How many schedules Home shows; See all in Upcoming has the rest. */
const HOME_ROWS = 3;

/**
 * When schedules run, for the platform: the Mac app keeps running with its windows closed; on Windows the app quits
 * with its last window (`window-all-closed` in main), so a window must be open.
 */
export const schedulesRunLine = (platform = currentPlatform()) =>
  platform === 'darwin' ? 'Schedules run while Seshboard is running, also with its windows closed.' : 'Schedules run while a Seshboard window is open.';


/**
 * Home's Schedules card, under the queue: the first schedules (Upcoming has all of them) with their rule, last and next
 * run, Run now and ⋯, and a line on when schedules run on this platform. One-time schedules that have run are left out
 * (Upcoming's History has their run). Nothing shows without schedules.
 */
export function SchedulesCard({ now }: { now: number }) {
  const schedules = listedSchedules(useSchedules((s) => s.schedules), now);
  const menus = useScheduleMenu();
  if (schedules.length === 0) return null;
  return (
    <div className="grid gap-2" data-schedules-home>
      <section aria-labelledby="home-schedules" className="grid gap-1 rounded-xl border border-border bg-card p-3" data-schedules-card>
        <div className="flex min-w-0 items-center gap-3 px-1 pb-1">
          <SectionHeader as="h2" headingId="home-schedules" count={schedules.length} className="min-w-0 flex-1">
            <Repeat size={13} className="shrink-0" aria-hidden />
            Schedules
          </SectionHeader>
          <SeeAllInUpcoming kind="schedules" />
          <Button icon={<Plus size={13} aria-hidden />} onClick={() => openToSchedule()} className="shrink-0" data-schedules-add>
            Schedule a session
          </Button>
        </div>
        <ul className="grid gap-0.5">
          {schedules.slice(0, HOME_ROWS).map((schedule) => (
            <ScheduleRow key={schedule.id} schedule={schedule} now={now} menus={menus} />
          ))}
        </ul>
        {menus.overlay}
      </section>
      <p className="flex items-center gap-1.5 px-1 text-meta text-muted" data-schedules-platform>
        <Info size={12} className="shrink-0" aria-hidden />
        {schedulesRunLine()}
      </p>
    </div>
  );
}

/** A project's Sessions tab: its schedules, with the same rows as Home's. */
export function ProjectSchedules({ root, now }: { root: string; now: number }) {
  const schedules = listedSchedules(useSchedules((s) => s.schedules), now).filter((schedule) => schedule.draft.cwd === root);
  const menus = useScheduleMenu();
  if (schedules.length === 0) return null;
  return (
    <section aria-labelledby="project-schedules" className="grid gap-1" data-project-schedules>
      <div className="flex items-center gap-3 px-3">
        <SectionHeader as="h2" headingId="project-schedules" count={schedules.length} className="min-w-0 flex-1">
          Schedules
        </SectionHeader>
        <SeeAllInUpcoming kind="schedules" label="All projects in Upcoming" />
      </div>
      <ul className="grid gap-0.5">
        {schedules.map((schedule) => (
          <ScheduleRow key={schedule.id} schedule={schedule} now={now} menus={menus} project={false} />
        ))}
      </ul>
      {menus.overlay}
    </section>
  );
}
