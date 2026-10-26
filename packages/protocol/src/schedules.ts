// Scheduled sessions (#173): the rules, without zod, React or the engine. A rule says on which days and at what local
// time a schedule runs; everything here works in the computer's local time, so a run follows a time zone or DST change.
// Shared: the engine decides when a run is due, and the UI shows the rule in words and the next runs.

/**
 * On which days a schedule runs. Days of the week are numbered as `Date.getDay()` does: 0 Sunday to 6 Saturday. `once`
 * runs on one local date (`YYYY-MM-DD`) and never again.
 */
export type ScheduleRepeat = { kind: 'once'; date: string } | { kind: 'daily' } | { kind: 'weekdays' } | { kind: 'weekly'; days: number[] } | { kind: 'monthly'; day: number };

/** A schedule's rule: the days, and the local time as `HH:MM` (24-hour). */
export type ScheduleRule = ScheduleRepeat & { time: string };

/** What a schedule does with runs that were due while Seshboard was closed or the computer slept. */
export type ScheduleMissed = 'run' | 'skip';

/**
 * How a run ended. `started`: a new session. `queued`: it went to the queue at a limit. `skipped`: the last run was still
 * busy. `missed`: it was due while Seshboard was closed (Skip it). `failed`: it couldn't start (the folder is gone).
 */
export type ScheduleRunResult = 'started' | 'queued' | 'skipped' | 'missed' | 'failed';

import type { Schedule, ScheduleLastRun } from './scheduleSchema.ts';

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** Short and full day names, by `getDay()`. */
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const DAY_PLURAL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'] as const;
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

/** The days of the week in the order the week is shown: Monday first. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** `08:00` as hours and minutes; null when it isn't a valid 24-hour time. */
export function parseTime(time: string): { hours: number; minutes: number } | null {
  const match = TIME.exec(time);
  return match ? { hours: Number(match[1]), minutes: Number(match[2]) } : null;
}

/** `2026-10-19` as a local year, month (0-11) and day; null when it isn't a real date. */
export function parseDate(date: string): { year: number; month: number; date: number } | null {
  const match = DATE.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const check = new Date(year, month, day);
  return check.getFullYear() === year && check.getMonth() === month && check.getDate() === day ? { year, month, date: day } : null;
}

