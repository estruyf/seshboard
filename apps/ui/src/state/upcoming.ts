import { DAY_NAMES, DAY_SHORT, formatDay, formatRun, nextRuns, oneTimeDone, projectOf, speakDay, type Schedule, type UpcomingRun } from '@switchboard/protocol/client';

// Upcoming: one view for everything queued and scheduled. Its logic without React or the stores: the day groups of the
// timeline and their folding, the sidebar entry's hint and count, and the filters. The runs come from the protocol's
// `upcomingRuns`, so they are the timer's.

/** How far the timeline looks ahead, in days after today. */
export const UPCOMING_DAYS = 7;
/** How far History looks back, in days before today. */
export const HISTORY_DAYS = 7;

/** Which cards show: everything, only the queue, the two schedule cards, or the triggers. */
export type UpcomingKind = 'all' | 'queue' | 'schedules' | 'triggers';
/** The view's filters: by type, and by project (a project's root, null for all). */
export interface UpcomingFilter {
  kind: UpcomingKind;
  project: string | null;
}
export const DEFAULT_FILTER: UpcomingFilter = { kind: 'all', project: null };

const pad = (n: number) => String(n).padStart(2, '0');
/** "08:00": a run's time, as the timeline shows it. */
export const runClock = (at: number) => {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** A local day as a key: `2026-10-19`. */
const dayKey = (at: number) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** Whole local days from `now`'s date to `at`'s: 0 today, 1 tomorrow. */
function dayDiff(at: number, now: number): number {
  const a = new Date(at);
  const b = new Date(now);
  return Math.round((Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) - Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / 86_400_000);
}

/** A day in the timeline with its runs. */
export interface UpcomingDay {
  kind: 'day';
  key: string;
  /** Its midnight, local. */
  at: number;
  /** "Today · Mon 19 Oct", "Tomorrow · Tue 20 Oct", "Wed 21 Oct". */
  label: string;
  /** For screen readers: "Today, Monday 19 October". */
  spoken: string;
  /** Today or tomorrow (Tomorrow's heading is in `text`, the others muted); null for the days after. */
  near: 'today' | 'tomorrow' | null;
  runs: UpcomingRun[];
}
/** Days in a row with exactly the same runs as the day shown above them, folded into one line. */
export interface UpcomingFold {
  kind: 'fold';
  key: string;
  /** "Thu 22 Oct · Fri 23 Oct", or "Thu 22 Oct to Sat 24 Oct" for more than two. */
  label: string;
  spoken: string;
  /** "2×": how many runs each day has. */
  count: string;
  /** "Review open pull requests and Standup summary, each day". */
  text: string;
  days: UpcomingDay[];
}
export type UpcomingGroup = UpcomingDay | UpcomingFold;

/** A day's runs as a signature: the same schedules at the same times, none skipped. */
const signature = (day: UpcomingDay) => (day.runs.some((r) => r.skipped) ? null : day.runs.map((r) => `${r.scheduleId}@${runClock(r.at)}`).join('|'));

/** "A", "A and B", "A, B and C". */
function andList(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The timeline's runs by day, in order. From the day after tomorrow on, two or more days in a row (calendar days, one
 * after the other) whose runs are exactly those of the day shown above them fold into one line. Today and tomorrow
 * never fold, and don't count as the day above. `names` gives a schedule's name for the fold's text.
 */
export function dayGroups(runs: readonly UpcomingRun[], now: number, names: (scheduleId: string) => string): UpcomingGroup[] {
  const days: UpcomingDay[] = [];
  for (const run of runs) {
    const key = dayKey(run.at);
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      const d = new Date(run.at);
      const at = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const diff = dayDiff(at, now);
      const near = diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : null;
      const word = near === 'today' ? 'Today' : near === 'tomorrow' ? 'Tomorrow' : null;
      day = { kind: 'day', key, at, label: word ? `${word} · ${formatDay(at)}` : formatDay(at), spoken: word ? `${word}, ${speakDay(at)}` : speakDay(at), near, runs: [] };
      days.push(day);
    }
    day.runs.push(run);
  }

  const out: UpcomingGroup[] = [];
  /** The last day shown in full, from the day after tomorrow on: what a fold repeats. */
  let shown: UpcomingDay | null = null;
  for (let i = 0; i < days.length; i++) {
    const day = days[i]!;
    const sig = signature(day);
    if (day.near || !shown || sig === null || sig !== signature(shown) || !nextDay(shown, day)) {
      out.push(day);
      shown = day.near ? null : day;
      continue;
    }
    // The run of days that repeat `shown`, each the calendar day after the one before.
    const folded = [day];
    while (i + 1 < days.length && signature(days[i + 1]!) === sig && nextDay(folded[folded.length - 1]!, days[i + 1]!)) folded.push(days[++i]!);
    if (folded.length < 2) {
      out.push(day);
      shown = day;
      continue;
    }
    const first = folded[0]!;
    const last = folded[folded.length - 1]!;
    const names_ = [...new Set(day.runs.map((r) => names(r.scheduleId)))];
    out.push({
      kind: 'fold',
      key: `fold-${first.key}`,
      label: folded.length === 2 ? `${formatDay(first.at)} · ${formatDay(last.at)}` : `${formatDay(first.at)} to ${formatDay(last.at)}`,
      spoken: `${speakDay(first.at)} to ${speakDay(last.at)}`,
      count: `${day.runs.length}×`,
      text: `${andList(names_)}, each day`,
      days: folded,
    });
  }
  return out;
}

