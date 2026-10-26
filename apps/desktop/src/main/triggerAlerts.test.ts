import { describe, expect, it } from 'vitest';
import type { TriggerNotice } from '@seshboard/protocol/client';
import { triggerAlerts } from './triggerAlerts.ts';

const notice = (over: Partial<TriggerNotice>): TriggerNotice => ({
  kind: 'started',
  triggerId: 't1',
  triggerName: 'CI fails on main',
  projectRoot: '/dev/switchboard',
  projectName: 'switchboard',
  eventKind: 'ci',
  branch: 'main',
  ref: 'CI #4512',
  title: 'Fix test on main',
  sessionId: 's1',
  reason: null,
  ...over,
});

describe('trigger notifications', () => {
  it('says a CI failure started a session, with the project and the run', () => {
    expect(triggerAlerts([notice({})])).toEqual([{ kind: 'trigger-started', sessionId: 's1', title: 'CI failed on main. Started “Fix test on main”', body: 'switchboard · CI #4512' }]);
  });

  it('says an issue was picked up', () => {
    expect(triggerAlerts([notice({ kind: 'pickedUp', triggerName: 'Issues for you', eventKind: 'issue', branch: null, ref: '#212', sessionId: null })])).toEqual([
      { kind: 'trigger-started', sessionId: '', triggerRoot: '/dev/switchboard', title: 'Issue #212 picked up', body: 'switchboard · Issues for you' },
    ]);
  });

  it('says a trigger paused, with why', () => {
    expect(triggerAlerts([notice({ kind: 'paused', triggerName: 'Issues for you', reason: '5 failed checks in a row: gh is signed out', sessionId: null })])).toEqual([
      { kind: 'trigger-paused', sessionId: '', triggerRoot: '/dev/switchboard', title: 'Issues for you is paused', body: '5 failed checks in a row: gh is signed out.' },
    ]);
  });
});
