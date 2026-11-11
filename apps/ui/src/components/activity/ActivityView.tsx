import { ViewHeader } from '../ViewHeader.tsx';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronLeft, ChevronRight, Copy, Download, FileDiff, GitCommitHorizontal, GitPullRequest, Loader2, Sparkles, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { homeSessions } from '../home/homeModel.ts';
import { useComputers } from '../../state/computersStore.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { useActivity, type ActivitySpan } from '../../state/activityStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { toRows, useSessions } from '../../state/sessionsStore.ts';
import { ComputerChip } from '../computers/ComputerChip.tsx';
import { useMinute } from '../focus/useMinute.ts';
import { ProjectIcon, useProjectColor } from '../ProjectIcon.tsx';
import { Button } from '../ui/Button.tsx';
import { Pill } from '../ui/Pill.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import type { TooltipRow } from '../ui/Tooltip.tsx';
import { useScrollEdge } from '../ui/useScrollEdge.ts';
import { LegendItem } from '../usage/charts.tsx';
import { useCostFormat } from '../usage/useCost.ts';
import { ActivityCopyDialog } from './ActivityCopyDialog.tsx';
import { ActivityExportDialog } from './ActivityExportDialog.tsx';
import { addDays, barParts, countsByDay, dayLabel, dayNumber, dayOf, daysBetween, dayShort, dayTitle, formatWorked, formatWorkedShort, inDays, inProject, mondayOf, neighbourLine, plural, projectGroups, projectShare, rangeDays, rangeTitle, ribbonOf, rowKey, rowPrs, sessionsOnce, statsOf, stripBars, summaryParts, timesTypical, typicalLine, WEEK_DAYS, weekdayShort, weekOf, type ActivityRow, type ActivityStats, type DayRange, type DayScore, type ProjectGroup, type ScorePart, type StripBars } from './activityModel.ts';
import { RangePicker } from './RangePicker.tsx';
import { useActivityRange, useDaySummary, useTypicalDay, type DaySummary } from './useActivity.ts';

/** From this many lines the list only has the rows in view: a range can hold two months of sessions. */
const VIRTUALIZE_FROM = 150;

/** How strong each level of the ribbon shows. */
const RIBBON_OPACITY = [0, 0.3, 0.5, 0.75, 1] as const;

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

/** The page's column, the same for the fixed header, the pinned bar and what scrolls. */
const COLUMN = 'mx-auto w-full max-w-[1000px] px-8 @max-[560px]:px-4';

/** Whether `target` has scrolled out of `root`, which follows scrolling and everything that resizes either. */
function useScrolledPast(root: RefObject<HTMLElement | null>, target: RefObject<HTMLElement | null>): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    if (!root.current || !target.current) return;
    const observer = new IntersectionObserver(([entry]) => setPast(!entry!.isIntersecting), { root: root.current });
    observer.observe(target.current);
    return () => observer.disconnect();
  }, [root, target]);
  return past;
}

/**
 * Activity: what you did, per day, per week or over a range. Upcoming looks ahead, this looks back. The title and the
 * actions stay put; under them the strip picks a day, then its summary, numbers, when you worked, the time per project (a
 * click filters the page to it) and what you did per project. Week shows the same for Monday to Sunday, and Range from a
 * day till a day or today, with a bar per day instead of the strip. Once all that has scrolled away, a bar under the
 * header keeps it in short. Everything is made in the renderer from one list of a session's days (`activity.range`).
 */