/** Why a rule can't be saved, in words for the dialog; null when it is fine. */
export function ruleProblem(rule: ScheduleRule): string | null {
  if (!parseTime(rule.time)) return 'Pick a time.';
  if (rule.kind === 'once' && !parseDate(rule.date)) return 'Pick a date.';
  if (rule.kind === 'weekly') {
    if (rule.days.length === 0) return 'Pick at least one day.';
    if (rule.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return 'Pick days of the week.';
  }
  if (rule.kind === 'monthly' && (!Number.isInteger(rule.day) || rule.day < 1 || rule.day > 31)) return 'Pick a day from 1 to 31.';
  return null;
}

const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

/** Whether the rule runs on this local date. */
function runsOn(rule: ScheduleRule, year: number, month: number, date: number): boolean {
  const weekday = new Date(year, month, date).getDay();
  switch (rule.kind) {
    case 'once':
      return rule.date === `${year}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
    case 'daily':
      return true;
    case 'weekdays':
      return weekday >= 1 && weekday <= 5;
    case 'weekly':
      return rule.days.includes(weekday);
    case 'monthly':
      // Day 31 in a 30-day month (or 29 in a short February) runs on the month's last day.
      return date === Math.min(rule.day, daysInMonth(year, month));
  }
}

/**
 * The moment a local wall-clock time happens on a date. On the day DST springs forward, a time in the gap (02:30) doesn't
 * exist: it runs at the first valid time after it, the moment the clocks jump (03:00). On the day it falls back, a time
 * that happens twice runs at the first one (JavaScript picks the earlier of the two).
 */
export function localMoment(year: number, month: number, date: number, hours: number, minutes: number): number {
  const at = new Date(year, month, date, hours, minutes);
  if (at.getDate() === date && at.getHours() === hours && at.getMinutes() === minutes) return at.getTime();
  // In the gap: JavaScript moved it forward by the gap's length. Walk back to the first minute that is past the asked
  // time on the clock, which is the moment the clocks jumped. Gaps are an hour or less, so this stays short.
  const wanted = hours * 60 + minutes;
  let t = at.getTime();
  for (let i = 0; i < 180; i++) {
    const before = new Date(t - 60_000);
    if (before.getDate() !== date || before.getHours() * 60 + before.getMinutes() < wanted) break;
    t -= 60_000;
  }
  return t;
}

/**
 * The next `count` runs strictly after `from` (a timestamp), in order. Empty for a rule that can't be saved. Each run is
 * the rule's local time on a day it runs, so a run that DST or a time zone moves stays at the same time on the clock.
 */
export function nextRuns(rule: ScheduleRule, from: number | Date, count: number): Date[] {
  const time = parseTime(rule.time);
  if (!time || ruleProblem(rule) || count <= 0) return [];
  const start = new Date(typeof from === 'number' ? from : from.getTime());
  const after = start.getTime();
  if (rule.kind === 'once') {
    // One date, however far away: no walk through the days.
    const day = parseDate(rule.date)!;
    const at = localMoment(day.year, day.month, day.date, time.hours, time.minutes);
    return at > after ? [new Date(at)] : [];
  }
  const out: Date[] = [];
  // Days are walked by the calendar (not by adding 24 hours), so a 23- or 25-hour day doesn't skip or repeat one.
  // Two years is enough to find a run of any rule that can be saved.
  for (let offset = 0; offset < 800 && out.length < count; offset++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
    const [y, m, d] = [day.getFullYear(), day.getMonth(), day.getDate()];
    if (!runsOn(rule, y, m, d)) continue;
    const at = localMoment(y, m, d, time.hours, time.minutes);
    if (at > after) out.push(new Date(at));
  }
  return out;
}

/** The runs in `(after, until]`, oldest first: the ones that were due between two moments. Capped at `limit`. */
export function runsBetween(rule: ScheduleRule, after: number, until: number, limit = 1_000): Date[] {
  const out: Date[] = [];
  let from = after;
  while (out.length < limit) {
    const [next] = nextRuns(rule, from, 1);
    if (!next || next.getTime() > until) break;
    out.push(next);
    from = next.getTime();
  }
  return out;
}

/** 1st, 2nd, 3rd, 4th, … 11th, 12th, 13th, … 21st, 22nd, 23rd, … 31st. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

/** "Mondays", "Mondays and Thursdays", "Mondays, Wednesdays and Fridays", in the week's order (Monday first). */
function dayList(days: readonly number[]): string {
  const names = WEEK_ORDER.filter((d) => days.includes(d)).map((d) => DAY_PLURAL[d]);
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The rule in words: "Every day at 08:00", "Weekdays at 08:00", "Mondays and Thursdays at 09:30", "On the 1st at 10:00". */
export function describe(rule: ScheduleRule): string {
  const at = `at ${rule.time}`;
  switch (rule.kind) {
    case 'once': {
      const day = parseDate(rule.date);
      return day ? `Once on ${formatDay(new Date(day.year, day.month, day.date))} ${at}` : `Once ${at}`;
    }
    case 'daily':
      return `Every day ${at}`;
    case 'weekdays':
      return `Weekdays ${at}`;
    case 'weekly': {
      const days = new Set(rule.days);
      if (days.size === 7) return `Every day ${at}`;
      if (days.size === 5 && [1, 2, 3, 4, 5].every((d) => days.has(d))) return `Weekdays ${at}`;
      return `${dayList([...days])} ${at}`;
    }
    case 'monthly':
      return `On the ${ordinal(rule.day)} ${at}`;
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
/** Whole local days from `now`'s date to `date`'s: 0 today, 1 tomorrow, -1 yesterday. */
function dayDiff(date: Date, now: Date): number {
  const a = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / DAY_MS);
}

/** "Mon 19 Oct": a run's day, as in a run's title ("Review open pull requests · Mon 19 Oct") and Last. */
export function formatDay(date: Date | number): string {
  const d = new Date(date);
  return `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
}

/** "Mon 19 Oct 08:00": a run's day and time, as on the dialog's next-runs chips. */
export function formatRun(date: Date | number): string {
  const d = new Date(date);
  return `${formatDay(d)} ${clock(d)}`;
}

/**
 * When the next run is, from `now`: "Today 08:00", "Tomorrow 08:00", "Thu 08:00" within the week, or "Mon 26 Oct 09:30"
 * when it is further away.
 */
export function formatNext(date: Date | number, now: Date | number): string {
  const d = new Date(date);
  const diff = dayDiff(d, new Date(now));
  if (diff === 0) return `Today ${clock(d)}`;
  if (diff === 1) return `Tomorrow ${clock(d)}`;
  if (diff > 1 && diff < 7) return `${DAY_SHORT[d.getDay()]} ${clock(d)}`;
  return formatRun(d);
}

/** A past run's time: "Mon 08:45" within the last week, else "Mon 19 Oct 08:45" (Skipped and Missed on a row). */
export function formatPast(date: Date | number, now: Date | number): string {
  const d = new Date(date);
  const diff = dayDiff(d, new Date(now));
  return diff <= 0 && diff > -7 ? `${DAY_SHORT[d.getDay()]} ${clock(d)}` : formatRun(d);
}

/** For screen readers: "tomorrow at 08:00", "Thursday at 08:00", "Monday 26 October at 09:30". */
export function speakNext(date: Date | number, now: Date | number): string {
  const d = new Date(date);
  const diff = dayDiff(d, new Date(now));
  if (diff === 0) return `today at ${clock(d)}`;
  if (diff === 1) return `tomorrow at ${clock(d)}`;
  if (diff > 1 && diff < 7) return `${DAY_NAMES[d.getDay()]} at ${clock(d)}`;
  return `${speakDay(d)} at ${clock(d)}`;
}

/** For screen readers: "Monday 19 October". */
export function speakDay(date: Date | number): string {
  const d = new Date(date);
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

/** A run's session title: "Review open pull requests · Mon 19 Oct". */
export const runTitle = (name: string, at: Date | number) => `${name} · ${formatDay(at)}`;

/** A schedule's name from a prompt: its first line that has text, cut at a word near 80 characters. */
export function nameFromPrompt(prompt: string, max = 80): string {
  const line = prompt.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The reason a run you skipped (Skip this run) is recorded with. */
export const SKIPPED_BY_YOU = 'Skipped by you';

/** A one-time schedule (Once) whose run has passed: it won't run again. */
export function oneTimeDone(rule: ScheduleRule, now: number): boolean {
  return rule.kind === 'once' && nextRuns(rule, now, 1).length === 0;
}

/** A run still to come in Upcoming's timeline. `skipped`: you skipped it (Skip this run). */
export interface UpcomingRun {
  scheduleId: string;
  /** When it runs. */
  at: number;
  /** The schedule's folder, the project it runs in. */
  cwd: string;
  skipped: boolean;
}

/** A run that happened, in Upcoming's History: when, where, and how it went. */
export interface PastRun {
  scheduleId: string;
  at: number;
  cwd: string;
  run: ScheduleLastRun;
}

type Listed = Pick<Schedule, 'id' | 'rule' | 'paused' | 'draft' | 'runs' | 'skippedRuns' | 'lastRun'>;

/**
 * The runs still to come from `from` to the end of the `days`th day after it, in time order: Upcoming's timeline.
 * Paused schedules are left out. They come from `nextRuns`, so DST and short months are the timer's.
 */
export function upcomingRuns(schedules: readonly Listed[], from: number, days: number): UpcomingRun[] {
  const now = new Date(from);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days + 1).getTime();
  const out: UpcomingRun[] = [];
  for (const schedule of schedules) {
    if (schedule.paused) continue;
    const skipped = new Set(schedule.skippedRuns);
    for (const at of runsBetween(schedule.rule, from, end - 1, (days + 1) * 4 + 64)) {
      out.push({ scheduleId: schedule.id, at: at.getTime(), cwd: schedule.draft.cwd, skipped: skipped.has(at.toISOString()) });
    }
  }
  return out.sort((a, b) => a.at - b.at || a.scheduleId.localeCompare(b.scheduleId));
}

/**
 * The runs that happened from the start of the day `days` days before `from` until `from`, newest first: Upcoming's
 * History. Every schedule counts, paused and one-time ones that are done too. A schedule's runs come from its run
 * history, or its last run when that is empty (recorded before schedules kept their runs).
 */
export function pastRuns(schedules: readonly Listed[], from: number, days: number): PastRun[] {
  const now = new Date(from);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days).getTime();
  const out: PastRun[] = [];
  for (const schedule of schedules) {
    const runs = schedule.runs.length > 0 ? schedule.runs : schedule.lastRun ? [schedule.lastRun] : [];
    for (const run of runs) if (run.at >= start && run.at <= from) out.push({ scheduleId: schedule.id, at: run.at, cwd: schedule.draft.cwd, run });
  }
  return out.sort((a, b) => b.at - a.at || a.scheduleId.localeCompare(b.scheduleId));
}
