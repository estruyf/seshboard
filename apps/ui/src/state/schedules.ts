import { describe, formatDay, formatNext, formatPast, nextRuns, ruleProblem, speakDay, speakNext, type Schedule, type ScheduleRepeat, type ScheduleRule } from '@seshboard/protocol/client';

// Scheduled sessions (#173) as the windows show them, without React or the stores: a row's lines, its label for screen
// readers, and the dialog's rule and checks. The rules themselves are the protocol's (`schedules.ts`).

/** A line on a schedule's row, in the tone it is shown in (`caution` for something to look at). */
export interface ScheduleLine {
  text: string;
  tone: 'muted' | 'caution';
  /** The last run's session, to link to. */
  sessionId?: string | null;
  /** A check after it: the run started. */
  check?: boolean;
}

/** How the last run went, or null before the first. "Last: Mon 19 Oct" links to its session. */
export function lastRunLine(schedule: Schedule, now: number): ScheduleLine | null {
  const run = schedule.lastRun;
  if (!run) return null;
  switch (run.result) {
    case 'started':
      return { text: `Last: ${formatDay(run.at)}`, tone: 'muted', sessionId: run.sessionId, check: true };
    case 'queued':
      return { text: `Queued ${formatPast(run.at, now)}${run.reason ? `: ${run.reason}` : ''}`, tone: 'muted' };
    case 'skipped':
      return { text: `Skipped ${formatPast(run.at, now)}${run.reason ? `: ${run.reason}` : ''}`, tone: 'caution', sessionId: run.sessionId };
    case 'missed':
      return { text: `Missed ${formatPast(run.at, now)}`, tone: 'caution' };
    case 'failed':
      return run.reason === 'Folder not found' ? { text: 'Folder not found', tone: 'caution' } : { text: `Didn't start ${formatPast(run.at, now)}${run.reason ? `: ${run.reason}` : ''}`, tone: 'caution' };
  }
}

/** The next run, or "Paused" (with Seshboard's reason when it paused it). */
export function nextRunLine(schedule: Schedule, now: number): ScheduleLine | null {
  if (schedule.paused) return { text: schedule.pausedReason && schedule.pausedReason !== 'Folder not found' ? `Paused · ${schedule.pausedReason}` : 'Paused', tone: 'caution' };
  const [next] = nextRuns(schedule.rule, now, 1);
  if (!next && schedule.rule.kind === 'once') return { text: 'Done', tone: 'muted' };
  return next ? { text: `Next: ${formatNext(next, now)}`, tone: 'muted' } : null;
}

/** The session a busy last run is in: still working, waiting for you, or done. */
export type LastRunState = 'working' | 'waiting' | null;

/**
 * A row for screen readers: "Review open pull requests, weekdays at 08:00, next tomorrow at 08:00, last run Monday 19
 * October finished".
 */
export function scheduleLabel(schedule: Schedule, now: number, lastState: LastRunState = null): string {
  const rule = describe(schedule.rule);
  const parts = [schedule.name, rule.charAt(0).toLowerCase() + rule.slice(1)];
  const [next] = schedule.paused ? [] : nextRuns(schedule.rule, now, 1);
  parts.push(schedule.paused ? `paused${schedule.pausedReason ? `, ${schedule.pausedReason.toLowerCase()}` : ''}` : next ? `next ${speakNext(next, now)}` : 'no next run');
  const run = schedule.lastRun;
  if (run) {
    const how =
      run.result === 'started'
        ? lastState === 'working'
          ? 'working'
          : lastState === 'waiting'
            ? 'waiting for you'
            : 'finished'
        : run.result === 'queued'
          ? 'queued'
          : run.result === 'skipped'
            ? `skipped, ${run.reason ?? 'the last run was still working'}`
            : run.result === 'missed'
              ? 'missed'
              : `didn't start, ${(run.reason ?? 'unknown').toLowerCase()}`;
    parts.push(`last run ${speakDay(run.at)} ${how}`);
  }
  return parts.join(', ');
}

/** The dialog's Repeat choices, in the order the control shows them. */
export type RepeatKind = ScheduleRepeat['kind'];
export const REPEAT_LABELS: Record<RepeatKind, string> = { once: 'Once', daily: 'Every day', weekdays: 'Monday to Friday', weekly: 'Every week', monthly: 'Every month' };

/** The dialog's fields, kept apart so switching Repeat back and forth keeps the days and the day of the month. */
export interface ScheduleForm {
  name: string;
  repeat: RepeatKind;
  /** Every week's days (`getDay()` numbers). */
  days: number[];
  /** Every month's day, as typed. */
  monthDay: string;
  /** Once's date, as `YYYY-MM-DD`. */
  date: string;
  time: string;
  missed: 'run' | 'skip';
}

const pad = (n: number) => String(n).padStart(2, '0');
const dateOf = (at: Date) => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
const clockOf = (at: Date) => `${pad(at.getHours())}:${pad(at.getMinutes())}`;

/** Once's date and time, an hour from `now` (rounded up to the minute). */
export function inOneHour(now: number): Pick<ScheduleForm, 'date' | 'time'> {
  const at = new Date(Math.ceil((now + 3_600_000) / 60_000) * 60_000);
  return { date: dateOf(at), time: clockOf(at) };
}

/** A new schedule's fields: today's day of the week and of the month, at 08:00; Once is an hour from now. */
export function newForm(name: string, now: number): ScheduleForm {
  const today = new Date(now);
  return { name, repeat: 'weekdays', days: [today.getDay()], monthDay: String(today.getDate()), date: inOneHour(now).date, time: '08:00', missed: 'run' };
}

/** A schedule's fields, to change it. */
export function formOf(schedule: Schedule, now: number): ScheduleForm {
  const base = newForm(schedule.name, now);
  const { rule } = schedule;
  return {
    ...base,
    repeat: rule.kind,
    days: rule.kind === 'weekly' ? [...rule.days] : base.days,
    monthDay: rule.kind === 'monthly' ? String(rule.day) : base.monthDay,
    date: rule.kind === 'once' ? rule.date : base.date,
    time: rule.time,
    missed: schedule.missed,
  };
}

/** The rule the fields make. */
export function ruleOf(form: ScheduleForm): ScheduleRule {
  switch (form.repeat) {
    case 'once':
      return { kind: 'once', date: form.date, time: form.time };
    case 'daily':
      return { kind: 'daily', time: form.time };
    case 'weekdays':
      return { kind: 'weekdays', time: form.time };
    case 'weekly':
      return { kind: 'weekly', days: [...form.days].sort((a, b) => a - b), time: form.time };
    case 'monthly':
      return { kind: 'monthly', day: /^\d{1,2}$/.test(form.monthDay.trim()) ? Number(form.monthDay.trim()) : NaN, time: form.time };
  }
}

/** Why the dialog can't save yet, in words; null when it can. */
export function formProblem(form: ScheduleForm, now: number): string | null {
  if (!form.name.trim()) return 'Give it a name.';
  if (form.name.trim().length > 200) return 'Use a shorter name.';
  const rule = ruleOf(form);
  const problem = ruleProblem(rule);
  if (problem) return problem;
  // A run in the past would never happen.
  if (rule.kind === 'once' && nextRuns(rule, now, 1).length === 0) return 'Pick a time that is still to come.';
  return null;
}

/** Turns a day of the week on or off. */
export const toggleDay = (days: readonly number[], day: number) => (days.includes(day) ? days.filter((d) => d !== day) : [...days, day]);