export function ActivityView() {
  const now = useMinute();
  const today = dayOf(now);
  const pickedDay = useActivity((s) => s.day);
  const pickedWeek = useActivity((s) => s.week);
  const pickedRange = useActivity((s) => s.range);
  const project = useActivity((s) => s.project);
  const span = useActivity((s) => s.span);
  const day = pickedDay ?? today;
  const thisMonday = mondayOf(today);
  const monday = pickedWeek ?? thisMonday;
  const days = useMemo(() => weekOf(monday), [monday]);
  const sunday = days[WEEK_DAYS - 1]!;
  const range: DayRange = pickedRange ?? { from: addDays(today, 1 - WEEK_DAYS), to: null };
  const { from: rangeFrom, to: rangeTo } = rangeDays(range, today);
  const spanFrom = span === 'day' ? day : span === 'week' ? monday : rangeFrom;
  const spanTo = span === 'day' ? day : span === 'week' ? sunday : rangeTo;
  // A day with no sessions says what the days around it had, so the strip's week is read a day further on both sides.
  const { rows, loading, settled, scanning } = useActivityRange(span === 'range' ? rangeFrom : addDays(monday, -1), span === 'range' ? rangeTo : addDays(sunday, 1));
  const [dialog, setDialog] = useState<'copy' | 'export' | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const edge = useScrollEdge(scroller);
  const pinned = useScrolledPast(scroller, top);

  // The project filter is on everything below the title, the strip's bars too.
  const filtered = useMemo(() => inProject(rows, project?.key ?? null), [rows, project]);
  const counts = useMemo(() => countsByDay(filtered), [filtered]);
  // The bars are each day's activity score against a typical day. The typical day is every project's, also while one
  // is picked, so a project's bars read as its share of a normal day.
  const stripDays = useMemo(() => (span === 'range' ? daysBetween(rangeFrom, rangeTo) : days), [span, rangeFrom, rangeTo, days]);
  const stripRows = useMemo(() => inDays(rows, stripDays[0]!, stripDays[stripDays.length - 1]!), [rows, stripDays]);
  const typical = useTypicalDay(stripDays[0]!, stripRows);
  const bars = useMemo(() => stripBars(stripDays, filtered, typical), [stripDays, filtered, typical]);
  const shown = useMemo(() => inDays(filtered, spanFrom, spanTo), [filtered, spanFrom, spanTo]);
  // The day in short is the whole day's, also while a project is picked. A week or a range has none, so it writes nothing.
  const wholeDay = useMemo(() => rows.filter((row) => row.day === day), [rows, day]);
  const summary = useDaySummary(span === 'day' ? day : null, wholeDay, settled);
  // The bars list every project of the span, also while one is picked: another is one click away.
  const groups = useMemo(() => projectGroups(inDays(rows, spanFrom, spanTo), rows), [rows, spanFrom, spanTo]);

  const moveStrip = (by: number) => {
    const next = addDays(monday, by);
    // The same weekday of that week, so a day can be compared with last week's.
    const target = addDays(day, by);
    useActivity.getState().moveStrip(next >= thisMonday ? null : next, target >= today ? null : target);
  };
  const showDay = (d: string) => useActivity.getState().showDay(d === today ? null : d);
  const strip: StripProps = {
    days,
    span,
    picked: (d) => (span === 'day' ? d === day : d <= today),
    today,
    counts,
    bars,
    onDay: showDay,
    onMove: moveStrip,
    atLatest: monday >= thisMonday,
  };
  const weekTitle = monday >= thisMonday ? 'This week' : `${dayShort(monday)} to ${dayShort(sunday)}`;
  const title = span === 'day' ? dayTitle(day) : span === 'week' ? weekTitle : rangeTitle(range, today);

  return (
    <div className="@container flex h-full min-h-0 flex-col" data-activity>
      <ViewHeader title="Activity" />
      <div className="relative z-10 shrink-0">
        <div className="edge-b" data-scrolled={(!edge.atTop && !pinned) || undefined} data-activity-header>
          <header className={`${COLUMN} flex flex-wrap items-end gap-3 pt-1 pb-3`}>
            <div className="grid min-w-0 flex-1 gap-0.5">
              <h2 className="truncate text-hero leading-tight font-semibold" data-activity-title>
                {title}
              </h2>
            </div>
            {project && (
              <Pill tone="muted" icon={<X size={12} aria-hidden />} onClick={() => useActivity.getState().toggleProject(project.key, project.name)} aria-label={`Show every project, now only ${project.name}`} data-activity-clear-project>
                Only {project.name}
              </Pill>
            )}
            <SegmentedControl
              mode="radio"
              label="Show a day, a week or a range"
              value={span}
              onChange={(value: ActivitySpan) => useActivity.getState().setSpan(value)}
              segments={[
                { value: 'day', label: 'Day', data: { 'data-activity-span': 'day' } },
                { value: 'week', label: 'Week', data: { 'data-activity-span': 'week' } },
                { value: 'range', label: 'Range', data: { 'data-activity-span': 'range' } },
              ]}
            />
            <div className="flex shrink-0 items-center gap-2">
              <Button icon={<Copy size={13} aria-hidden />} onClick={() => setDialog('copy')} data-activity-copy>
                Copy for standup
              </Button>
              <Button icon={<Download size={13} aria-hidden />} onClick={() => setDialog('export')} data-activity-export>
                Export…
              </Button>
            </div>
          </header>
        </div>
        {pinned && <PinnedBar strip={strip} rows={shown} />}
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto" data-activity-scroller>
        <div className={`${COLUMN} grid grid-cols-[minmax(0,1fr)] gap-5 pt-1 pb-12`}>
          <div ref={top} className="grid grid-cols-[minmax(0,1fr)] gap-5">
            {span === 'range' ? (
              <>
                <RangePicker range={range} today={today} />
                <RangeBars days={stripDays} today={today} counts={counts} bars={bars} onDay={showDay} />
              </>
            ) : (
              <WeekStrip {...strip} />
            )}
            {scanning && (
              <p className="text-meta text-muted" data-activity-scanning>
                Reading your transcripts. The days fill up as it goes.
              </p>
            )}
            {!loading &&
              (shown.length === 0 ? (
                <EmptySpan span={span} title={title} day={day} today={today} counts={counts} project={project?.name ?? null} />
              ) : (
                <>
                  {span === 'day' && !project && <DayInShort summary={summary} />}
                  <Numbers rows={shown} />
                  <Ribbon rows={shown} />
                </>
              ))}
          </div>

          {!loading && groups.length > 0 && <ProjectsCard groups={groups} />}
          {!loading && shown.length > 0 && <WhatYouDid rows={shown} known={rows} span={span} today={today} scroller={scroller} />}
          {loading && (
            <p className="flex items-center gap-2 text-ui text-muted" aria-busy data-activity-loading>
              <Loader2 size={13} className="animate-spin" aria-hidden />
              Reading your days…
            </p>
          )}
        </div>
      </div>
      {dialog === 'copy' && <ActivityCopyDialog today={today} project={project} initial={span === 'week' ? 'week' : span === 'range' ? 'range' : 'last'} rangeRows={span === 'range' ? shown : null} onClose={() => setDialog(null)} />}
      {dialog === 'export' && <ActivityExportDialog day={day} first={monday} last={sunday} dayRows={inDays(filtered, day, day)} weekRows={inDays(filtered, monday, sunday)} initial={span === 'week' ? 'week' : 'day'} range={span === 'range' ? { first: rangeFrom, last: rangeTo, rows: shown } : null} onClose={() => setDialog(null)} />}
    </div>
  );
}

