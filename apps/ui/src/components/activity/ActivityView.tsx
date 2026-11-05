import { ChevronDown, ChevronLeft, ChevronRight, Copy, Download, FileDiff, GitCommitHorizontal, GitPullRequest, Loader2, Sparkles, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { homeSessions } from '../home/homeModel.ts';
import { useComputers } from '../../state/computersStore.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { useActivity } from '../../state/activityStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { toRows, useSessions } from '../../state/sessionsStore.ts';
import { ComputerChip } from '../computers/ComputerChip.tsx';
import { useMinute } from '../focus/useMinute.ts';
import { ProjectIcon, useProjectColor } from '../ProjectIcon.tsx';
import { SidebarToggle } from '../sidebar/SidebarToggle.tsx';
import { Button } from '../ui/Button.tsx';
import { Pill } from '../ui/Pill.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { useCostFormat } from '../usage/useCost.ts';
import { ActivityCopyDialog } from './ActivityCopyDialog.tsx';
import { ActivityExportDialog } from './ActivityExportDialog.tsx';
import { addDays, barHeight, countsByDay, dayNumber, dayOf, dayShort, dayTitle, formatWorked, inProject, neighbourLine, plural, projectGroups, projectShare, ribbonOf, rowKey, statsOf, STRIP_STEP, stripDays, summaryParts, weekdayShort, type ActivityRow, type ProjectGroup } from './activityModel.ts';
import { useActivityRange, useDaySummary, type DaySummary } from './useActivity.ts';

/** How strong each level of the ribbon shows. */
const RIBBON_OPACITY = [0, 0.3, 0.5, 0.75, 1] as const;

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * Activity: what you did per day. Upcoming looks ahead, this looks back. The strip picks a day, then the day in short,
 * its numbers, when you worked, the week per project (a click filters the page to it) and what you did per project.
 * Everything is made in the renderer from one list of a session's days (`activity.range`).
 */
export function ActivityView() {
  const now = useMinute();
  const today = dayOf(now);
  const pickedDay = useActivity((s) => s.day);
  const pickedEnd = useActivity((s) => s.stripEnd);
  const project = useActivity((s) => s.project);
  const day = pickedDay ?? today;
  const end = pickedEnd ?? today;
  const days = useMemo(() => stripDays(end), [end]);
  const { rows, loading, settled, scanning } = useActivityRange(days[0]!, end);
  const [dialog, setDialog] = useState<'copy' | 'export' | null>(null);

  // The project filter is on everything below the title, the strip's bars too.
  const filtered = useMemo(() => inProject(rows, project), [rows, project]);
  const counts = useMemo(() => countsByDay(filtered), [filtered]);
  const ofDay = useMemo(() => filtered.filter((row) => row.day === day), [filtered, day]);
  // The day in short is the whole day's, also while a project is picked.
  const wholeDay = useMemo(() => rows.filter((row) => row.day === day), [rows, day]);
  const summary = useDaySummary(day, wholeDay, settled);
  const weekGroups = useMemo(() => projectGroups(rows), [rows]);
  const pickedName = weekGroups.find((g) => g.key === project)?.name ?? null;

  const moveStrip = (by: number) => {
    const next = addDays(end, by);
    const latest = next >= today;
    useActivity.getState().moveStrip(latest ? null : next, latest ? null : next);
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-activity>
      <div className="drag flex h-13 shrink-0 items-center px-4">
        <SidebarToggle />
      </div>
      <div className="@container min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-[1000px] grid-cols-[minmax(0,1fr)] gap-5 px-8 pt-1 pb-12 @max-[560px]:px-4">
          <header className="flex flex-wrap items-end gap-3">
            <div className="grid min-w-0 flex-1 gap-0.5">
              <span className="text-ui text-muted">Activity</span>
              <h1 className="truncate text-hero leading-tight font-semibold" data-activity-title>
                {dayTitle(day)}
              </h1>
            </div>
            {project && pickedName && (
              <Pill tone="muted" icon={<X size={12} aria-hidden />} onClick={() => useActivity.getState().toggleProject(project)} aria-label={`Show every project, now only ${pickedName}`} data-activity-clear-project>
                Only {pickedName}
              </Pill>
            )}
            <div className="flex shrink-0 items-center gap-2">
              <Button icon={<Copy size={13} aria-hidden />} onClick={() => setDialog('copy')} data-activity-copy>
                Copy for standup
              </Button>
              <Button icon={<Download size={13} aria-hidden />} onClick={() => setDialog('export')} data-activity-export>
                Export…
              </Button>
            </div>
          </header>

          <WeekStrip days={days} day={day} today={today} counts={counts} onDay={(picked) => useActivity.getState().showDay(picked === today ? null : picked)} onMove={moveStrip} atLatest={end >= today} />
          {scanning && (
            <p className="text-meta text-muted" data-activity-scanning>
              Reading your transcripts. The days fill up as it goes.
            </p>
          )}

          {!loading && ofDay.length === 0 ? (
            <EmptyDay day={day} today={today} counts={counts} project={pickedName} />
          ) : (
            !loading && (
              <>
                {!project && <DayInShort summary={summary} />}
                <Numbers rows={ofDay} />
                <Ribbon rows={ofDay} />
              </>
            )
          )}

          {!loading && rows.length > 0 && <WeekCard groups={weekGroups} end={end} first={days[0]!} atLatest={end >= today} rows={rows} />}
          {!loading && ofDay.length > 0 && <WhatYouDid rows={ofDay} />}
          {loading && (
            <p className="flex items-center gap-2 text-ui text-muted" aria-busy data-activity-loading>
              <Loader2 size={13} className="animate-spin" aria-hidden />
              Reading your days…
            </p>
          )}
        </div>
      </div>
      {dialog === 'copy' && <ActivityCopyDialog today={today} onClose={() => setDialog(null)} />}
      {dialog === 'export' && <ActivityExportDialog day={day} first={days[0]!} last={end} dayRows={ofDay} weekRows={filtered} onClose={() => setDialog(null)} />}
    </div>
  );
}

function WeekStrip({ days, day, today, counts, onDay, onMove, atLatest }: { days: readonly string[]; day: string; today: string; counts: ReadonlyMap<string, number>; onDay(day: string): void; onMove(by: number): void; atLatest: boolean }) {
  const max = Math.max(0, ...days.map((d) => counts.get(d) ?? 0));
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Pick a day" data-activity-strip>
      <Button variant="quiet" iconOnly icon={<ChevronLeft size={14} aria-hidden />} aria-label="Earlier week" data-tooltip="Earlier week" onClick={() => onMove(-STRIP_STEP)} data-activity-earlier />
      {days.map((d) => {
        const count = counts.get(d) ?? 0;
        const selected = d === day;
        return (
          <button
            key={d}
            type="button"
            onClick={() => onDay(d)}
            aria-current={selected ? 'date' : undefined}
            aria-label={`${dayTitle(d)}: ${plural(count, 'session')}${d === today ? ', today' : ''}`}
            className={`grid min-w-0 max-w-16 flex-1 justify-items-center gap-1 rounded-lg px-0.5 pt-2 pb-1.5 ${selected ? 'bg-selected' : 'hover:bg-border/45'}`}
            data-activity-day={d}
            data-activity-day-count={count}
          >
            <span className="text-meta text-muted">{weekdayShort(d)}</span>
            <span className={`text-title font-semibold tabular-nums ${count === 0 ? 'text-faint' : 'text-text'}`}>{dayNumber(d)}</span>
            <span className="flex h-11 items-end" aria-hidden>
              <span className={`block w-[18px] rounded-[3px] ${selected ? 'bg-accent' : 'bg-faint/60'} ${count === 0 ? 'opacity-40' : ''}`} style={{ height: barHeight(count, max) }} />
            </span>
            <span className="text-meta text-muted tabular-nums">{count || '–'}</span>
          </button>
        );
      })}
      <Button variant="quiet" iconOnly icon={<ChevronRight size={14} aria-hidden />} aria-label="Later week" data-tooltip={atLatest ? undefined : 'Later week'} disabled={atLatest} onClick={() => onMove(STRIP_STEP)} data-activity-later />
    </div>
  );
}

