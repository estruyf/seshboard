import { ViewHeader } from '../ViewHeader.tsx';
import { useMemo } from 'react';
import { basename } from '../../lib/format.ts';
import { startPass } from '../../state/catchUpPass.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { addedProjects } from '../../state/projectList.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { toRows, useSessions } from '../../state/sessionsStore.ts';
import { inScope } from '../../state/sidebarRows.ts';
import { YesterdayCard } from '../activity/YesterdayCard.tsx';
import { useMinute } from '../focus/useMinute.ts';
import { useQuickProjects } from '../quickStart/useQuickProjects.ts';
import { Button } from '../ui/Button.tsx';
import { SchedulesCard } from '../schedules/SchedulesCard.tsx';
import { StartInProject, UpNext } from './HomeBelow.tsx';
import { NeedsLane, ReviewLane, WorkingLane } from './HomeLanes.tsx';
import { HOME_WIDTH } from '../newSession/newSessionLayout.ts';
import { greeting, homeSessions, homeSummary, reviewSessions } from './homeModel.ts';
import { HomeStartBox } from './HomeStartBox.tsx';
import { HomeUsage } from './HomeUsage.tsx';
import { QueueCard } from './QueueCard.tsx';
import { UnsentCard } from './UnsentCard.tsx';

function Onboarding() {
  return (
    <div className="grid max-w-sm justify-items-center gap-1.5 text-center" data-onboarding>
      <h1 className="text-title font-semibold">Add your first project</h1>
      <p className="text-ui text-muted">Projects are the folders you start Claude Code sessions in. Pick from the folders you have used Claude Code in, or choose any folder.</p>
      <Button variant="primary" size="lg" onClick={() => useProjects.getState().showAdd(true)} className="mt-2" data-onboarding-add>
        Add a project
      </Button>
    </div>
  );
}

/**
 * What the window shows when no session is open, using its width (as far as New session does, centred): a start box, three
 * lanes (Needs you, Working, To review), then your projects with Up next, and usage on the right. A container, so it
 * follows the view: three lanes from 1200px, two from 760px (an empty Needs you left out, the line under the greeting
 * says it), one below; usage goes under the rest below 1100px. Without projects it asks you to add the first one.
 */
export function HomeView() {
  const scope = usePreferences((s) => s.prefs.sessionScope);
  const archiveAfterDays = usePreferences((s) => s.prefs.archiveAfterDays);
  const sessions = useSessions((s) => s.sessions);
  const live = useSessions((s) => s.live);
  const hosts = useHosts((s) => s.hosts);
  const projects = useProjects((s) => s.projects);
  const loaded = useProjects((s) => s.loaded);
  const quick = useQuickProjects('');
  const now = useMinute();

  const rows = useMemo(() => toRows(sessions, live, hosts).filter((row) => inScope(row, scope)), [sessions, live, hosts, scope]);
  const { needs, working } = useMemo(() => homeSessions(rows), [rows]);
  const review = useMemo(() => reviewSessions(rows, { now, archiveAfterDays }), [rows, now, archiveAfterDays]);
  const nameOf = (root: string) => projects.get(root)?.name ?? basename(root);
  const ctx = { now, projects, nameOf };

  if (loaded && addedProjects(projects).length === 0) {
    return (
      <div className="flex h-full flex-col">
        <ViewHeader title="Home" />
        {/* Yesterday, queued prompts and schedules (in folders that aren't projects) still show, under the way to add the first project. */}
        <div className="@container flex flex-1 flex-col items-center justify-center gap-8 px-6 pb-16">
          <Onboarding />
          <div className="grid w-full max-w-3xl gap-7">
            <YesterdayCard now={now} />
            <QueueCard now={now} />
            <SchedulesCard now={now} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewHeader title="Home" />
      {/* The container: the breakpoints follow the view (beside the sidebar and panels), not the window. */}
      <div className="@container flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className={`mx-auto grid w-full ${HOME_WIDTH} grid-cols-[minmax(0,1fr)] gap-7 pt-2 pb-12`} data-home>
          <header className="min-w-0">
            {/* The greeting, a little larger than text-title; the header names the view. */}
            <h2 className="text-hero leading-tight font-semibold">{greeting(now)}</h2>
            <p className="mt-1 text-ui text-muted" data-home-summary>
              {homeSummary(needs.length, working.length, review.total)}
            </p>
          </header>

          <HomeStartBox projects={quick} />

          <div className="grid grid-cols-1 items-start gap-5 @min-[760px]:grid-cols-2 @min-[1200px]:grid-cols-[0.8fr_1.1fr_1.1fr]" data-home-lanes>
            <NeedsLane rows={needs} ctx={ctx} />
            <WorkingLane rows={working} ctx={ctx} />
            <ReviewLane rows={review.shown} total={review.total} ctx={ctx} onAll={() => startPass()} />
          </div>

          <div className="grid grid-cols-1 items-start gap-7 @min-[1100px]:grid-cols-[2fr_1fr]" data-home-below>
            <div className="grid min-w-0 content-start gap-7">
              <StartInProject projects={quick} store={projects} />
              <div className="grid grid-cols-1 items-start gap-5 @min-[760px]:grid-cols-2">
                <YesterdayCard now={now} />
                <UpNext now={now} nameOf={nameOf} />
              </div>
              <UnsentCard now={now} />
              <QueueCard now={now} />
              <SchedulesCard now={now} />
            </div>
            <HomeUsage rows={rows} now={now} />
          </div>
        </div>
      </div>
    </div>
  );
}
