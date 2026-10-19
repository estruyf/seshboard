import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { UpcomingRun } from '@switchboard/protocol/client';
import { dayGroups, inProject, projectCounts, readFilter, runLabel, listedSchedules, scheduleDone, skippedToast, upcomingCount, upcomingHint, upcomingNavLabel, visibleCards, type UpcomingFold } from './upcoming.ts';

const savedTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'Europe/Brussels';
});
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

const local = (m: number, d: number, h = 0, min = 0) => new Date(2026, m - 1, d, h, min).getTime();
// Monday 19 October 2026, 10:00.
const NOW = local(10, 19, 10);
const run = (scheduleId: string, at: number, over: Partial<UpcomingRun> = {}): UpcomingRun => ({ scheduleId, at, cwd: `/work/${scheduleId}`, skipped: false, ...over });
const NAMES: Record<string, string> = { prs: 'Review open pull requests', standup: 'Standup summary', deps: 'Check dependency updates' };
const name = (id: string) => NAMES[id] ?? id;

/** The design's week: weekday runs of two schedules, and dependency updates on Mondays. */
function week(): UpcomingRun[] {
  const out: UpcomingRun[] = [run('prs', local(10, 19, 11))];
  for (const d of [20, 21, 22, 23, 26]) out.push(run('prs', local(10, d, 8)), run('standup', local(10, d, 8, 45)));
  out.push(run('deps', local(10, 26, 9, 30)));
  return out.sort((a, b) => a.at - b.at);
}

describe('dayGroups', () => {
  it('groups by day with Today and Tomorrow, and folds days in a row that repeat the day above', () => {
    const groups = dayGroups(week(), NOW, name);
    expect(groups.map((g) => (g.kind === 'day' ? g.label : `fold ${g.label}`))).toEqual(['Today · Mon 19 Oct', 'Tomorrow · Tue 20 Oct', 'Wed 21 Oct', 'fold Thu 22 Oct · Fri 23 Oct', 'Mon 26 Oct']);
    const fold = groups[3] as UpcomingFold;
    expect(fold).toMatchObject({ count: '2×', text: 'Review open pull requests and Standup summary, each day' });
    expect(fold.days.map((d) => d.key)).toEqual(['2026-10-22', '2026-10-23']);
    expect(groups[0]).toMatchObject({ near: 'today', spoken: 'Today, Monday 19 October' });
    expect(groups[1]).toMatchObject({ near: 'tomorrow' });
    expect(groups[2]).toMatchObject({ near: null });
  });

  it("doesn't fold a single repeating day, days apart in the calendar, or a day with a skipped run", () => {
    const runs = [run('prs', local(10, 21, 8)), run('prs', local(10, 22, 8)), run('prs', local(10, 24, 8)), run('prs', local(10, 25, 8)), run('prs', local(10, 26, 8), { skipped: true }), run('prs', local(10, 27, 8))];
    expect(dayGroups(runs, NOW, name).map((g) => g.kind)).toEqual(['day', 'day', 'day', 'day', 'day', 'day']);
  });

  it('says a longer fold from its first to its last day', () => {
    const runs = [21, 22, 23, 24].map((d) => run('prs', local(10, d, 8)));
    const groups = dayGroups(runs, NOW, name);
    expect(groups.map((g) => g.label)).toEqual(['Wed 21 Oct', 'Thu 22 Oct to Sat 24 Oct']);
    expect((groups[1] as UpcomingFold).text).toBe('Review open pull requests, each day');
  });
});