function DayInShort({ summary: { summary, state, writing, regenerate } }: { summary: DaySummary }) {
  if (state === 'off' || state === 'empty') return null;
  return (
    <section aria-labelledby="activity-short" className="grid gap-2 rounded-xl bg-text/6 px-4 py-3.5" aria-busy={writing} data-activity-summary data-activity-summary-state={writing ? 'writing' : state}>
      <h2 id="activity-short" className="flex items-center gap-1.5 text-ui text-muted">
        <Sparkles size={13} aria-hidden />
        The day in short
      </h2>
      {summary ? (
        <p className="text-body leading-relaxed" data-activity-summary-text>
          {summaryParts(summary.text).map((part, i) => (part.bold ? <b key={i}>{part.text}</b> : <span key={i}>{part.text}</span>))}
        </p>
      ) : writing ? (
        <p className="flex items-center gap-2 text-body text-muted">
          <Loader2 size={13} className="animate-spin" aria-hidden />
          Writing the day in short…
        </p>
      ) : (
        state === 'failed' && <p className="text-body text-muted">Couldn’t write it this time.</p>
      )}
      <div className="flex flex-wrap items-center gap-x-1.5 text-meta text-faint">
        {summary && <span>From the catch-ups of {plural(summary.sessions, 'session')}</span>}
        {summary && <span aria-hidden>·</span>}
        <button type="button" disabled={writing} onClick={regenerate} className="text-muted hover:text-text disabled:opacity-60" data-activity-regenerate>
          {writing && summary ? 'Writing…' : summary ? 'Regenerate' : 'Try again'}
        </button>
      </div>
    </section>
  );
}