interface StripProps {
  days: readonly string[];
  span: ActivitySpan;
  /** The day on screen, or each day of the week so far. */
  picked(day: string): boolean;
  today: string;
  counts: ReadonlyMap<string, number>;
  bars: StripBars;
  onDay(day: string): void;
  onMove(by: number): void;
  atLatest: boolean;
}

/** The parts of a bar, from the bottom up, in the strip's own series colours (never a status colour). */
const PART_FILL: Record<ScorePart, string> = { time: 'bg-chart-time', turns: 'bg-chart-turns', shipped: 'bg-chart-shipped' };
const PART_TOKEN: Record<ScorePart, string> = { time: 'chart-time', turns: 'chart-turns', shipped: 'chart-shipped' };
const PART_LABEL: Record<ScorePart, string> = { time: 'Time', turns: 'Turns', shipped: 'Shipped' };

/** A day's bar: its score stacked from time up to shipped, or a stub for a day with nothing to count. */
function ScoreBar({ score, scale, dim = false, width }: { score: DayScore; scale: number; dim?: boolean; width: string }) {
  const parts = barParts(score, scale);
  if (!parts) return <span className={`relative block h-[3px] ${width} rounded-[3px] bg-faint/60 opacity-40`} data-activity-bar-stub />;
  return (
    <span className={`relative flex ${width} flex-col-reverse gap-0.5 ${dim ? 'opacity-50' : ''}`}>
      {parts.map(({ part, px }, i) => (
        <span key={part} className={`block ${PART_FILL[part]} ${i === parts.length - 1 ? 'rounded-t-[4px] rounded-b-[1px]' : 'rounded-[1px]'}`} style={{ height: px }} data-activity-bar-part={part} />
      ))}
    </span>
  );
}

