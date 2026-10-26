import { describe, expect, it } from 'vitest';
import type { PipelineRunState } from '@seshboard/protocol/client';
import { pipelineAlerts, stepSessions } from './pipelineAlerts.ts';

describe('pipeline notifications', () => {
  it('says a run waits for you, stopped, or is done', () => {
    expect(pipelineAlerts({ kind: 'needsYou', runId: 'run-1', sessionId: 'p', title: 'Add a usage cost toggle', body: 'Push waits for you.' })).toEqual([
      { kind: 'needs-you', sessionId: 'p', title: 'Add a usage cost toggle', body: 'Push waits for you.' },
    ]);
    expect(pipelineAlerts({ kind: 'stopped', runId: 'run-1', sessionId: 'v', title: 'Add a usage cost toggle', body: 'Validate has no verdict.' })).toEqual([
      { kind: 'pipeline-stopped', sessionId: 'v', title: 'Add a usage cost toggle: the run stopped', body: 'Validate has no verdict.' },
    ]);
    expect(pipelineAlerts({ kind: 'done', runId: 'run-1', sessionId: null, title: 'Dark mode', body: 'Done. Pull request #152 is open.' })).toEqual([
      { kind: 'pipeline-done', sessionId: 'run-1', title: 'Dark mode', body: 'Done. Pull request #152 is open.' },
    ]);
  });

  it('knows the sub-sessions of runs that go on', () => {
    const state = (status: PipelineRunState['run']['status'], ids: string[]) => ({ run: { status }, steps: ids.map((sessionId) => ({ sessionId })) }) as unknown as PipelineRunState;
    expect([...stepSessions([state('running', ['a', 'b']), state('done', ['c']), state('waiting', ['d'])])]).toEqual(['a', 'b', 'd']);
  });
});