function Stat({ value, label, data }: { value: string; label: string; data: string }) {
  return (
    <div className="grid gap-0.5" data-activity-stat={data}>
      <b className="text-title font-semibold tabular-nums">{value}</b>
      <span className="text-meta text-muted">{label}</span>
    </div>
  );
}

function Numbers({ rows }: { rows: readonly ActivityRow[] }) {
  const stats = useMemo(() => statsOf(rows), [rows]);
  const cost = useCostFormat();
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-3" data-activity-numbers>
      <Stat value={String(stats.sessions)} label={stats.sessions === 1 ? 'session' : 'sessions'} data="sessions" />
      <Stat value={String(stats.turns)} label={stats.turns === 1 ? 'turn' : 'turns'} data="turns" />
      <Stat value={formatWorked(stats.activeMs)} label="Claude working" data="time" />
      <Stat value={String(stats.commits)} label={stats.commits === 1 ? 'commit' : 'commits'} data="commits" />
      <Stat value={String(stats.prs)} label={stats.prs === 1 ? 'pull request' : 'pull requests'} data="prs" />
      {cost && stats.costUsd !== null && <Stat value={cost(stats.costUsd)} label="cost" data="cost" />}
    </div>
  );
}

function Ribbon({ rows }: { rows: readonly ActivityRow[] }) {
  const ribbon = useMemo(() => ribbonOf(rows), [rows]);
  return (
    <section aria-labelledby="activity-when" className="grid gap-1.5" data-activity-when>
      <SectionHeader as="h2" headingId="activity-when">
        When
      </SectionHeader>
      <div className="grid grid-cols-[repeat(24,minmax(0,1fr))] gap-0.5" role="img" aria-label={`Worked in the hours ${ribbon.flatMap((cell, hour) => (cell.level ? [String(hour)] : [])).join(', ') || 'none'}`}>
        {ribbon.map((cell, hour) => (
          <span key={hour} className="relative h-[18px] overflow-hidden rounded-[3px] bg-border/45" data-tooltip={`${String(hour).padStart(2, '0')}:00${cell.ms > 60_000 ? `, ${formatWorked(cell.ms)}` : ''}`} data-activity-hour={hour} data-activity-hour-level={cell.level}>
            <span className="absolute inset-0 bg-accent" style={{ opacity: RIBBON_OPACITY[cell.level] }} />
          </span>
        ))}
      </div>
      <div className="flex justify-between text-meta text-muted tabular-nums" aria-hidden>
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </section>
  );
}

