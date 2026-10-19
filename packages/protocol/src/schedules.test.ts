import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { describe as describeRule, formatNext, formatPast, formatRun, nameFromPrompt, nextRuns, ordinal, ruleProblem, runsBetween, runTitle, speakNext, type ScheduleRule } from './schedules.ts';

// Local time is the computer's: these run in real zones with DST (Node picks up a TZ set at runtime, on macOS and
// Windows alike), and put back what was there.
const savedTz = process.env.TZ;
const useZone = (zone: string) => {
  process.env.TZ = zone;
};
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

/** A local time in the current zone. */
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const clock = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
const runs = (rule: ScheduleRule, from: number, count = 3) => nextRuns(rule, from, count).map(clock);

describe('nextRuns (Europe/Brussels)', () => {
  beforeAll(() => useZone('Europe/Brussels'));

  it('runs every day at its time, strictly after now', () => {
    expect(runs({ kind: 'daily', time: '08:00' }, local(2026, 10, 19, 10))).toEqual(['2026-10-20 08:00', '2026-10-21 08:00', '2026-10-22 08:00']);
    // At the very minute it already ran: the next one is tomorrow.
    expect(runs({ kind: 'daily', time: '08:00' }, local(2026, 10, 19, 8), 1)).toEqual(['2026-10-20 08:00']);
    expect(runs({ kind: 'daily', time: '08:00' }, local(2026, 10, 19, 7, 59), 1)).toEqual(['2026-10-19 08:00']);
  });

  it('runs Monday to Friday: asked on a Friday evening, the next is Monday', () => {
    expect(runs({ kind: 'weekdays', time: '08:00' }, local(2026, 10, 23, 20), 2)).toEqual(['2026-10-26 08:00', '2026-10-27 08:00']);
  });

  it('runs on the picked days of the week', () => {
    expect(runs({ kind: 'weekly', days: [1, 4], time: '09:30' }, local(2026, 10, 19, 12))).toEqual(['2026-10-22 09:30', '2026-10-26 09:30', '2026-10-29 09:30']);
  });

  it('runs day 31 on the last day of shorter months', () => {
    expect(runs({ kind: 'monthly', day: 31, time: '10:00' }, local(2026, 11, 1), 4)).toEqual(['2026-11-30 10:00', '2026-12-31 10:00', '2027-01-31 10:00', '2027-02-28 10:00']);
  });

  it('runs Feb 29 on Feb 28 in other years', () => {
    expect(runs({ kind: 'monthly', day: 29, time: '10:00' }, local(2027, 2, 1), 2)).toEqual(['2027-02-28 10:00', '2027-03-29 10:00']);
    expect(runs({ kind: 'monthly', day: 29, time: '10:00' }, local(2028, 2, 1), 1)).toEqual(['2028-02-29 10:00']);
  });

  it('runs a time DST skips at the first valid time after it', () => {
    // 29 March 2026: 02:00 jumps to 03:00, so 02:30 doesn't exist that day.
    const [onTheDay, after] = nextRuns({ kind: 'daily', time: '02:30' }, local(2026, 3, 28, 12), 2);
    expect(clock(onTheDay!)).toBe('2026-03-29 03:00');
    expect(onTheDay!.toISOString()).toBe('2026-03-29T01:00:00.000Z');
    expect(clock(after!)).toBe('2026-03-30 02:30');
  });

  it('runs a time DST repeats once, at the first one', () => {
    // 25 October 2026: 03:00 goes back to 02:00, so 02:30 happens at 00:30 and again at 01:30 UTC.
    const [first, next] = nextRuns({ kind: 'daily', time: '02:30' }, local(2026, 10, 24, 12), 2);
    expect(first!.toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(clock(next!)).toBe('2026-10-26 02:30');
    // Between the two: the second 02:30 is not another run.
    const [between] = nextRuns({ kind: 'daily', time: '02:30' }, Date.parse('2026-10-25T01:00:00Z'), 1);
    expect(clock(between!)).toBe('2026-10-26 02:30');
  });

  it('keeps the time on the clock across a DST change', () => {
    expect(runs({ kind: 'daily', time: '08:00' }, local(2026, 10, 24, 12), 3)).toEqual(['2026-10-25 08:00', '2026-10-26 08:00', '2026-10-27 08:00']);
  });

  it('lists the runs that were due between two moments', () => {
    const due = runsBetween({ kind: 'weekdays', time: '08:45' }, local(2026, 10, 16, 9), local(2026, 10, 21, 9)).map(clock);
    expect(due).toEqual(['2026-10-19 08:45', '2026-10-20 08:45', '2026-10-21 08:45']);
    expect(runsBetween({ kind: 'daily', time: '08:45' }, local(2026, 10, 19, 9), local(2026, 10, 19, 10))).toEqual([]);
  });
});

describe('nextRuns (America/New_York)', () => {
  beforeAll(() => useZone('America/New_York'));

  it('handles its own DST days', () => {
    // 8 March 2026: 02:00 jumps to 03:00. 1 November 2026: 02:00 goes back to 01:00.
    expect(runs({ kind: 'daily', time: '02:15' }, local(2026, 3, 7, 12), 2)).toEqual(['2026-03-08 03:00', '2026-03-09 02:15']);
    const [first] = nextRuns({ kind: 'daily', time: '01:30' }, local(2026, 10, 31, 12), 1);
    expect(first!.toISOString()).toBe('2026-11-01T05:30:00.000Z');
    expect(runs({ kind: 'daily', time: '01:30' }, local(2026, 10, 31, 12), 2)).toEqual(['2026-11-01 01:30', '2026-11-02 01:30']);
  });

  it('follows a time zone change: the same rule gives the zone’s own clock time', () => {
    const [run] = nextRuns({ kind: 'daily', time: '08:00' }, Date.parse('2026-10-19T00:00:00Z'), 1);
    expect(run!.toISOString()).toBe('2026-10-19T12:00:00.000Z');
    useZone('Europe/Brussels');
    const [moved] = nextRuns({ kind: 'daily', time: '08:00' }, Date.parse('2026-10-19T00:00:00Z'), 1);
    expect(moved!.toISOString()).toBe('2026-10-19T06:00:00.000Z');
  });
});

describe('rules', () => {
  beforeAll(() => useZone('Europe/Brussels'));

  it('refuses a week without days, and bad days and times', () => {
    expect(ruleProblem({ kind: 'weekly', days: [], time: '08:00' })).toBe('Pick at least one day.');
    expect(nextRuns({ kind: 'weekly', days: [], time: '08:00' }, Date.now(), 3)).toEqual([]);
    expect(ruleProblem({ kind: 'monthly', day: 32, time: '08:00' })).not.toBeNull();
    expect(ruleProblem({ kind: 'monthly', day: 0, time: '08:00' })).not.toBeNull();
    expect(ruleProblem({ kind: 'daily', time: '24:00' })).toBe('Pick a time.');
    expect(ruleProblem({ kind: 'daily', time: '8:00' })).toBe('Pick a time.');
    expect(ruleProblem({ kind: 'weekly', days: [1], time: '08:00' })).toBeNull();
  });

  it('says the rule in words', () => {
    expect(describeRule({ kind: 'daily', time: '08:00' })).toBe('Every day at 08:00');
    expect(describeRule({ kind: 'weekdays', time: '08:00' })).toBe('Weekdays at 08:00');
    expect(describeRule({ kind: 'weekly', days: [4, 1], time: '09:30' })).toBe('Mondays and Thursdays at 09:30');
    expect(describeRule({ kind: 'weekly', days: [1], time: '09:30' })).toBe('Mondays at 09:30');
    expect(describeRule({ kind: 'weekly', days: [0, 1, 3, 5], time: '09:30' })).toBe('Mondays, Wednesdays, Fridays and Sundays at 09:30');
    expect(describeRule({ kind: 'weekly', days: [1, 2, 3, 4, 5], time: '09:30' })).toBe('Weekdays at 09:30');
    expect(describeRule({ kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], time: '09:30' })).toBe('Every day at 09:30');
    expect(describeRule({ kind: 'monthly', day: 1, time: '10:00' })).toBe('On the 1st at 10:00');
    expect(describeRule({ kind: 'monthly', day: 31, time: '10:00' })).toBe('On the 31st at 10:00');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '31st']);
  });

  it('says when the next run is', () => {
    const now = local(2026, 10, 19, 10);
    expect(formatNext(local(2026, 10, 19, 18), now)).toBe('Today 18:00');
    expect(formatNext(local(2026, 10, 20, 8), now)).toBe('Tomorrow 08:00');
    expect(formatNext(local(2026, 10, 22, 8), now)).toBe('Thu 08:00');
    expect(formatNext(local(2026, 10, 26, 9, 30), now)).toBe('Mon 26 Oct 09:30');
    expect(formatRun(local(2026, 10, 20, 8))).toBe('Tue 20 Oct 08:00');
    expect(formatPast(local(2026, 10, 19, 8, 45), now)).toBe('Mon 08:45');
    expect(formatPast(local(2026, 10, 1, 10), now)).toBe('Thu 1 Oct 10:00');
    expect(speakNext(local(2026, 10, 20, 8), now)).toBe('tomorrow at 08:00');
    expect(speakNext(local(2026, 10, 26, 9, 30), now)).toBe('Monday 26 October at 09:30');
  });

  it('titles a run and names a schedule from its prompt', () => {
    expect(runTitle('Review open pull requests', local(2026, 10, 19, 8))).toBe('Review open pull requests · Mon 19 Oct');
    expect(nameFromPrompt('\n  Review open pull requests  \nand more')).toBe('Review open pull requests');
    expect(nameFromPrompt('word '.repeat(40)).endsWith('…')).toBe(true);
    expect(nameFromPrompt('word '.repeat(40)).length).toBeLessThanOrEqual(81);
  });
});
