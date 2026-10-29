import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nextRuns, type Schedule, type ScheduleLastRun } from '@seshboard/protocol/client';
import { formOf, formProblem, inOneHour, lastRunLine, newForm, nextRunLine, ruleOf, scheduleLabel, toggleDay } from './schedules.ts';

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
const schedule = (over: Partial<Schedule> = {}): Schedule => ({
  id: 'a',
  name: 'Review open pull requests',
  draft: { cwd: '/work/web', prompt: 'Review them', attachments: [], typed: null, context: [], model: null, effort: null, permissionMode: 'default', workspace: 'current', baseRef: 'fresh', branch: null, profileId: null, autoStart: false },
  rule: { kind: 'weekdays', time: '08:00' },
  missed: 'run',
  paused: false,
  pausedReason: null,
  lastRun: null,
  runs: [],
  skippedRuns: [],
  createdAt: 0,
  updatedAt: 0,
  ...over,
});
const last = (over: Partial<ScheduleLastRun>): ScheduleLastRun => ({ at: local(10, 19, 8), result: 'started', sessionId: 's1', itemId: null, reason: null, ...over });

describe('schedule rows', () => {
  it('say how the last run went, for every result', () => {
    expect(lastRunLine(schedule(), NOW)).toBeNull();
    expect(lastRunLine(schedule({ lastRun: last({}) }), NOW)).toEqual({ text: 'Last: Mon 19 Oct', tone: 'muted', sessionId: 's1', check: true });
    expect(lastRunLine(schedule({ lastRun: last({ result: 'queued', sessionId: null, reason: 'at the focus limit' }) }), NOW)).toEqual({ text: 'Queued Mon 08:00: at the focus limit', tone: 'muted' });
    expect(lastRunLine(schedule({ lastRun: last({ result: 'skipped', at: local(10, 19, 9, 30), reason: 'the last run was still working' }) }), NOW)).toEqual({
      text: 'Skipped Mon 09:30: the last run was still working',
      tone: 'caution',
      sessionId: 's1',
    });
    expect(lastRunLine(schedule({ lastRun: last({ result: 'missed', at: local(10, 19, 8, 45), sessionId: null }) }), NOW)).toEqual({ text: 'Missed Mon 08:45', tone: 'caution' });
    expect(lastRunLine(schedule({ lastRun: last({ result: 'failed', sessionId: null, reason: 'Folder not found' }) }), NOW)).toEqual({ text: 'Folder not found', tone: 'caution' });
    expect(lastRunLine(schedule({ lastRun: last({ result: 'failed', sessionId: null, reason: 'Worktrees need a git repository' }) }), NOW)!.text).toBe("Didn't start Mon 08:00: Worktrees need a git repository");
  });

  it('say when the next run is, or that it is paused', () => {
    expect(nextRunLine(schedule(), NOW)).toEqual({ text: 'Next: Tomorrow 08:00', tone: 'muted' });
    expect(nextRunLine(schedule({ rule: { kind: 'weekly', days: [1], time: '09:30' } }), NOW)).toEqual({ text: 'Next: Mon 26 Oct 09:30', tone: 'muted' });
    expect(nextRunLine(schedule({ paused: true }), NOW)).toEqual({ text: 'Paused', tone: 'caution' });
    expect(nextRunLine(schedule({ paused: true, pausedReason: 'Project removed' }), NOW)!.text).toBe('Paused · Project removed');
  });

  it('read out the whole row', () => {
    expect(scheduleLabel(schedule({ lastRun: last({}) }), NOW)).toBe('Review open pull requests, weekdays at 08:00, next tomorrow at 08:00, last run Monday 19 October finished');
    expect(scheduleLabel(schedule({ lastRun: last({}) }), NOW, 'working')).toMatch(/last run Monday 19 October working$/);
    expect(scheduleLabel(schedule({ paused: true, pausedReason: 'Folder not found' }), NOW)).toBe('Review open pull requests, weekdays at 08:00, paused, folder not found');
    expect(scheduleLabel(schedule({ lastRun: last({ result: 'missed' }) }), NOW)).toMatch(/last run Monday 19 October missed$/);
  });
});

describe('the schedule dialog', () => {
  it('starts on Monday to Friday at 08:00 with today as the week day and month day', () => {
    expect(newForm('Standup', NOW)).toEqual({ name: 'Standup', repeat: 'weekdays', days: [1], monthDay: '19', date: '2026-10-19', time: '08:00', missed: 'run' });
  });

  it('makes the rule from its fields, and keeps them for another repeat', () => {
    const form = { ...newForm('Standup', NOW), days: [4, 1], monthDay: '31', time: '09:30' };
    expect(ruleOf({ ...form, repeat: 'weekly' })).toEqual({ kind: 'weekly', days: [1, 4], time: '09:30' });
    expect(ruleOf({ ...form, repeat: 'monthly' })).toEqual({ kind: 'monthly', day: 31, time: '09:30' });
    expect(ruleOf({ ...form, repeat: 'daily' })).toEqual({ kind: 'daily', time: '09:30' });
    expect(formOf(schedule({ rule: { kind: 'monthly', day: 1, time: '10:00' }, missed: 'skip' }), NOW)).toMatchObject({ repeat: 'monthly', monthDay: '1', time: '10:00', missed: 'skip', days: [1] });
  });

  it('makes a one-time rule an hour from now', () => {
    const form = { ...newForm('Standup', NOW), repeat: 'once' as const, ...inOneHour(NOW) };
    const rule = ruleOf(form);
    expect(rule).toMatchObject({ kind: 'once', date: form.date, time: form.time });
    expect(nextRuns(rule, NOW, 3)).toHaveLength(1);
    expect(nextRunLine(schedule({ rule }), NOW)?.text).toMatch(/^Next: /);
    expect(nextRunLine(schedule({ rule }), nextRuns(rule, NOW, 1)[0]!.getTime() + 1)).toEqual({ text: 'Done', tone: 'muted' });
    expect(formOf(schedule({ rule }), NOW)).toMatchObject({ repeat: 'once', date: form.date, time: form.time });
  });

  it('says what is missing before it saves', () => {
    const form = newForm('Standup', NOW);
    expect(formProblem(form, NOW)).toBeNull();
    expect(formProblem({ ...form, name: '  ' }, NOW)).toBe('Give it a name.');
    expect(formProblem({ ...form, repeat: 'weekly', days: [] }, NOW)).toBe('Pick at least one day.');
    expect(formProblem({ ...form, repeat: 'monthly', monthDay: '32' }, NOW)).toBe('Pick a day from 1 to 31.');
    expect(formProblem({ ...form, repeat: 'monthly', monthDay: 'x' }, NOW)).toBe('Pick a day from 1 to 31.');
    expect(formProblem({ ...form, time: '' }, NOW)).toBe('Pick a time.');
    // Once: a date and time still to come.
    const once = { ...form, repeat: 'once' as const, ...inOneHour(NOW) };
    expect(formProblem(once, NOW)).toBeNull();
    expect(formProblem({ ...once, date: '2020-01-01' }, NOW)).toBe('Pick a time that is still to come.');
    expect(formProblem({ ...once, date: '' }, NOW)).toBe('Pick a date.');
    expect(toggleDay([1, 4], 4)).toEqual([1]);
    expect(toggleDay([1], 3)).toEqual([1, 3]);
  });
});