/** The faint dashed line where a typical day's bar would end (a score of 100). */
function TypicalLine({ scale, inset }: { scale: number; inset: string }) {
  return <span className={`pointer-events-none absolute ${inset} border-t border-dashed border-faint/70`} style={{ bottom: typicalLine(scale) }} aria-hidden data-activity-typical />;
}

/** What the bars are made of, under the strip. */
function BarsLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-meta" aria-hidden data-activity-legend>
      {(['time', 'turns', 'shipped'] as const).map((part) => (
        <LegendItem key={part} color={`var(--sb-${PART_TOKEN[part]})`} label={PART_LABEL[part]} />
      ))}
      <LegendItem color="var(--sb-faint)" label="Typical day" dashed />
    </div>
  );
}

/**
 * A day's tooltip, as a card: the score and how it compares with a typical day, then what went into the bar, each with
 * its part's colour, then sessions and cost, which the score leaves out.
 */
function dayTooltip(day: string, stats: ActivityStats | undefined, score: DayScore, bars: StripBars, cost: ((usd: number | null) => string) | null): Record<string, string> {
  const title = dayTitle(day);
  if (!stats) return { 'data-tooltip': `${title}\nNo sessions`, 'data-tooltip-title': title, 'data-tooltip-meta': 'No sessions' };
  const costText = cost && stats.costUsd !== null ? cost(stats.costUsd) : null;
  const head = bars.typical ? `${title} · ${Math.round(score.total)}` : title;
  const meta = bars.typical ? timesTypical(score) : '';
  const rows: TooltipRow[] = [
    { label: 'Claude working', value: formatWorked(stats.activeMs), swatch: PART_TOKEN.time },
    { label: 'Turns', value: String(stats.turns), swatch: PART_TOKEN.turns },
    { label: 'Commits', value: String(stats.commits), swatch: PART_TOKEN.shipped },
    { label: 'Pull requests', value: String(stats.prs), swatch: PART_TOKEN.shipped },
    { label: costText ? 'Sessions · cost' : 'Sessions', value: costText ? `${stats.sessions} · ${costText}` : String(stats.sessions), quiet: true },
  ];
  const hint = bars.typical?.fromShown ? 'Compared with the days shown: the 4 weeks before have fewer than 5 days of work.' : '';
  return {
    'data-tooltip': [head, meta, ...rows.map((row) => `${row.label}: ${row.value}`), hint].filter(Boolean).join('\n'),
    'data-tooltip-title': head,
    ...(meta ? { 'data-tooltip-meta': meta } : {}),
    'data-tooltip-rows': JSON.stringify(rows),
    ...(hint ? { 'data-tooltip-hint': hint } : {}),
  };
}

function StripArrow({ by, atLatest, onMove }: { by: number; atLatest: boolean; onMove(by: number): void }) {
  const later = by > 0;
  const label = later ? 'Later week' : 'Earlier week';
  return <Button variant="quiet" iconOnly icon={later ? <ChevronRight size={14} aria-hidden /> : <ChevronLeft size={14} aria-hidden />} aria-label={label} data-tooltip={later && atLatest ? undefined : label} disabled={later && atLatest} onClick={() => onMove(by)} {...(later ? { 'data-activity-later': true } : { 'data-activity-earlier': true })} />;
}