/** `b` is the calendar day after `a`. */
const nextDay = (a: UpcomingDay, b: UpcomingDay) => {
  const d = new Date(a.at);
  return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()) === b.key;
};

/** A run's label for screen readers: "Tuesday 20 October, 08:00, Review open pull requests, worklog-web". */
export const runLabel = (at: number, name: string, project: string) => `${speakDay(at)}, ${runClock(at)}, ${name}, ${project}`;

/** The toast after Skip this run: "Skipped Tue 20 Oct 08:00 of Review open pull requests." */
export const skippedToast = (at: number, name: string) => `Skipped ${formatRun(at)} of ${name}.`;

/** The sidebar entry's hint: "1 ready" (ok), else the next run, else nothing; "nothing planned" with nothing at all. */
export interface UpcomingHint {
  text: string;
  tone: 'ok' | 'muted';
}

/**
 * What the Upcoming entry says before its count, in this order: queued items that are ready ("1 ready", in `ok`), the
 * next scheduled run ("next 08:00" today, "next Tue 08:00" this week, "next Mon 26 Oct 08:00" further), nothing. With
 * nothing queued and no schedules, "nothing planned" (muted).
 */
export function upcomingHint(options: { ready: number; nextRun: number | null; count: number; now: number }): UpcomingHint | null {
  const { ready, nextRun, count, now } = options;
  if (count === 0) return { text: 'nothing planned', tone: 'muted' };
  if (ready > 0) return { text: `${ready} ready`, tone: 'ok' };
  if (nextRun === null) return null;
  const diff = dayDiff(nextRun, now);
  if (diff === 0) return { text: `next ${runClock(nextRun)}`, tone: 'muted' };
  if (diff > 0 && diff < 7) return { text: `next ${DAY_SHORT[new Date(nextRun).getDay()]} ${runClock(nextRun)}`, tone: 'muted' };
  return { text: `next ${formatRun(nextRun)}`, tone: 'muted' };
}

