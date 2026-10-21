import { describe, expect, it } from 'vitest';
import { BUILT_IN_PIPELINES, type PipelineRunState } from '@switchboard/protocol/client';
import { archiveTreeLabel, deleteTreeText, runGoesOn, runRowMenu, treeRunsOf, treeSessionCount } from './runTree.ts';

const pipeline = { ...BUILT_IN_PIPELINES[1]!, builtIn: true, createdAt: 0, updatedAt: 0 };
const run = (over: Partial<PipelineRunState['run']> = {}, sessions: string[] = []): PipelineRunState => ({
  run: { id: 'run-1', pipelineId: pipeline.id, pipeline, parentSessionId: null, task: 'Add dark mode', title: 'Add dark mode', projectRoot: '/p', cwd: '/p', profileId: null, status: 'running', reason: null, waitingFor: null, hold: null, step: 0, round: 1, sentBackTo: null, pr: null, createdAt: 0, updatedAt: 0, endedAt: null, archivedAt: null, restoredAt: null, ...over },
  steps: sessions.map((sessionId, index) => ({ runId: over.id ?? 'run-1', step: 'Execute', index, round: 1, sessionId, status: 'done', outcome: 'clean', verdict: null, reason: null, plan: null, actions: [], startedAt: 0, endedAt: 0 })),
});
const actions = (state: PipelineRunState, archived = false) => runRowMenu(state, { archived, sessions: 2 }).map((i) => i.label);

describe('a run as one tree', () => {
  it('finds the runs of a run row or a parent session, and their sub-sessions once each', () => {
    const runs = [run({ id: 'run-a' }, ['s1']), run({ id: 'run-b', parentSessionId: 'p' }, ['s2', 's3']), run({ id: 'run-c', parentSessionId: 'p' }, ['s3', 's4'])];
    expect(treeRunsOf(runs, 'run-a').map((s) => s.run.id)).toEqual(['run-a']);
    expect(treeRunsOf(runs, 'p').map((s) => s.run.id)).toEqual(['run-b', 'run-c']);
    expect(treeSessionCount(treeRunsOf(runs, 'p'))).toBe(3);
  });

  it('offers Stop the run only while it works or waits, and Archive or Unarchive with its steps', () => {
    expect(actions(run({ status: 'running' }))).toEqual(['Open', 'Stop the run', 'Archive with its 2 steps', 'Delete…']);
    expect(actions(run({ status: 'waiting', waitingFor: 'push' }))).toEqual(['Open', 'Stop the run', 'Archive with its 2 steps', 'Delete…']);
    expect(actions(run({ status: 'stopped' }))).toEqual(['Open', 'Archive with its 2 steps', 'Delete…']);
    expect(actions(run({ status: 'done' }), true)).toEqual(['Open', 'Unarchive with its 2 steps', 'Delete…']);
    expect(archiveTreeLabel(1)).toBe('Archive with its step');
    expect(archiveTreeLabel(0)).toBe('Archive');
  });

  it('never archives a run that goes on', () => {
    expect(runGoesOn(run({ status: 'running' }))).toBe(true);
    expect(runGoesOn(run({ status: 'waiting' }))).toBe(true);
    expect(runGoesOn(run({ status: 'paused' }))).toBe(true);
    expect(runGoesOn(run({ status: 'stopped' }))).toBe(false);
    expect(runGoesOn(run({ status: 'done' }))).toBe(false);
  });

  it('says what Delete… takes away and that the transcripts stay', () => {
    expect(deleteTreeText('Add dark mode', 4, false)).toEqual({ title: 'Delete “Add dark mode”?', body: 'The run and its 4 sub-sessions go away from Switchboard. Their Claude Code transcripts stay on disk.' });
    expect(deleteTreeText('Add dark mode', 1, false).body).toBe('The run and its sub-session go away from Switchboard. Their Claude Code transcripts stay on disk.');
    expect(deleteTreeText('Add dark mode', 0, false).body).toBe('The run goes away from Switchboard.');
    expect(deleteTreeText('Add dark mode', 4, false, true).body).toBe('The run goes away from Switchboard. Its 4 sub-sessions stay, on their own.');
    expect(deleteTreeText('Fix login', 2, true).body).toBe('This session, its run and its 2 sub-sessions go away from Switchboard. Their Claude Code transcripts stay on disk.');
  });
});
