import { CalendarClock, Check, ChevronDown, GripVertical, History, Info, ListEnd, MoreHorizontal, Pause, Play, Repeat, SkipForward } from 'lucide-react';
import { describe, formatPast, pastRuns, SKIPPED_BY_YOU, upcomingRuns, type PastRun, type Schedule, type ScheduleLastRun, type UpcomingRun } from '@seshboard/protocol/client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isContextMenuKey } from '../../lib/contextMenu.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { startQueued, useLater } from '../../state/laterStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { projectOf, queueRowLabel, type QueueEntry } from '../../state/queue.ts';
import { openToSchedule, setSchedulePaused, skipRun, unskipRun, runScheduleNow, useSchedules } from '../../state/schedulesStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { dayGroups, HISTORY_DAYS, inProject, listedSchedules, projectCounts, runClock, runLabel, UPCOMING_DAYS, visibleCards, type UpcomingDay, type UpcomingKind } from '../../state/upcoming.ts';
import { useUpcoming } from '../../state/upcomingStore.ts';
import { useProjectName, useQueue } from '../../state/useQueue.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { QueueMark } from '../queue/QueueMark.tsx';
import { useQueueMenu } from '../queue/queueMenu.tsx';
import { useQueueDrag } from '../queue/useQueueDrag.ts';
import { runEntries, scheduleEntries } from '../schedules/scheduleMenu.tsx';
import { schedulesRunLine } from '../schedules/SchedulesCard.tsx';
import { SidebarToggle } from '../sidebar/SidebarToggle.tsx';
import { QUEUE_SURFACE } from '../sidebar/QueueRow.tsx';
import { Button } from '../ui/Button.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { Switch } from '../ui/Toggle.tsx';
import { useTriggers } from '../../state/triggersStore.ts';
import { TriggersCard } from './UpcomingTriggers.tsx';

const CARD = 'grid content-start gap-1 rounded-xl border border-border bg-card p-3';

/** Add to queue: New session, to write the prompt (a project picked in the filter is its folder). */
const addToQueue = (root: string | null) => {
  if (root) useProjects.getState().startIn(root);
  useSessions.getState().openNewSession();
};

/** The time it is, again every 30 seconds: runs move from still to come to past. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** A menu at a point, with its entries, for the view's ⋯ buttons. */
type OpenMenu = { x: number; y: number; entries: MenuEntry[]; label: string } | null;

/**
 * Upcoming: everything queued and scheduled, across projects. The queue in order, the scheduled runs of the next
 * seven days by day, every schedule, and the runs of the last seven days (History). A segmented control shows all of it,
 * only the queue or only the schedules; a chip filters by project. Both are kept per window.
 */