function EmptyDay({ day, today, counts, project }: { day: string; today: string; counts: ReadonlyMap<string, number>; project: string | null }) {
  return (
    <div className="grid justify-items-center gap-1.5 rounded-xl bg-text/6 px-4 py-6 text-center" data-activity-empty>
      <b className="text-ui font-semibold">{dayTitle(day)}</b>
      <span className="text-ui text-muted">{project ? `No sessions in ${project} this day.` : day === today ? 'No sessions yet today.' : 'No sessions this day.'}</span>
      <span className="text-meta text-faint">{neighbourLine(day, today, counts)}</span>
    </div>
  );
}

function WeekBar({ group, groups, picked }: { group: ProjectGroup; groups: readonly ProjectGroup[]; picked: boolean }) {
  const project = useProjects((s) => (group.root ? s.projects.get(group.root) : undefined));
  const color = useProjectColor(project, group.root);
  const share = projectShare(group, groups);
  return (
    <button
      type="button"
      onClick={() => useActivity.getState().toggleProject(group.key)}
      aria-pressed={picked}
      aria-label={`${group.name}: ${formatWorked(group.activeMs)}. ${picked ? 'Show every project' : 'Show only this project'}`}
      className={`grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_56px] items-center gap-2.5 rounded-md px-1.5 py-1 text-left text-ui ${picked ? 'bg-selected' : 'hover:bg-border/45'}`}
      data-activity-week-project={group.key}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <ProjectIcon project={project} root={group.root ?? group.name} name={group.name} size={16} remote={group.computerId ?? false} />
        <span className="min-w-0 truncate">{group.name}</span>
      </span>
      <span className="h-2 overflow-hidden rounded bg-border/60" aria-hidden>
        <span className={`block h-full ${color ? '' : 'bg-accent'}`} style={{ width: `${Math.max(1, Math.round(share * 100))}%`, ...(color ? { backgroundColor: color } : {}) }} />
      </span>
      <span className="text-right text-meta text-muted tabular-nums">{formatWorked(group.activeMs)}</span>
    </button>
  );
}

function WeekCard({ groups, first, end, atLatest, rows }: { groups: readonly ProjectGroup[]; first: string; end: string; atLatest: boolean; rows: readonly ActivityRow[] }) {
  const picked = useActivity((s) => s.project);
  const stats = useMemo(() => statsOf(rows), [rows]);
  return (
    <section aria-labelledby="activity-week" className="grid gap-2 rounded-xl bg-text/6 px-4 py-3.5" data-activity-week>
      <div className="flex items-center gap-2">
        <h2 id="activity-week" className="text-ui font-semibold">
          {atLatest ? 'This week' : `${dayShort(first)} to ${dayShort(end)}`}
        </h2>
        <span className="ml-auto text-meta text-muted">
          {plural(stats.sessions, 'session')} · {formatWorked(stats.activeMs)}
        </span>
      </div>
      <div className="grid gap-0.5">
        {groups.map((group) => (
          <WeekBar key={group.key} group={group} groups={groups} picked={picked === group.key} />
        ))}
      </div>
      <span className="text-meta text-faint">Pick a week in the strip, or click a project to see only its sessions.</span>
    </section>
  );
}

function ProjectHeader({ group }: { group: ProjectGroup }) {
  const project = useProjects((s) => (group.root ? s.projects.get(group.root) : undefined));
  return (
    <div className="flex min-w-0 items-center gap-2 px-2.5 pb-1">
      <ProjectIcon project={project} root={group.root ?? group.name} name={group.name} size={18} remote={group.computerId ?? false} />
      <h3 className="min-w-0 truncate text-ui font-semibold">{group.name}</h3>
      <span className="shrink-0 text-meta text-muted">
        {plural(group.sessions, 'session')} · {formatWorked(group.activeMs)}
      </span>
    </div>
  );
}

/** Opens a session from its row: its pane here, or on the computer it ran on. */
function openRow(row: ActivityRow): void {
  if (row.computer) useComputers.getState().openSession({ computerId: row.computer.id, sessionId: row.sessionId });
  else useSessions.getState().select(row.sessionId);
}