/** The entry's label for screen readers: "Upcoming, 7 planned, next at 08:00", "Upcoming, 1 ready", "Upcoming, nothing planned". */
export function upcomingNavLabel(options: { ready: number; nextRun: number | null; count: number; now: number }): string {
  const { ready, nextRun, count, now } = options;
  if (count === 0) return 'Upcoming, nothing planned';
  const parts = ['Upcoming', `${count} planned`];
  if (ready > 0) parts.push(`${ready} ready`);
  else if (nextRun !== null) {
    const diff = dayDiff(nextRun, now);
    parts.push(diff === 0 ? `next at ${runClock(nextRun)}` : diff > 0 && diff < 7 ? `next ${DAY_NAMES[new Date(nextRun).getDay()]} at ${runClock(nextRun)}` : `next ${speakDay(nextRun)} at ${runClock(nextRun)}`);
  }
  return parts.join(', ');
}

/** The next run of any active schedule that you haven't skipped, or null. */
export function nextScheduledRun(schedules: readonly Pick<Schedule, 'rule' | 'paused' | 'skippedRuns'>[], now: number): number | null {
  let next: number | null = null;
  for (const schedule of schedules) {
    if (schedule.paused) continue;
    const skipped = new Set(schedule.skippedRuns);
    const at = nextRuns(schedule.rule, now, 32).find((run) => !skipped.has(run.toISOString()))?.getTime();
    if (at !== undefined && (next === null || at < next)) next = at;
  }
  return next;
}

/** A one-time schedule (Once) whose run has passed: it won't run again, and only History shows it. */
export const scheduleDone = (schedule: Pick<Schedule, 'rule'>, now: number) => oneTimeDone(schedule.rule, now);

/** The schedules the lists show: all but the one-time ones that have run. */
export const listedSchedules = <T extends Pick<Schedule, 'rule'>>(schedules: readonly T[], now: number): T[] => schedules.filter((s) => !scheduleDone(s, now));

/** The entry's count: queued items plus active schedules (not paused, and not a one-time one that has run). */
export const upcomingCount = (queued: number, schedules: readonly Pick<Schedule, 'paused' | 'rule'>[], now: number) => queued + schedules.filter((s) => !s.paused && !scheduleDone(s, now)).length;

/** In the project filter: a path is in the picked project (its root, or a worktree of it). Null picks all. */
export const inProject = (cwd: string, project: string | null) => project === null || projectOf(cwd) === project;

/** One line of the project filter's menu: a project with what it has queued and scheduled. */
export interface ProjectCount {
  root: string;
  queued: number;
  schedules: number;
}

/**
 * The projects that have something queued or scheduled, or a trigger, with their counts, by name (`name` gives a
 * root's).
 */
export function projectCounts(queued: readonly { cwd: string }[], schedules: readonly { draft: { cwd: string } }[], name: (root: string) => string = (root) => root, triggers: readonly { projectRoot: string }[] = []): ProjectCount[] {
  const counts = new Map<string, ProjectCount>();
  const get = (root: string) => counts.get(root) ?? counts.set(root, { root, queued: 0, schedules: 0 }).get(root)!;
  for (const item of queued) get(projectOf(item.cwd)).queued++;
  for (const schedule of schedules) get(projectOf(schedule.draft.cwd)).schedules++;
  for (const trigger of triggers) get(projectOf(trigger.projectRoot));
  return [...counts.values()].sort((a, b) => name(a.root).localeCompare(name(b.root)) || a.root.localeCompare(b.root));
}

/** Which cards the view shows for a filter. */
export function visibleCards(kind: UpcomingKind): { queue: boolean; runs: boolean; schedules: boolean; triggers: boolean } {
  return { queue: kind === 'all' || kind === 'queue', runs: kind === 'all' || kind === 'schedules', schedules: kind === 'all' || kind === 'schedules', triggers: kind === 'all' || kind === 'triggers' };
}

/** A filter read back from the window's prefs; anything unreadable is the default. */
export function readFilter(value: unknown): UpcomingFilter {
  const v = value as Partial<UpcomingFilter> | null;
  const kind = v?.kind === 'queue' || v?.kind === 'schedules' || v?.kind === 'triggers' ? v.kind : 'all';
  return { kind, project: typeof v?.project === 'string' && v.project ? v.project : null };
}
