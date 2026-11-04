import { DAY_SHORT, formatRun, nextRuns, promptLabel, type QueueEntry, type Schedule, type TriggerEvent } from '@seshboard/protocol/client';
import type { SessionRowData } from '../../state/sessionsStore.ts';
import { isActive, rowStatus, workingSince } from '../../state/sidebarRows.ts';
import { dayDiff, runClock } from '../../state/upcoming.ts';

/**
 * The sessions Home shows: those waiting for you (longest wait first, as the most overdue) and those
 * Claude is working on (the one you set going last first, so they don't trade places as they write). Pass the rows the sidebar lists.
 */
export function homeSessions(rows: readonly SessionRowData[]): { needs: SessionRowData[]; working: SessionRowData[] } {
  const needs = rows.filter((row) => row.live?.status === 'needs-you').sort((a, b) => a.updatedAt - b.updatedAt);
  const working = rows.filter((row) => row.live?.status === 'running').sort((a, b) => workingSince(b) - workingSince(a));
  return { needs, working };
}

const sessions = (n: number) => `${n} ${n === 1 ? 'session' : 'sessions'}`;

/** "Good morning" until noon, "Good afternoon" until six, "Good evening" after (and in the small hours), by the local time. */
export function greeting(now: number): string {
  const hour = new Date(now).getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * The line under the greeting, in plain words: what needs you first, then what is working, then what is left to review
 * ("2 sessions are working. Nothing needs you. 2 to review."). It always says whether something needs you, since the
 * Needs you lane is left out when it is empty and there is no room for it.
 */
export function homeSummary(needs: number, working: number, review = 0): string {
  const verb = (n: number, one: string, many: string) => (n === 1 ? one : many);
  const reviewPart = review ? ` ${review} to review.` : '';
  if (needs && working) return `${sessions(needs)} ${verb(needs, 'needs', 'need')} you. ${working} ${verb(working, 'is', 'are')} working.${reviewPart}`;
  if (needs) return `${sessions(needs)} ${verb(needs, 'needs', 'need')} you.${reviewPart}`;
  if (working) return `${sessions(working)} ${verb(working, 'is', 'are')} working. Nothing needs you.${reviewPart}`;
  if (review) return `Nothing needs you.${reviewPart}`;
  return 'Nothing needs you. Start a session, or pick one in the sidebar.';
}

/** How many To review cards Home shows; "All N to review…" goes to the rest. */
export const REVIEW_LIMIT = 6;

/**
 * Home's To review lane: sessions that finished (or stopped with an error) and that you haven't read, as the sidebar's
 * unread state says, newest first, up to `limit`. One working or waiting is in its own lane; one in Done stays there.
 */
export function reviewSessions(rows: readonly SessionRowData[], options: { now: number; archiveAfterDays: number; limit?: number }): { shown: SessionRowData[]; total: number } {
  const all = rows
    .filter((row) => {
      const status = rowStatus(row);
      return row.unread && (status === 'unread' || status === 'error') && isActive(row, options.now, options.archiveAfterDays);
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return { shown: all.slice(0, options.limit ?? REVIEW_LIMIT), total: all.length };
}

/** The project a start box's text begins with, and the rest of it as the prompt. */
export interface StartTarget {
  root: string | null;
  prompt: string;
}

/**
 * Reads the start box: a project's name at the start (any case, the longest one that fits, followed by a space, a colon
 * or nothing) picks that project, and the rest is the prompt. Without one the whole text is the prompt.
 */
export function startTarget(text: string, projects: readonly { root: string; name: string }[]): StartTarget {
  const trimmed = text.trimStart();
  const lower = trimmed.toLowerCase();
  let best: { root: string; name: string } | null = null;
  for (const project of projects) {
    const name = project.name.toLowerCase();
    if (!name || !lower.startsWith(name)) continue;
    const next = lower.charAt(name.length);
    if (next !== '' && !/[\s:,]/.test(next)) continue;
    if (!best || name.length > best.name.length) best = project;
  }
  if (!best) return { root: null, prompt: text.trim() };
  return { root: best.root, prompt: trimmed.slice(best.name.length).replace(/^[\s:,]+/, '').trim() };
}

/** What a Claude profile is doing right now, for its card on Home. */
export interface ProfileActivity {
  /** Sessions with a Claude Code process. */
  open: number;
  working: number;
  needs: number;
  /** Sessions with activity since midnight (local time). */
  today: number;
}

/** Counts per profile id over the rows the sidebar lists. Profiles without sessions are absent: callers default to zeros. */
export function profileActivity(rows: readonly SessionRowData[], now = Date.now()): Map<string, ProfileActivity> {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const out = new Map<string, ProfileActivity>();
  for (const row of rows) {
    const stats = out.get(row.profileId) ?? { open: 0, working: 0, needs: 0, today: 0 };
    if (row.live) stats.open++;
    if (row.live?.status === 'running') stats.working++;
    if (row.live?.status === 'needs-you') stats.needs++;
    if (row.updatedAt >= midnight.getTime()) stats.today++;
    out.set(row.profileId, stats);
  }
  return out;
}

/** A busy profile's line: what matters most of "1 needs you", "2 working" and "3 today"; "No sessions today" when all are zero. */
export function profileActivityLine(stats: ProfileActivity | undefined): string {
  if (!stats) return 'No sessions today';
  if (stats.needs) return `${stats.needs} ${stats.needs === 1 ? 'needs' : 'need'} you`;
  if (stats.working) return `${stats.working} working`;
  if (stats.today) return `${stats.today} today`;
  return 'No sessions today';
}

/** Over this share of a limit, a profile keeps its card with bars even without sessions today. */
export const BUSY_PERCENT = 50;

/**
 * Whether a profile gets its card with bars on Home (busy: sessions today, or over half of a limit) or folds into one
 * line in the shared card (quiet). `percents`: its limits' (or premium requests') use so far.
 */
export function profileIsBusy(stats: ProfileActivity | undefined, percents: readonly number[]): boolean {
  return (stats?.today ?? 0) > 0 || (stats?.open ?? 0) > 0 || percents.some((p) => p > BUSY_PERCENT);
}

/** A quiet profile's numbers, on its one line: "5h 1% · Week 8%", "Premium requests 12%". */
export function quietNumbers(limits: readonly { label: string; percent: number }[]): string {
  return limits.map((l) => `${l.label} ${Math.round(l.percent)}%`).join(' · ');
}

/** The one thing Up next shows from Upcoming, with when. */
export interface UpNextItem {
  kind: 'queue' | 'schedule' | 'trigger';
  id: string;
  title: string;
  /** The folder it runs in. */
  cwd: string;
  /** "Ready", "Today 14:00", "Tue 08:00", "Waits for a slot", or what a queued item waits for. */
  when: string;
}

/** A run's time: "Today 14:00", "Tomorrow 08:00", "Tue 08:00" this week, "Mon 26 Oct 08:00" further. */
export function runWhen(at: number, now: number): string {
  const diff = dayDiff(at, now);
  if (diff === 0) return `Today ${runClock(at)}`;
  if (diff === 1) return `Tomorrow ${runClock(at)}`;
  if (diff > 1 && diff < 7) return `${DAY_SHORT[new Date(at).getDay()]} ${runClock(at)}`;
  return formatRun(at);
}

/**
 * Up next on Home, from what Upcoming lists: a queued prompt that is ready first (it can start now), else the next
 * scheduled run you haven't skipped, else an event a trigger holds for a free slot, else the first queued prompt and
 * what it waits for. Null with nothing planned.
 */
export function upNext(input: {
  queue: readonly QueueEntry[];
  schedules: readonly Pick<Schedule, 'id' | 'name' | 'rule' | 'paused' | 'skippedRuns' | 'draft'>[];
  events: readonly Pick<TriggerEvent, 'id' | 'triggerId' | 'title' | 'status' | 'createdAt'>[];
  triggerRoots: ReadonlyMap<string, string>;
  now: number;
}): UpNextItem | null {
  const queued = (entry: QueueEntry, when: string): UpNextItem => ({ kind: 'queue', id: entry.item.id, title: promptLabel(entry.item.prompt, 80), cwd: entry.item.cwd, when });
  const ready = input.queue.find((entry) => entry.state === 'ready');
  if (ready) return queued(ready, 'Ready');
  let next: { schedule: (typeof input.schedules)[number]; at: number } | null = null;
  for (const schedule of input.schedules) {
    if (schedule.paused) continue;
    const skipped = new Set(schedule.skippedRuns);
    const at = nextRuns(schedule.rule, input.now, 32).find((run) => !skipped.has(run.toISOString()))?.getTime();
    if (at !== undefined && (!next || at < next.at)) next = { schedule, at };
  }
  if (next) return { kind: 'schedule', id: next.schedule.id, title: next.schedule.name, cwd: next.schedule.draft.cwd, when: runWhen(next.at, input.now) };
  const held = [...input.events].filter((e) => e.status === 'waiting' && input.triggerRoots.has(e.triggerId)).sort((a, b) => a.createdAt - b.createdAt)[0];
  if (held) return { kind: 'trigger', id: held.id, title: held.title, cwd: input.triggerRoots.get(held.triggerId)!, when: 'Waits for a slot' };
  const first = input.queue[0];
  return first ? queued(first, first.detail ?? 'Queued') : null;
}