function SessionRow({ row, needsYou }: { row: ActivityRow; needsYou: boolean }) {
  const key = `${row.day}:${rowKey(row)}`;
  const open = useActivity((s) => s.expanded.has(key));
  const lines = row.did.length ? row.did : row.asks.slice(0, 6);
  return (
    <div className={`rounded-lg ${open ? 'bg-text/6' : ''}`} data-activity-session={row.sessionId} data-activity-session-open={open || undefined}>
      <button type="button" onClick={() => useActivity.getState().toggleExpanded(key)} aria-expanded={open} className={`flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-ui ${open ? '' : 'hover:bg-border/45'}`}>
        <ChevronDown size={13} className={`shrink-0 text-faint transition-transform motion-reduce:transition-none ${open ? '' : '-rotate-90'}`} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-text">{row.title}</span>
        {row.computer && <ComputerChip name={row.computer.name} computerId={row.computer.id} data-activity-computer />}
        {row.commits > 0 && (
          <Pill tone="muted" icon={<GitCommitHorizontal size={12} aria-hidden />} aria-label={plural(row.commits, 'commit')} data-tooltip={plural(row.commits, 'commit')} data-activity-commits={row.commits}>
            {row.commits}
          </Pill>
        )}
        {row.files > 0 && (
          <Pill tone="muted" icon={<FileDiff size={12} aria-hidden />} aria-label={`${plural(row.files, 'file')} changed`} data-tooltip={`${plural(row.files, 'file')} changed`} className="@max-[640px]:hidden" data-activity-files={row.files}>
            {row.files}
          </Pill>
        )}
        {row.prs.map((pr) => (
          <Pill key={pr.url} tone="muted" icon={<GitPullRequest size={12} aria-hidden />} data-activity-pr={pr.number}>
            #{pr.number}
          </Pill>
        ))}
        {needsYou && (
          <Pill tone="warn" data-activity-needs-you>
            needs you
          </Pill>
        )}
        <span className="w-24 shrink-0 text-right text-meta text-muted tabular-nums">
          {clock.format(row.firstAt)}
          {row.activeMs > 0 && ` · ${formatWorked(row.activeMs)}`}
        </span>
      </button>
      {open && (
        <div className="grid gap-2 px-2.5 pb-2.5 pl-8.5">
          {lines.length > 0 ? (
            <ul className="grid gap-1 text-ui leading-normal text-text/85" data-activity-did>
              {lines.map((line, i) => (
                <li key={i} className="flex gap-1.5">
                  <span aria-hidden className="text-faint">
                    •
                  </span>
                  <span className="min-w-0">{row.did.length ? line : `You asked: ${line}`}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ui text-muted">No catch-up for this session.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {row.available ? (
              <Button onClick={() => openRow(row)} data-activity-open-session>
                Open session
              </Button>
            ) : (
              <span className="text-meta text-faint">Its transcript is gone, so it can’t be opened.</span>
            )}
            {row.prs.map((pr) => (
              <Button key={pr.url} icon={<GitPullRequest size={13} aria-hidden />} onClick={() => void window.open(pr.url, '_blank')} data-activity-open-pr={pr.number}>
                Open #{pr.number}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WhatYouDid({ rows }: { rows: readonly ActivityRow[] }) {
  const groups = useMemo(() => projectGroups(rows), [rows]);
  // What needs you now, on this computer: the same list as Home's.
  const sessions = useSessions((s) => s.sessions);
  const live = useSessions((s) => s.live);
  const hosts = useHosts((s) => s.hosts);
  const needs = useMemo(() => new Set(homeSessions(toRows(sessions, live, hosts)).needs.map((row) => row.id)), [sessions, live, hosts]);
  return (
    <section aria-labelledby="activity-did" className="grid gap-4" data-activity-list>
      <SectionHeader as="h2" headingId="activity-did">
        What you did
      </SectionHeader>
      {groups.map((group) => (
        <div key={group.key} className="grid gap-0.5" data-activity-project={group.name}>
          <ProjectHeader group={group} />
          {group.rows.map((row) => (
            <SessionRow key={rowKey(row)} row={row} needsYou={!row.computer && needs.has(row.sessionId)} />
          ))}
        </div>
      ))}
    </section>
  );
}
