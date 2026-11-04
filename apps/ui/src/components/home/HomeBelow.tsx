import { CalendarClock, ListEnd, Zap } from 'lucide-react';
import { useMemo, useRef } from 'react';
import type { ProjectInfo } from '@seshboard/protocol/client';
import { useSchedules } from '../../state/schedulesStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { useTriggers } from '../../state/triggersStore.ts';
import { openUpcoming } from '../../state/upcomingStore.ts';
import { useQueue } from '../../state/useQueue.ts';
import { moveInGrid, PROJECT_GRID, ProjectListFooter, ProjectRow } from '../newSession/ProjectRow.tsx';
import { COLUMN_BREAKPOINTS, quickCount } from '../newSession/projectTiles.ts';
import { ProjectIcon } from '../ProjectIcon.tsx';
import type { QuickProject } from '../quickStart/quickStartModel.ts';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { useColumns } from '../ui/useColumns.ts';
import { startInProject } from './HomeStartBox.tsx';
import { upNext } from './homeModel.ts';

/**
 * Start in a project: New session's rows, in its order and with its ⌘ keys, three columns where there is room
 * (`PROJECT_GRID`, a container query on this section). As many as New session shows, then "All N projects…".
 */
export function StartInProject({ projects, store }: { projects: readonly QuickProject[]; store: Map<string, ProjectInfo> }) {
  const ref = useRef<HTMLElement>(null);
  const columns = useColumns(ref, COLUMN_BREAKPOINTS);
  const shown = projects.slice(0, quickCount(columns));
  if (projects.length === 0) return null;
  return (
    <section ref={ref} aria-labelledby="home-start-in" className="@container grid min-w-0 gap-2.5" data-home-projects>
      <SectionHeader as="h2" headingId="home-start-in">
        Start in a project
      </SectionHeader>
      <ul className={PROJECT_GRID} aria-label="Your projects" onKeyDown={(event) => moveInGrid(event, columns)} data-project-columns={columns}>
        {shown.map((project, index) => (
          <li key={project.root} className="grid min-w-0">
            <ProjectRow
              icon={<ProjectIcon project={store.get(project.root)} root={project.root} size={24} />}
              name={project.name}
              tone={project.tone}
              label={project.label}
              branch={project.branch}
              shortcut={index < 9 ? index + 1 : undefined}
              selected={false}
              onClick={() => startInProject(project.root)}
              aria-label={`New session in ${project.name}, ${project.label}`}
              data-home-project={project.root}
              data-home-project-name={project.name}
            />
          </li>
        ))}
      </ul>
      <ProjectListFooter total={projects.length} shown={shown.length} onAll={projects.length > shown.length ? () => useSessions.getState().setView('projects') : undefined} />
    </section>
  );
}

const UP_NEXT_ICON = { queue: ListEnd, schedule: CalendarClock, trigger: Zap } as const;

/** Up next: the one thing Upcoming has next (`upNext`), with when; a click opens Upcoming on it. */
export function UpNext({ now, nameOf }: { now: number; nameOf(root: string): string }) {
  const queue = useQueue();
  const schedules = useSchedules((s) => s.schedules);
  const triggers = useTriggers((s) => s.triggers);
  const events = useTriggers((s) => s.events);
  const triggerRoots = useMemo(() => new Map(triggers.filter((t) => !t.paused).map((t) => [t.id, t.projectRoot])), [triggers]);
  const item = useMemo(() => upNext({ queue: queue.entries, schedules, events, triggerRoots, now }), [queue.entries, schedules, events, triggerRoots, now]);
  const Icon = item ? UP_NEXT_ICON[item.kind] : CalendarClock;
  return (
    <section aria-labelledby="home-up-next" className="grid min-w-0 content-start gap-2.5" data-home-up-next>
      <SectionHeader as="h2" headingId="home-up-next">
        Up next
      </SectionHeader>
      {item ? (
        <button
          type="button"
          onClick={() => openUpcoming(item.kind === 'schedule' ? { kind: 'schedules', scheduleId: item.id } : { kind: item.kind === 'queue' ? 'queue' : 'triggers' })}
          className="grid min-w-0 gap-1 rounded-xl bg-text/6 px-3.5 py-3 text-left hover:bg-text/10"
          data-home-up-next-item={item.kind}
        >
          <span className="flex min-w-0 items-center gap-2 text-ui text-text">
            <Icon size={13} className="shrink-0 text-muted" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-semibold">{item.title}</span>
            <span className="shrink-0 text-meta text-muted tabular-nums">{item.when}</span>
          </span>
          <span className="truncate text-meta text-faint">{nameOf(item.cwd)}</span>
        </button>
      ) : (
        <div className="grid gap-1 rounded-xl bg-text/6 px-3.5 py-3">
          <span className="flex items-center gap-2 text-ui text-text">
            <CalendarClock size={13} className="shrink-0 text-muted" aria-hidden />
            Nothing planned.
          </span>
          <span className="text-meta text-faint">Schedules, Later and triggers show here.</span>
        </div>
      )}
    </section>
  );
}