export function UpcomingView() {
  const now = useNow();
  const filter = useUpcoming((s) => s.filter);
  const focus = useUpcoming((s) => s.focus);
  const queue = useQueue();
  const schedules = useSchedules((s) => s.schedules);
  const allTriggers = useTriggers((s) => s.triggers);
  const triggerEvents = useTriggers((s) => s.events);
  const projects = useProjects((s) => s.projects);
  const projectName = useProjectName();
  const [menu, setMenu] = useState<OpenMenu>(null);
  const chip = useRef<HTMLButtonElement>(null);

  const counts = useMemo(() => projectCounts(queue.entries.map((e) => e.item), listedSchedules(schedules, now), projectName, allTriggers), [queue.entries, schedules, projectName, now, allTriggers]);
  // A project picked earlier that has nothing left still shows in the chip, so the filter can be cleared.
  const project = filter.project;
  const entries = useMemo(() => queue.entries.filter((e) => inProject(e.item.cwd, project)), [queue.entries, project]);
  // Every schedule of the project counts for History; the lists leave out one-time ones that have run.
  const inFilter = useMemo(() => schedules.filter((s) => inProject(s.draft.cwd, project)), [schedules, project]);
  const shownSchedules = useMemo(() => listedSchedules(inFilter, now), [inFilter, now]);
  const runs = useMemo(() => upcomingRuns(shownSchedules, now, UPCOMING_DAYS), [shownSchedules, now]);
  const history = useMemo(() => pastRuns(inFilter, now, HISTORY_DAYS), [inFilter, now]);
  const byId = useMemo(() => new Map(schedules.map((s) => [s.id, s])), [schedules]);
  const shownTriggers = useMemo(() => allTriggers.filter((t) => inProject(t.projectRoot, project)), [allTriggers, project]);
  const cards = visibleCards(filter.kind);
  const nothing = queue.entries.length === 0 && listedSchedules(schedules, now).length === 0 && history.length === 0 && allTriggers.length === 0;

  const nameOf = (cwd: string) => projectName(projectOf(cwd));
  const openProjectMenu = () => {
    const box = chip.current!.getBoundingClientRect();
    const pick = (root: string | null) => () => useUpcoming.getState().setProject(root);
    setMenu({
      x: box.left,
      y: box.bottom + 4,
      label: 'Filter by project',
      entries: [
        { label: 'All projects', checked: project === null, data: { 'data-upcoming-project': 'all' }, onSelect: pick(null) },
        ...counts.map(
          (c): MenuEntry => ({
            label: projectName(c.root),
            icon: <ProjectIcon project={projects.get(c.root)} root={c.root} size={14} />,
            hint: `${c.queued} · ${c.schedules}`,
            checked: project === c.root,
            data: { 'data-upcoming-project': c.root },
            onSelect: pick(c.root),
          }),
        ),
        { note: 'Counts are queued · schedules.' },
      ],
    });
  };

  // A notification's click: the schedule's next run comes into view.
  useEffect(() => {
    if (!focus) return;
    useUpcoming.setState({ focus: null });
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-upcoming-run^="${CSS.escape(focus.scheduleId)}@"]`) ?? document.querySelector<HTMLElement>(`[data-upcoming-schedule="${CSS.escape(focus.scheduleId)}"]`);
      el?.scrollIntoView({ block: 'center' });
      el?.focus({ preventScroll: true });
    });
  }, [focus]);

  return (
    <div className="@container flex h-full min-h-0 flex-col" data-upcoming>
      <header className="drag shrink-0 border-b border-border px-6 py-2.5">
        <div className="flex min-h-9 flex-wrap items-center gap-2.5">
          <SidebarToggle />
          <CalendarClock size={18} className="shrink-0 text-muted" aria-hidden />
          <h1 className="text-hero leading-tight font-semibold">Upcoming</h1>
          {!nothing && (
            <div className="no-drag ml-2 flex items-center gap-2">
              <SegmentedControl
                mode="radio"
                label="Show"
                value={filter.kind}
                onChange={(kind: UpcomingKind) => useUpcoming.getState().setKind(kind)}
                segments={[
                  { value: 'all', label: 'All', data: { 'data-upcoming-kind': 'all' } },
                  { value: 'queue', label: 'Queue', badge: entries.length, data: { 'data-upcoming-kind': 'queue' } },
                  { value: 'schedules', label: 'Schedules', badge: shownSchedules.length, data: { 'data-upcoming-kind': 'schedules' } },
                  { value: 'triggers', label: 'Triggers', badge: shownTriggers.length, data: { 'data-upcoming-kind': 'triggers' } },
                ]}
              />
              <button
                ref={chip}
                type="button"
                className="flex h-7 min-w-0 max-w-56 items-center gap-1.5 rounded-lg border border-edge px-2.5 text-ui hover:bg-border/45"
                aria-haspopup="menu"
                aria-expanded={menu?.label === 'Filter by project'}
                aria-label={`Project: ${project ? projectName(project) : 'All projects'}. Change project`}
                onClick={openProjectMenu}
                data-upcoming-project-chip
              >
                {project && <ProjectIcon project={projects.get(project)} root={project} size={14} />}
                <span className="min-w-0 truncate">{project ? projectName(project) : 'All projects'}</span>
                <ChevronDown size={13} className="shrink-0 text-muted" aria-hidden />
              </button>
            </div>
          )}
          <div className="no-drag ml-auto flex shrink-0 items-center gap-2">
            <Button icon={<ListEnd size={13} aria-hidden />} onClick={() => addToQueue(project)} data-upcoming-add-queue>
              Add to queue
            </Button>
            <Button variant="primary" icon={<Repeat size={13} aria-hidden />} onClick={() => openToSchedule(project)} data-upcoming-add-schedule>
              Schedule a session
            </Button>
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {nothing ? (
          <Empty project={project} />
        ) : (
          // Two columns while the view is wider than about 820px (a window of about 1000px beside the sidebar), else one.
          // The schedules take a third of the width, at least 340px; very wide windows keep a readable line length.
          <div
            className={`mx-auto grid w-full max-w-[1600px] gap-4 px-6 py-5 ${!cards.schedules ? 'grid-cols-1' : 'grid-cols-[minmax(0,2fr)_minmax(340px,1fr)] items-start @max-[820px]:grid-cols-1'}`}
          >
            {(cards.queue || cards.runs || cards.triggers) && (
              <div className="grid min-w-0 content-start gap-4">
                {cards.queue && <QueueCard entries={entries} total={queue.entries} rows={queue.rows} nameOf={nameOf} />}
                {cards.runs && <RunsCard runs={runs} schedules={schedules} now={now} nameOf={nameOf} onMenu={setMenu} />}
                {/* In All, only once there are triggers: an empty card would say nothing the others don't. */}
                {cards.triggers && (filter.kind === 'triggers' || shownTriggers.length > 0) && <TriggersCard triggers={shownTriggers} events={triggerEvents} now={now} nameOf={projectName} />}
              </div>
            )}
            {cards.schedules && <SchedulesColumn schedules={shownSchedules} history={history} byId={byId} now={now} nameOf={nameOf} onMenu={setMenu} />}
          </div>
        )}
      </div>
      {menu && <Menu x={menu.x} y={menu.y} entries={menu.entries} label={menu.label} width={240} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** Nothing queued and no schedules: the two ways to fill the view. */
function Empty({ project }: { project: string | null }) {
  return (
    <div className="flex h-full items-center justify-center px-6 pb-16">
      <div className="grid max-w-sm justify-items-center gap-1.5 text-center" data-upcoming-empty>
        <CalendarClock size={28} className="text-muted" aria-hidden />
        <h2 className="mt-1 text-title font-semibold">Nothing planned</h2>
        <p className="text-ui text-muted">Queue a prompt to run after a session, or schedule one to run every day or week. Both start from New session.</p>
        <div className="mt-2 flex gap-2">
          <Button icon={<ListEnd size={13} aria-hidden />} onClick={() => addToQueue(project)}>
            Add to queue
          </Button>
          <Button icon={<Repeat size={13} aria-hidden />} onClick={() => openToSchedule(project)}>
            Schedule a session
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The queue in order: its place, a grip, the project, the prompt's first line and what it waits for, Start now and ⋯
 * (the queue item's menu). Drag and ⌥↑ ⌥↓ reorder, as in the sidebar; a project filter leaves the others' places.
 */
function QueueCard({ entries, total, rows, nameOf }: { entries: QueueEntry[]; total: QueueEntry[]; rows: Parameters<typeof useQueueMenu>[0]; nameOf(cwd: string): string }) {
  const menus = useQueueMenu(rows);
  const drag = useQueueDrag();
  const projects = useProjects((s) => s.projects);
  const order = total.map((e) => e.item.id);
  return (
    <section aria-labelledby="upcoming-queue" className={CARD} data-upcoming-queue>
      <div className="flex min-w-0 items-center gap-3 px-1 pb-1">
        <SectionHeader as="h2" headingId="upcoming-queue" count={entries.length} className="min-w-0 flex-1">
          <ListEnd size={13} className="shrink-0" aria-hidden />
          Queue
        </SectionHeader>
        {entries.length > 1 && <span className="shrink-0 text-meta text-muted @max-[640px]:hidden">In order. Drag to reorder.</span>}
      </div>
      {entries.length === 0 ? (
        <p className="px-1 pb-1 text-ui text-muted">Nothing is queued.</p>
      ) : (
        <ul className="grid gap-0.5">
          {entries.map((entry) => {
            const { item, state } = entry;
            const mark = drag.markFor(item.id);
            const where = nameOf(item.cwd);
            return (
              <li
                key={item.id}
                tabIndex={0}
                className={`group/queue relative flex min-w-0 items-center gap-2.5 rounded-lg py-2 pr-2 pl-1 ${QUEUE_SURFACE[state]}`}
                data-queue-item={item.id}
                data-queue-state={state}
                aria-label={`${order.indexOf(item.id) + 1}. Queued in ${where}: ${entry.autoStart ? queueRowLabel(entry) : `${item.prompt.slice(0, 200)}.`} ${entry.detail ?? ''}`}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (!menus.onKeyDown(e, entry) && e.key === 'Enter') useLater.getState().use(item);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  menus.openMenu({ x: e.clientX, y: e.clientY }, entry);
                }}
                {...drag.props(item.id)}
              >
                {mark && <span aria-hidden className={`absolute inset-x-2 h-0.5 rounded-full bg-accent-ink ${mark === 'before' ? '-top-px' : '-bottom-px'}`} />}
                <span className="w-4 shrink-0 text-right text-meta text-faint tabular-nums" aria-hidden>
                  {order.indexOf(item.id) + 1}
                </span>
                <GripVertical size={14} className="shrink-0 cursor-grab text-faint" aria-hidden />
                <ProjectIcon project={projects.get(projectOf(item.cwd))} root={item.cwd} size={22} />
                <button type="button" tabIndex={-1} onClick={() => useLater.getState().use(item)} className="grid min-w-0 flex-1 gap-px text-left" data-tooltip="Open in New session to check it first">
                  <span className="truncate text-body text-text">{item.prompt.split('\n')[0]}</span>
                  <span className="flex min-w-0 items-center gap-1 text-meta text-faint">
                    <QueueMark entry={entry} size={11} />
                    <span className="min-w-0 truncate">
                      {entry.detail && <span className={state === 'ready' ? 'text-ok' : ''}>{entry.detail}</span>}
                      {entry.detail && ' · '}
                      {where}
                    </span>
                  </span>
                </button>
                <Button
                  variant={state === 'ready' ? 'primary' : 'secondary'}
                  size="md"
                  tabIndex={-1}
                  icon={<Play size={11} fill="currentColor" aria-hidden />}
                  onClick={() => void startQueued(item)}
                  className="shrink-0"
                  data-queue-start={item.id}
                >
                  {state === 'ready' ? 'Start' : 'Start now'}
                </Button>
                <Button
                  variant="quiet"
                  size="sm"
                  iconOnly
                  tabIndex={-1}
                  icon={<MoreHorizontal size={15} aria-hidden />}
                  aria-label="More for this item"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    menus.openMenu({ x: rect.right - 250, y: rect.bottom + 4 }, entry);
                  }}
                  data-queue-more={item.id}
                />
              </li>
            );
          })}
        </ul>
      )}
      {menus.overlay}
    </section>
  );
}

/** The scheduled runs still to come in the next seven days, by day, with the days that repeat folded. */
function RunsCard({ runs, schedules, now, nameOf, onMenu }: { runs: UpcomingRun[]; schedules: Schedule[]; now: number; nameOf(cwd: string): string; onMenu(menu: OpenMenu): void }) {
  const byId = useMemo(() => new Map(schedules.map((s) => [s.id, s])), [schedules]);
  const groups = useMemo(() => dayGroups(runs, now, (id) => byId.get(id)?.name ?? 'Schedule'), [runs, now, byId]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  return (
    <section aria-labelledby="upcoming-runs" className={CARD} data-upcoming-runs>
      <div className="flex min-w-0 items-center gap-3 px-1 pb-1">
        <SectionHeader as="h2" headingId="upcoming-runs" className="min-w-0 flex-1">
          <Repeat size={13} className="shrink-0" aria-hidden />
          Scheduled runs
        </SectionHeader>
        <span className="shrink-0 text-meta text-muted">Next 7 days</span>
      </div>
      {groups.length === 0 ? (
        <p className="px-1 pb-1 text-ui text-muted" data-upcoming-no-runs>
          No runs in the next 7 days.{' '}
          {schedules.length > 0 && (
            <button type="button" className="text-link hover:underline" onClick={() => document.querySelector<HTMLElement>('[data-upcoming-schedules]')?.focus()}>
              See the schedules
            </button>
          )}
        </p>
      ) : (
        <div className="grid gap-3">
          {groups.map((group) => {
            if (group.kind === 'day') return <Day key={group.key} day={group} byId={byId} nameOf={nameOf} onMenu={onMenu} />;
            if (open.has(group.key)) return group.days.map((day) => <Day key={day.key} day={day} byId={byId} nameOf={nameOf} onMenu={onMenu} />);
            return (
              <div key={group.key} className="grid gap-1">
                <h3 className="px-1 text-meta font-semibold tracking-wide text-muted uppercase">{group.label}</h3>
                <button
                  type="button"
                  onClick={() => setOpen((s) => new Set(s).add(group.key))}
                  aria-label={`${group.spoken}: ${group.count} ${group.text}. Show each day`}
                  className="flex min-w-0 items-center gap-3 rounded-lg px-1 py-2 text-left hover:bg-border/45"
                  data-upcoming-fold={group.key}
                >
                  <span className="w-12 shrink-0 text-ui text-muted tabular-nums">{group.count}</span>
                  <span className="min-w-0 truncate text-ui text-muted">{group.text}</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** One day of runs: its heading and a list of them. */
function Day({ day, byId, nameOf, onMenu }: { day: UpcomingDay; byId: Map<string, Schedule>; nameOf(cwd: string): string; onMenu(menu: OpenMenu): void }) {
  const id = `upcoming-day-${day.key}`;
  return (
    <div className="grid gap-0.5">
      <h3 id={id} aria-label={day.spoken} className={`px-1 pb-0.5 text-meta font-semibold tracking-wide uppercase ${day.near === 'tomorrow' ? 'text-text' : 'text-muted'}`}>
        {day.label}
      </h3>
      <ul aria-labelledby={id} className="grid gap-0.5">
        {day.runs.map((run) => {
          const schedule = byId.get(run.scheduleId);
          return schedule ? <RunRow key={`${run.scheduleId}@${run.at}`} run={run} schedule={schedule} project={nameOf(run.cwd)} onMenu={onMenu} /> : null;
        })}
      </ul>
    </div>
  );
}

/**
 * A run still to come: its time, project and schedule, with Run now, Skip this run and ⋯ on hover and focus. One you
 * skipped is dimmed, with Undo.
 */
function RunRow({ run, schedule, project, onMenu }: { run: UpcomingRun; schedule: Schedule; project: string; onMenu(menu: OpenMenu): void }) {
  const projects = useProjects((s) => s.projects);
  const dim = run.skipped;
  const menuAt = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    onMenu({ x: rect.right - 240, y: rect.bottom + 4, entries: runEntries(schedule, run.at), label: `Run of ${schedule.name}` });
  };
  return (
    <li
      tabIndex={0}
      aria-label={`${runLabel(run.at, schedule.name, project)}${run.skipped ? ', skipped by you' : ''}`}
      className="group/run flex min-h-11 min-w-0 items-center gap-3 rounded-lg px-1 py-1.5 hover:bg-border/45 focus-visible:bg-border/45"
      data-upcoming-run={`${run.scheduleId}@${run.at}`}
      data-upcoming-run-state={run.skipped ? 'skipped-by-you' : 'next'}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu({ x: e.clientX, y: e.clientY, entries: runEntries(schedule, run.at), label: `Run of ${schedule.name}` });
      }}
    >
      <span className={`w-12 shrink-0 text-ui tabular-nums ${dim ? 'text-faint' : 'text-text'}`}>{runClock(run.at)}</span>
      <span className={`flex shrink-0 ${dim ? 'opacity-60' : ''}`}>
        <ProjectIcon project={projects.get(projectOf(run.cwd))} root={run.cwd} size={22} />
      </span>
      <span className="grid min-w-0 flex-1 gap-px">
        <span className={`truncate text-body ${dim ? 'text-muted' : 'text-text'}`}>{schedule.name}</span>
        <span className="flex min-w-0 items-center gap-1 text-meta text-faint">
          <Repeat size={11} className="shrink-0" aria-hidden />
          <span className="truncate">{project}</span>
        </span>
      </span>
      {run.skipped ? (
        <span className="flex shrink-0 items-center gap-2 text-meta text-muted">
          Skipped by you
          <Button size="sm" onClick={() => void unskipRun(schedule, run.at).catch(() => {})} data-upcoming-unskip>
            Undo
          </Button>
        </span>
      ) : (
        // Shown on hover and on focus within the row, so the keys reach them too.
        <span className="flex shrink-0 items-center gap-1.5 opacity-0 group-focus-within/run:opacity-100 group-hover/run:opacity-100">
          <Button size="md" icon={<Play size={11} fill="currentColor" aria-hidden />} onClick={() => void runScheduleNow(schedule)} data-upcoming-run-now>
            Run now
          </Button>
          <Button size="md" icon={<SkipForward size={12} aria-hidden />} onClick={() => void skipRun(schedule, run.at)} data-upcoming-skip>
            Skip this run
          </Button>
          <Button variant="quiet" size="sm" iconOnly icon={<MoreHorizontal size={15} aria-hidden />} aria-label={`More for this run of ${schedule.name}`} onClick={(e) => menuAt(e.currentTarget)} data-upcoming-run-more />
        </span>
      )}
    </li>
  );
}

type SessionState = 'working' | 'waiting' | null;

/** When a past run was: "Today 13:58", "Yesterday 08:00", "Mon 08:45", or "Mon 12 Oct 08:00" further back. */
function pastWhen(at: number, now: number): string {
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000);
  return days === 0 ? `Today ${runClock(at)}` : days === 1 ? `Yesterday ${runClock(at)}` : formatPast(at, now);
}

/** How a past run went, in words, for its label. */
function resultText(r: ScheduleLastRun, state: SessionState): string {
  switch (r.result) {
    case 'started':
      return state === 'working' ? 'working' : state === 'waiting' ? 'waiting for you' : 'finished';
    case 'queued':
      return 'in the queue';
    case 'skipped':
      return r.reason === SKIPPED_BY_YOU ? 'skipped by you' : `skipped: ${r.reason ?? 'the last run was still working'}`;
    case 'missed':
      return 'missed';
    case 'failed':
      return `didn't start: ${r.reason ?? 'unknown reason'}`;
  }
}