describe('the sidebar entry', () => {
  it('says ready first, then the next run, then nothing; nothing planned with nothing at all', () => {
    expect(upcomingHint({ ready: 1, nextRun: local(10, 19, 11), count: 3, now: NOW })).toEqual({ text: '1 ready', tone: 'ok' });
    expect(upcomingHint({ ready: 0, nextRun: local(10, 19, 11), count: 3, now: NOW })).toEqual({ text: 'next 11:00', tone: 'muted' });
    expect(upcomingHint({ ready: 0, nextRun: local(10, 20, 8), count: 3, now: NOW })).toEqual({ text: 'next Tue 08:00', tone: 'muted' });
    expect(upcomingHint({ ready: 0, nextRun: local(11, 2, 8), count: 3, now: NOW })).toEqual({ text: 'next Mon 2 Nov 08:00', tone: 'muted' });
    expect(upcomingHint({ ready: 0, nextRun: null, count: 2, now: NOW })).toBeNull();
    expect(upcomingHint({ ready: 0, nextRun: null, count: 0, now: NOW })).toEqual({ text: 'nothing planned', tone: 'muted' });
  });

  it('reads its label and counts queued items and active schedules', () => {
    expect(upcomingNavLabel({ ready: 0, nextRun: local(10, 19, 11), count: 7, now: NOW })).toBe('Upcoming, 7 planned, next at 11:00');
    expect(upcomingNavLabel({ ready: 1, nextRun: null, count: 2, now: NOW })).toBe('Upcoming, 2 planned, 1 ready');
    expect(upcomingNavLabel({ ready: 0, nextRun: null, count: 0, now: NOW })).toBe('Upcoming, nothing planned');
    const daily = { kind: 'daily', time: '08:00' } as const;
    const once = (date: string) => ({ kind: 'once', date, time: '09:00' }) as const;
    expect(upcomingCount(3, [{ paused: false, rule: daily }, { paused: true, rule: daily }, { paused: false, rule: daily }], NOW)).toBe(5);
    // A one-time schedule counts until it has run.
    expect(upcomingCount(0, [{ paused: false, rule: once('2026-10-20') }, { paused: false, rule: once('2026-10-19') }], NOW)).toBe(1);
    expect(listedSchedules([{ id: 'done', rule: once('2026-10-19') }, { id: 'daily', rule: daily }, { id: 'later', rule: once('2026-10-20') }], NOW).map((s) => s.id)).toEqual(['daily', 'later']);
    expect(scheduleDone({ rule: once('2026-10-19') }, NOW)).toBe(true);
    expect(scheduleDone({ rule: daily }, NOW)).toBe(false);
  });
});

describe('the filters', () => {
  it('shows the cards of each kind', () => {
    expect(visibleCards('all')).toEqual({ queue: true, runs: true, schedules: true });
    expect(visibleCards('queue')).toEqual({ queue: true, runs: false, schedules: false });
    expect(visibleCards('schedules')).toEqual({ queue: false, runs: true, schedules: true });
  });

  it('filters by project, a worktree of it included, and counts queued and scheduled per project', () => {
    expect(inProject('/work/web', null)).toBe(true);
    expect(inProject('/work/web', '/work/web')).toBe(true);
    expect(inProject('/work/web/.claude/worktrees/fix', '/work/web')).toBe(true);
    expect(inProject('/work/api', '/work/web')).toBe(false);
    const counts = projectCounts([{ cwd: '/work/web' }, { cwd: '/work/web/.claude/worktrees/fix' }, { cwd: '/work/api' }], [{ draft: { cwd: '/work/zeta' } }, { draft: { cwd: '/work/web' } }], (root) => root.split('/').pop()!);
    expect(counts).toEqual([
      { root: '/work/api', queued: 1, schedules: 0 },
      { root: '/work/web', queued: 2, schedules: 1 },
      { root: '/work/zeta', queued: 0, schedules: 1 },
    ]);
  });

  it('reads a remembered filter back, and anything else as the default', () => {
    expect(readFilter({ kind: 'queue', project: '/work/web' })).toEqual({ kind: 'queue', project: '/work/web' });
    expect(readFilter({ kind: 'nope', project: 3 })).toEqual({ kind: 'all', project: null });
    expect(readFilter(null)).toEqual({ kind: 'all', project: null });
  });
});

describe('words', () => {
  it('reads a run and says a skipped one', () => {
    expect(runLabel(local(10, 20, 8), 'Review open pull requests', 'worklog-web')).toBe('Tuesday 20 October, 08:00, Review open pull requests, worklog-web');
    expect(skippedToast(local(10, 20, 8), 'Review open pull requests')).toBe('Skipped Tue 20 Oct 08:00 of Review open pull requests.');
  });
});