function WeekStrip({ days, span, picked, today, counts, bars, onDay, onMove, atLatest }: StripProps) {
  const cost = useCostFormat();
  return (
    <div className="grid justify-items-center gap-2">
      <div className="flex w-full items-center gap-1.5" role="group" aria-label="Pick a day" data-activity-strip>
        <StripArrow by={-WEEK_DAYS} atLatest={atLatest} onMove={onMove} />
        {days.map((d) => {
          const count = counts.get(d) ?? 0;
          const selected = picked(d);
          const stats = bars.stats.get(d);
          const score = bars.scores.get(d)!;
          return (
            <button
              key={d}
              type="button"
              disabled={d > today}
              onClick={() => onDay(d)}
              aria-current={selected ? (span === 'day' ? 'date' : 'true') : undefined}
              aria-label={`${dayTitle(d)}: ${plural(count, 'session')}${stats ? `, ${formatWorked(stats.activeMs)}, ${timesTypical(score)}` : ''}${d === today ? ', today' : ''}`}
              className={`grid min-w-0 max-w-16 flex-1 justify-items-center gap-1 rounded-lg px-0.5 pt-2 pb-1.5 disabled:opacity-40 ${selected ? 'bg-selected' : 'enabled:hover:bg-border/45'}`}
              {...(d > today ? {} : dayTooltip(d, stats, score, bars, cost))}
              data-activity-day={d}
              data-activity-day-count={count}
              data-activity-day-score={Math.round(score.total)}
            >
              <span className="text-meta text-muted">{weekdayShort(d)}</span>
              <span className={`text-title font-semibold tabular-nums ${count === 0 ? 'text-faint' : 'text-text'}`}>{dayNumber(d)}</span>
              <span className="relative flex h-14 w-full items-end justify-center" aria-hidden>
                {bars.typical && <TypicalLine scale={bars.scale} inset="-inset-x-[5px]" />}
                <ScoreBar score={score} scale={bars.scale} dim={!selected} width="w-[18px]" />
              </span>
              <span className="text-meta text-muted tabular-nums">{formatWorkedShort(stats?.activeMs ?? 0)}</span>
            </button>
          );
        })}
        <StripArrow by={WEEK_DAYS} atLatest={atLatest} onMove={onMove} />
      </div>
      <BarsLegend />
    </div>
  );
}