/** A past run's result on the right: Finished ✓ Open, Skipped: …, Missed, In the queue, Skipped by you. */
function PastResult({ run: r, state }: { run: ScheduleLastRun; state: SessionState }) {
  const cls = 'shrink-0 text-meta';
  if (r.result === 'started') {
    return (
      <span className={`flex items-center gap-1.5 ${cls} text-muted`} data-upcoming-result="started">
        {state === 'working' ? 'Working' : state === 'waiting' ? 'Waiting for you' : 'Finished'}
        {!state && <Check size={11} className="text-ok" aria-hidden />}
        {r.sessionId && (
          <button type="button" className="text-link hover:underline" onClick={() => useSessions.getState().select(r.sessionId!)} data-upcoming-open>
            Open
          </button>
        )}
      </span>
    );
  }
  if (r.result === 'queued') return <span className={`${cls} text-muted`} data-upcoming-result="queued">In the queue</span>;
  if (r.result === 'missed') return <span className={`${cls} text-caution`} data-upcoming-result="missed">Missed</span>;
  if (r.result === 'skipped' && r.reason === SKIPPED_BY_YOU) return <span className={`${cls} text-muted`} data-upcoming-result="skipped-by-you">Skipped by you</span>;
  if (r.result === 'skipped') return <span className={`min-w-0 truncate ${cls} text-caution`} data-upcoming-result="skipped">Skipped: {r.reason ?? 'the last run was still working'}</span>;
  return <span className={`min-w-0 truncate ${cls} text-caution`} data-upcoming-result="failed">Didn't start: {r.reason ?? 'unknown reason'}</span>;
}

