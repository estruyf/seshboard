import { describe, expect, it } from 'vitest';
import type { ScheduleRunEvent } from '@switchboard/protocol/client';
import { scheduleAlerts } from './scheduleAlerts.ts';

const run = (over: Partial<ScheduleRunEvent>): ScheduleRunEvent => ({
  scheduleId: 'a',
  name: 'Review open pull requests',
  result: 'started',
  sessionId: 's1',
  title: 'Review open pull requests · Mon 19 Oct',
  projectName: 'worklog-web',
  reason: null,
  missed: false,
  ...over,
});

describe('scheduled runs as notifications', () => {
  it('says a run started, with the project, and opens its session', () => {
    expect(scheduleAlerts([run({})])).toEqual([{ kind: 'schedule-started', sessionId: 's1', title: 'Scheduled: Review open pull requests started', body: 'worklog-web' }]);
  });

  it('says a run went to the queue, was skipped or did not start, with the reason', () => {
    expect(scheduleAlerts([run({ result: 'queued', sessionId: null, reason: "You're at your focus limit (3 of 3). It starts when a slot frees." })])).toEqual([
      { kind: 'schedule-queued', sessionId: '', scheduleId: 'a', title: 'Scheduled: Review open pull requests is in the queue', body: "You're at your focus limit (3 of 3). It starts when a slot frees." },
    ]);
    expect(scheduleAlerts([run({ result: 'skipped', reason: 'the last run was still working' })])).toEqual([
      { kind: 'schedule-skipped', sessionId: 's1', scheduleId: 'a', title: 'Scheduled: Review open pull requests was skipped', body: 'The last run was still working.' },
    ]);
    expect(scheduleAlerts([run({ result: 'failed', sessionId: null, reason: 'Folder not found' })])[0]).toMatchObject({ scheduleId: 'a', title: "Scheduled: Review open pull requests didn't start", body: 'Folder not found.' });
  });

  it('gives one notification for several missed runs that started, and none for a skipped missed run', () => {
    const events = scheduleAlerts([
      run({ missed: true }),
      run({ name: 'Standup summary', sessionId: 's2', missed: true }),
      run({ name: 'Check dependency updates', sessionId: 's3', missed: true }),
      run({ name: 'Monthly invoice check', result: 'missed', sessionId: null, missed: true }),
    ]);
    expect(events).toEqual([{ kind: 'schedule-started', sessionId: 's1', title: '3 scheduled sessions started', body: 'They were missed while Switchboard was closed.' }]);
    // One missed run says what it is.
    expect(scheduleAlerts([run({ missed: true })])[0]!.title).toBe('Scheduled: Review open pull requests started');
  });
});