/** A range's strip: too many days for a cell each, so a bar per day. A click shows that day. */
function RangeBars({ days, today, counts, bars, onDay }: { days: readonly string[]; today: string; counts: ReadonlyMap<string, number>; bars: StripBars; onDay(day: string): void }) {
  const cost = useCostFormat();
  return (
    <div className="grid gap-1" role="group" aria-label="Pick a day" data-activity-range-bars>
      <div className="relative flex h-14 items-end gap-0.5">
        {bars.typical && <TypicalLine scale={bars.scale} inset="inset-x-0" />}
        {days.map((d) => {
          const count = counts.get(d) ?? 0;
          const stats = bars.stats.get(d);
          const score = bars.scores.get(d)!;
          return (
            <button
              key={d}
              type="button"
              onClick={() => onDay(d)}
              aria-label={`${dayTitle(d)}: ${plural(count, 'session')}${stats ? `, ${formatWorked(stats.activeMs)}, ${timesTypical(score)}` : ''}${d === today ? ', today' : ''}`}
              {...dayTooltip(d, stats, score, bars, cost)}
              className="relative flex h-full min-w-0 flex-1 items-end rounded-[3px] hover:bg-border/45"
              data-activity-range-day={d}
              data-activity-range-day-count={count}
              data-activity-range-day-score={Math.round(score.total)}
            >
              <ScoreBar score={score} scale={bars.scale} width="w-full" />
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-meta text-muted tabular-nums">
        <span aria-hidden>{dayLabel(days[0]!, today)}</span>
        <BarsLegend />
        <span aria-hidden>{dayLabel(days[days.length - 1]!, today)}</span>
      </div>
    </div>
  );
}

/**
 * The strip and the numbers in one line, over the sessions once the real ones have scrolled away. It lies over what
 * scrolls, not above it, so showing it never moves the list you are reading.
 */
function PinnedBar({ strip: { days, span, picked, today, counts, onDay, onMove, atLatest }, rows }: { strip: StripProps; rows: readonly ActivityRow[] }) {
  const stats = useMemo(() => statsOf(rows), [rows]);
  const cost = useCostFormat();
  const line = [plural(stats.sessions, 'session'), plural(stats.turns, 'turn'), formatWorked(stats.activeMs), plural(stats.commits, 'commit'), plural(stats.prs, 'pull request'), ...(cost && stats.costUsd !== null ? [cost(stats.costUsd)] : [])].join(' · ');
  return (
    <div className="absolute inset-x-0 top-full" data-activity-pinned>
      <div className="edge-b bg-bg" data-scrolled>
        <div className={`${COLUMN} flex flex-wrap items-center gap-x-4 gap-y-1 pb-2`}>
          {span !== 'range' && (
            <div className="flex items-center gap-0.5" role="group" aria-label="Pick a day">
              <StripArrow by={-WEEK_DAYS} atLatest={atLatest} onMove={onMove} />
              {days.map((d) => {
                const count = counts.get(d) ?? 0;
                const selected = picked(d);
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={d > today}
                    onClick={() => onDay(d)}
                    aria-current={selected ? (span === 'day' ? 'date' : 'true') : undefined}
                    aria-label={`${dayTitle(d)}: ${plural(count, 'session')}${d === today ? ', today' : ''}`}
                    className={`flex items-baseline gap-1 rounded-md px-1.5 py-1 disabled:opacity-40 ${selected ? 'bg-selected' : 'enabled:hover:bg-border/45'}`}
                    data-activity-pinned-day={d}
                  >
                    <span className="text-meta text-muted @max-[720px]:hidden">{weekdayShort(d)}</span>
                    <span className={`text-ui font-semibold tabular-nums ${count === 0 ? 'text-faint' : 'text-text'}`}>{dayNumber(d)}</span>
                  </button>
                );
              })}
              <StripArrow by={WEEK_DAYS} atLatest={atLatest} onMove={onMove} />
            </div>
          )}
          <span className="ml-auto min-w-0 text-meta text-muted tabular-nums" data-activity-pinned-numbers>
            {line}
          </span>
        </div>
      </div>
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

function EmptySpan({ span, title, day, today, counts, project }: { span: ActivitySpan; title: string; day: string; today: string; counts: ReadonlyMap<string, number>; project: string | null }) {
  const when = span === 'day' ? 'this day' : span === 'week' ? 'this week' : 'in this range';
  return (
    <div className="grid justify-items-center gap-1.5 rounded-xl bg-text/6 px-4 py-6 text-center" data-activity-empty>
      <b className="text-ui font-semibold">{title}</b>
      <span className="text-ui text-muted">{project ? `No sessions in ${project} ${when}.` : span === 'day' && day === today ? 'No sessions yet today.' : `No sessions ${when}.`}</span>
      {span === 'day' && <span className="text-meta text-faint">{neighbourLine(day, today, counts)}</span>}
    </div>
  );
}

function ProjectBar({ group, groups, picked }: { group: ProjectGroup; groups: readonly ProjectGroup[]; picked: boolean }) {
  const project = useProjects((s) => (group.root ? s.projects.get(group.root) : undefined));
  const color = useProjectColor(project, group.root);
  const share = projectShare(group, groups);
  return (
    <button
      type="button"
      onClick={() => useActivity.getState().toggleProject(group.key, group.name)}
      aria-pressed={picked}
      aria-label={`${group.name}: ${formatWorked(group.activeMs)}. ${picked ? 'Show every project' : 'Show only this project'}`}
      className={`grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_56px] items-center gap-2.5 rounded-md px-1.5 py-1 text-left text-ui ${picked ? 'bg-selected' : 'hover:bg-border/45'}`}
      data-activity-project-bar={group.key}
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

function ProjectsCard({ groups }: { groups: readonly ProjectGroup[] }) {
  const picked = useActivity((s) => s.project?.key);
  const stats = useMemo(() => statsOf(groups.flatMap((group) => group.rows)), [groups]);
  return (
    <section aria-labelledby="activity-projects" className="grid gap-2 rounded-xl bg-text/6 px-4 py-3.5" data-activity-projects>
      <div className="flex items-center gap-2">
        <h2 id="activity-projects" className="text-ui font-semibold">
          Projects
        </h2>
        <span className="ml-auto text-meta text-muted" data-activity-projects-total>
          {plural(stats.sessions, 'session')} · {formatWorked(stats.activeMs)}
        </span>
      </div>
      <div className="grid gap-0.5">
        {groups.map((group) => (
          <ProjectBar key={group.key} group={group} groups={groups} picked={picked === group.key} />
        ))}
      </div>
      <span className="text-meta text-faint">Click a project to see only its sessions.</span>
    </section>
  );
}

function ProjectHeader({ group, first, open, onToggle }: { group: ProjectGroup; first: boolean; open: boolean; onToggle: (() => void) | null }) {
  const project = useProjects((s) => (group.root ? s.projects.get(group.root) : undefined));
  const name = (
    <>
      <ProjectIcon project={project} root={group.root ?? group.name} name={group.name} size={18} remote={group.computerId ?? false} />
      <h3 className="min-w-0 truncate text-ui font-semibold">{group.name}</h3>
      <span className="shrink-0 text-meta text-muted">
        {plural(group.sessions, 'session')} · {formatWorked(group.activeMs)}
      </span>
    </>
  );
  const space = first ? '' : 'pt-4';
  if (!onToggle) {
    return (
      <div className={space} data-activity-project={group.name}>
        <div className="flex min-w-0 items-center gap-2 px-2.5 pb-1">{name}</div>
      </div>
    );
  }
  return (
    <div className={`${open ? space : ''} pb-0.5`} data-activity-project={group.name}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-border/45" data-activity-project-toggle>
        <ChevronDown size={13} className={`shrink-0 text-faint transition-transform motion-reduce:transition-none ${open ? '' : '-rotate-90'}`} aria-hidden />
        {name}
      </button>
    </div>
  );
}

/** Opens a session from its row: its pane here, or on the computer it ran on. */
function openRow(row: ActivityRow): void {
  if (row.computer) useComputers.getState().openSession({ computerId: row.computer.id, sessionId: row.sessionId });
  else useSessions.getState().select(row.sessionId);
}

function SessionRow({ row, needsYou, span, today }: { row: ActivityRow; needsYou: boolean; span: ActivitySpan; today: string }) {
  const key = `${row.day}:${rowKey(row)}`;
  const open = useActivity((s) => s.expanded.has(key));
  const lines = row.did.length ? row.did : row.asks.slice(0, 6);
  const prs = rowPrs(row.prs);
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
        {prs.named.map((pr) => (
          <Pill key={pr.url} tone="muted" icon={<GitPullRequest size={12} aria-hidden />} data-activity-pr={pr.number}>
            #{pr.number}
          </Pill>
        ))}
        {prs.rest.length > 0 && (
          <Pill tone="muted" aria-label={plural(prs.rest.length, 'more pull request')} data-tooltip={prs.rest.map((pr) => `#${pr.number}`).join(', ')} data-activity-prs-more={prs.rest.length}>
            +{prs.rest.length}
          </Pill>
        )}
        {needsYou && (
          <Pill tone="warn" data-activity-needs-you>
            needs you
          </Pill>
        )}
        <span className="w-30 shrink-0 text-right text-meta whitespace-nowrap text-muted tabular-nums">
          {span === 'day' ? clock.format(row.firstAt) : span === 'week' ? `${weekdayShort(row.day)} ${dayNumber(row.day)}` : dayLabel(row.day, today)}
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

type Line = { kind: 'project'; group: ProjectGroup; first: boolean; open: boolean } | { kind: 'session'; row: ActivityRow };

function WhatYouDid({ rows, known, span, today, scroller }: { rows: readonly ActivityRow[]; known: readonly ActivityRow[]; span: ActivitySpan; today: string; scroller: RefObject<HTMLElement | null> }) {
  // A day's row is one session on that day; over a week or a range a session of several days is one row.
  const groups = useMemo(() => projectGroups(span === 'day' ? rows : sessionsOnce(rows), known), [rows, known, span]);
  const picked = useActivity((s) => s.project?.key);
  const openProjects = useActivity((s) => s.openProjects);
  // A range starts with only the projects: it can hold two months of sessions. A project picked in the bars is what you asked to see.
  const collapsible = span === 'range' && !picked;
  const lines = useMemo(
    () =>
      groups.flatMap((group, i): Line[] => {
        const open = !collapsible || openProjects.has(group.key);
        return [{ kind: 'project', group, first: i === 0, open }, ...(open ? group.rows.map((row): Line => ({ kind: 'session', row })) : [])];
      }),
    [groups, collapsible, openProjects],
  );
  // What needs you now, on this computer: the same list as Home's.
  const sessions = useSessions((s) => s.sessions);
  const live = useSessions((s) => s.live);
  const hosts = useHosts((s) => s.hosts);
  const needs = useMemo(() => new Set(homeSessions(toRows(sessions, live, hosts)).needs.map((row) => row.id)), [sessions, live, hosts]);

  // Virtualised only for long lists; the page scrolls, so the list's place in it is the scroll margin. What is above it can grow.
  const list = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const virtual = lines.length > VIRTUALIZE_FROM;
  useLayoutEffect(() => {
    const el = scroller.current;
    const content = el?.firstElementChild;
    if (!virtual || !el || !content) return;
    const place = () => setScrollMargin(list.current ? list.current.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop : 0);
    place();
    const observer = new ResizeObserver(place);
    observer.observe(content);
    return () => observer.disconnect();
  }, [virtual, scroller]);
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => (lines[i]!.kind === 'project' ? 44 : 36),
    getItemKey: (i) => {
      const line = lines[i]!;
      return line.kind === 'project' ? `project:${line.group.key}` : `${line.row.day}:${rowKey(line.row)}`;
    },
    overscan: 8,
    scrollMargin,
    enabled: virtual,
    // Turned on by a click that makes the list long, it goes to this offset: without it that is the top of the page.
    initialOffset: () => scroller.current?.scrollTop ?? 0,
  });

  const renderLine = (line: Line) =>
    line.kind === 'project' ? (
      <ProjectHeader group={line.group} first={line.first} open={line.open} onToggle={collapsible ? () => useActivity.getState().toggleOpenProject(line.group.key) : null} />
    ) : (
      <SessionRow row={line.row} span={span} today={today} needsYou={!line.row.computer && needs.has(line.row.sessionId)} />
    );

  return (
    <section aria-labelledby="activity-did" className="grid grid-cols-[minmax(0,1fr)] gap-3" data-activity-list>
      <SectionHeader as="h2" headingId="activity-did">
        What you did
      </SectionHeader>
      <div ref={list} className="min-w-0">
        {virtual ? (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => (
              <div key={item.key} data-index={item.index} ref={virtualizer.measureElement} style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${item.start - scrollMargin}px)` }}>
                {renderLine(lines[item.index]!)}
              </div>
            ))}
          </div>
        ) : (
          lines.map((line) => <div key={line.kind === 'project' ? `project:${line.group.key}` : `${line.row.day}:${rowKey(line.row)}`}>{renderLine(line)}</div>)
        )}
      </div>
    </section>
  );
}