/**
 * History: the runs of the last seven days, newest first, with how each went (Finished ✓ Open, Skipped, Missed, In
 * the queue). One-time schedules that have run only show here. Nothing shows without runs.
 */
function HistoryCard({ runs, byId, now, nameOf }: { runs: PastRun[]; byId: Map<string, Schedule>; now: number; nameOf(cwd: string): string }) {
  if (runs.length === 0) return null;
  return (
    <section aria-labelledby="upcoming-history" className={CARD} data-upcoming-history>
      <div className="flex min-w-0 items-center gap-3 px-1 pb-1">
        <SectionHeader as="h2" headingId="upcoming-history" className="min-w-0 flex-1">
          <History size={13} className="shrink-0" aria-hidden />
          History
        </SectionHeader>
        <span className="shrink-0 text-meta text-muted">Last 7 days</span>
      </div>
      <ul className="grid gap-0.5">
        {runs.map((run) => {
          const schedule = byId.get(run.scheduleId);
          return schedule ? <HistoryRow key={`${run.scheduleId}@${run.at}`} run={run} name={schedule.name} now={now} project={nameOf(run.cwd)} /> : null;
        })}
      </ul>
    </section>
  );
}

/** A run that happened: when, its project and schedule, and how it went. */
function HistoryRow({ run, name, now, project }: { run: PastRun; name: string; now: number; project: string }) {
  const projects = useProjects((s) => s.projects);
  const state = useHosts((s): SessionState => {
    const id = run.run.sessionId;
    const host = id ? s.hosts.get(id)?.state : undefined;
    return host === 'needs-you' ? 'waiting' : host === 'running' || host === 'starting' ? 'working' : null;
  });
  return (
    <li
      tabIndex={0}
      aria-label={`${runLabel(run.at, name, project)}, ${resultText(run.run, state)}`}
      className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 rounded-lg px-1 py-1.5 hover:bg-border/45"
      data-upcoming-past={`${run.scheduleId}@${run.at}`}
      data-upcoming-past-result={run.run.result}
    >
      <span className="flex shrink-0 opacity-80">
        <ProjectIcon project={projects.get(projectOf(run.cwd))} root={run.cwd} size={20} />
      </span>
      <span className="grid min-w-0 gap-px">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-ui text-text">{name}</span>
          <span className="shrink-0 text-meta text-faint tabular-nums">{pastWhen(run.at, now)}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-meta text-faint">
          <span className="min-w-0 truncate">{project}</span>
          <span aria-hidden>·</span>
          <PastResult run={run.run} state={state} />
        </span>
      </span>
    </li>
  );
}

/**
 * Every schedule but the one-time ones that have run: its project and name, the rule with the project, a switch to
 * pause it, and ⋯. Under it, when schedules run on this platform, and History.
 */
function SchedulesColumn({ schedules, history, byId, now, nameOf, onMenu }: { schedules: Schedule[]; history: PastRun[]; byId: Map<string, Schedule>; now: number; nameOf(cwd: string): string; onMenu(menu: OpenMenu): void }) {
  const projects = useProjects((s) => s.projects);
  return (
    <div className="grid min-w-0 content-start gap-2">
      <section aria-labelledby="upcoming-schedules" tabIndex={-1} className={`${CARD} outline-none`} data-upcoming-schedules>
        <SectionHeader as="h2" headingId="upcoming-schedules" count={schedules.length} className="px-1 pb-1">
          <Repeat size={13} className="shrink-0" aria-hidden />
          Schedules
        </SectionHeader>
        {schedules.length === 0 ? (
          <p className="px-1 pb-1 text-ui text-muted">No schedules.</p>
        ) : (
          <ul className="grid gap-0.5">
            {schedules.map((schedule) => {
              const reason = schedule.paused ? (schedule.pausedReason === 'Folder not found' ? 'Folder not found' : 'Paused') : null;
              const dim = schedule.paused;
              const openMenu = (x: number, y: number) => onMenu({ x, y, entries: scheduleEntries(schedule), label: `Schedule: ${schedule.name}` });
              return (
                <li
                  key={schedule.id}
                  tabIndex={0}
                  className="flex min-w-0 items-center gap-2.5 rounded-lg px-1 py-2 hover:bg-border/45"
                  data-upcoming-schedule={schedule.id}
                  data-schedule-paused={schedule.paused || undefined}
                  aria-label={`${schedule.name}, ${describe(schedule.rule)}, ${nameOf(schedule.draft.cwd)}${reason ? `, ${reason.toLowerCase()}` : ''}`}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter') useSchedules.getState().edit(schedule);
                    else if (isContextMenuKey(e)) {
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      openMenu(rect.left + 24, rect.bottom);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openMenu(e.clientX, e.clientY);
                  }}
                >
                  <span className={`flex shrink-0 ${dim ? 'opacity-60' : ''}`}>
                    <ProjectIcon project={projects.get(projectOf(schedule.draft.cwd))} root={schedule.draft.cwd} size={22} />
                  </span>
                  <span className="grid min-w-0 flex-1 gap-px">
                    <span className={`truncate text-body ${dim ? 'text-muted' : 'text-text'}`}>{schedule.name}</span>
                    <span className={`truncate text-meta ${dim ? 'text-faint' : 'text-muted'}`}>
                      {describe(schedule.rule)} · {nameOf(schedule.draft.cwd)}
                    </span>
                    {reason && (
                      <span className="flex items-center gap-1 text-meta text-caution">
                        {reason === 'Paused' && <Pause size={10} aria-hidden />}
                        {reason}
                      </span>
                    )}
                  </span>
                  <Switch
                    checked={!schedule.paused}
                    onChange={(on) => void setSchedulePaused(schedule, !on).catch(() => {})}
                    label={`${schedule.name}, ${schedule.paused ? 'paused' : 'active'}`}
                    dataAttrs={{ 'data-upcoming-schedule-switch': schedule.id }}
                  />
                  <Button
                    variant="quiet"
                    size="sm"
                    iconOnly
                    tabIndex={-1}
                    icon={<MoreHorizontal size={15} aria-hidden />}
                    aria-label={`More for ${schedule.name}`}
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      openMenu(rect.right - 240, rect.bottom + 4);
                    }}
                    data-schedule-more={schedule.id}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <p className="flex items-start gap-1.5 px-1 text-meta text-muted" data-schedules-platform>
        <Info size={12} className="mt-0.5 shrink-0" aria-hidden />
        {schedulesRunLine()}
      </p>
      <div className="mt-2 grid">
        <HistoryCard runs={history} byId={byId} now={now} nameOf={nameOf} />
      </div>
    </div>
  );
}
