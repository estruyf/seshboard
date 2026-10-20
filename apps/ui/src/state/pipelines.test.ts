import { describe, expect, it } from 'vitest';
import { BUILTIN_PIPELINES, type CatchUp, type PipelineRun, type PipelineRunState, type PipelineRunStep, type RunRow } from '@switchboard/protocol/client';
import type { DisplayItem } from '../components/transcript/displayItems.ts';
import {
  catchUpLine,
  heldLine,
  mergeRunRows,
  missingBlanks,
  modelName,
  originLine,
  originOf,
  pipelineSummary,
  pushBusyLabel,
  pushLabel,
  runActions,
  runIsOpen,
  runsOfParent,
  scopeLabel,
  shownRun,
  stepViews,
  taskTitle,
} from './pipelines.ts';

const run = (patch: Partial<PipelineRun> = {}): PipelineRun => ({
  id: 'run1',
  pipelineId: 'plan-execute-validate-push',
  pipeline: { ...BUILTIN_PIPELINES[0]! },
  parentSessionId: 'parent',
  root: '/dev/app',
  cwd: '/dev/app',
  task: 'Add a usage cost toggle',
  blanks: {},
  profileId: null,
  state: 'running',
  heldBy: null,
  stepIndex: 0,
  loopTo: null,
  note: null,
  briefSentAt: null,
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

const step = (stepIndex: number, round: number, patch: Partial<PipelineRunStep> = {}): PipelineRunStep => ({
  id: `r${stepIndex}-${round}`,
  runId: 'run1',
  stepIndex,
  stepName: ['Plan', 'Execute', 'Validate', 'Push'][stepIndex] ?? 'Step',
  round,
  sessionId: `s${stepIndex}-${round}`,
  state: 'done',
  verdict: null,
  verdictText: null,
  reply: null,
  plan: null,
  startedAt: 1,
  endedAt: 2,
  note: null,
  ...patch,
});

describe('modelName', () => {
  it('names the picker aliases and Claude ids alike', () => {
    expect(modelName('opus')).toBe('Opus');
    expect(modelName('sonnet')).toBe('Sonnet');
    expect(modelName('claude-opus-4-5')).toBe('Opus 4.5');
    expect(modelName('claude-sonnet-4-5[1m]')).toBe('Sonnet 4.5');
    expect(modelName(null)).toBe('Default model');
    expect(modelName('  ')).toBe('Default model');
  });
});

describe('stepViews', () => {
  it('lists every step with the state of its latest round, and where the run is', () => {
    const views = stepViews(run({ stepIndex: 2 }), [step(0, 1), step(1, 1), step(2, 1, { verdict: 'changes', sessionId: 'v1' }), step(2, 2, { state: 'running', sessionId: 'v2' })]);
    expect(views.map((v) => [v.name, v.state, v.round, v.current])).toEqual([
      ['Plan', 'done', 1, false],
      ['Execute', 'done', 1, false],
      ['Validate', 'running', 2, true],
      ['Push', 'pending', 1, false],
    ]);
    expect(views[2]!.earlier).toEqual([{ round: 1, sessionId: 'v1' }]);
    expect(views[2]!.sessionId).toBe('v2');
    expect(views[0]!.model).toBe('Opus');
    expect(views[1]!.forks).toBe('Plan');
    expect(views[3]!.model).toBeNull();
    expect(views[3]!.sessionId).toBeNull();
  });

  it('marks no step current once the run is done', () => {
    expect(stepViews(run({ state: 'done', stepIndex: 3 }), []).some((v) => v.current)).toBe(false);
  });
});

describe('runActions', () => {
  it('offers Continue, again, Skip and Stop to a step that waits for you, with Continue as the one yellow button', () => {
    expect(runActions({ state: 'needs-you', heldBy: 'reply' })).toEqual({ continue: true, retry: true, skip: true, stop: true, primary: 'continue' });
    expect(runActions({ state: 'needs-you', heldBy: 'verdict' }).primary).toBe('continue');
  });

  it('makes Run this step again the main button after an error or a closed session', () => {
    expect(runActions({ state: 'needs-you', heldBy: 'error' })).toMatchObject({ continue: true, retry: true, primary: 'retry' });
    expect(runActions({ state: 'needs-you', heldBy: 'closed' })).toMatchObject({ continue: false, retry: true, primary: 'retry' });
  });

  it('starts a step that waits for confirmation with Continue, which can also be skipped', () => {
    expect(runActions({ state: 'needs-you', heldBy: 'confirm' })).toEqual({ continue: true, retry: false, skip: true, stop: true, primary: 'continue' });
  });

  it('leaves the push, the trust check and a missing folder to their own card, with only Stop', () => {
    for (const heldBy of ['push', 'trust', 'worktree'] as const) expect(runActions({ state: 'needs-you', heldBy })).toEqual({ continue: false, retry: false, skip: false, stop: true, primary: null });
  });

  it('only stops a run that works or waits for a limit, and offers nothing to a finished one', () => {
    expect(runActions({ state: 'running', heldBy: null })).toMatchObject({ stop: true, continue: false });
    expect(runActions({ state: 'held', heldBy: 'limit' })).toMatchObject({ stop: true, continue: false });
    expect(runActions({ state: 'done', heldBy: null })).toEqual({ continue: false, retry: false, skip: false, stop: false, primary: null });
    expect(runActions({ state: 'stopped', heldBy: 'error' }).stop).toBe(false);
    expect(runIsOpen({ state: 'stopped' })).toBe(false);
    expect(runIsOpen({ state: 'held' })).toBe(true);
  });
});

describe('heldLine', () => {
  it('says why the run waits with the step it is at, and adds the engine’s note when it says more', () => {
    expect(heldLine(run({ state: 'needs-you', heldBy: 'verdict', stepIndex: 2, note: 'Validate still asks for changes after 2 rounds' }))).toEqual({ label: 'Validate needs a decision', note: 'Validate still asks for changes after 2 rounds' });
    expect(heldLine(run({ state: 'held', heldBy: 'limit', note: null }))).toEqual({ label: 'Waiting for the usage limit to reset', note: null });
    expect(heldLine(run({ state: 'needs-you', heldBy: 'push', stepIndex: 3, note: 'Ready to push' }))).toEqual({ label: 'Ready to push', note: null });
  });

  it('says nothing while the run works or when it is over', () => {
    expect(heldLine(run({ state: 'running' }))).toBeNull();
    expect(heldLine(run({ state: 'done' }))).toBeNull();
  });
});

describe('finding a run', () => {
  const states = (...list: Array<Partial<PipelineRun>>): PipelineRunState[] => list.map((patch) => ({ run: run(patch), steps: [] }));

  it('lists the runs of a session, newest first, and of a run row by its id', () => {
    const all = states({ id: 'a', createdAt: 1 }, { id: 'b', createdAt: 3 }, { id: 'c', createdAt: 2, parentSessionId: 'other' }, { id: 'd', createdAt: 4, parentSessionId: null });
    expect(runsOfParent('parent', all).map((r) => r.run.id)).toEqual(['b', 'a']);
    expect(runsOfParent('run:d', all).map((r) => r.run.id)).toEqual(['d']);
    expect(runsOfParent('nobody', all)).toEqual([]);
  });

  it('shows the newest run that is still open, else the newest', () => {
    const all = states({ id: 'old', createdAt: 1, state: 'running' }, { id: 'new', createdAt: 5, state: 'done' });
    expect(shownRun('parent', all)!.run.id).toBe('old');
    expect(shownRun('parent', states({ id: 'x', createdAt: 1, state: 'done' }, { id: 'y', createdAt: 2, state: 'stopped' }))!.run.id).toBe('y');
    expect(shownRun('parent', [])).toBeNull();
  });
});

describe('originOf', () => {
  it('finds the run and step a sub-session belongs to, with its parent', () => {
    const all: PipelineRunState[] = [{ run: run(), steps: [step(1, 1, { sessionId: 'exec' }), step(2, 2, { sessionId: 'val2' })] }];
    expect(originOf('exec', all)).toEqual({ runId: 'run1', pipelineName: 'Plan, execute, validate, push', stepName: 'Execute', stepNumber: 2, total: 4, round: 1, parentId: 'parent' });
    expect(originOf('val2', all)).toMatchObject({ stepName: 'Validate', round: 2 });
    expect(originOf('stranger', all)).toBeNull();
    expect(originOf(null, all)).toBeNull();
  });

  it('points at the run row when the run has no parent session', () => {
    const all: PipelineRunState[] = [{ run: run({ parentSessionId: null }), steps: [step(0, 1, { sessionId: 'plan' })] }];
    expect(originOf('plan', all)!.parentId).toBe('run:run1');
  });

  it('reads "Execute · step 2 of Plan, execute, validate, push", with the round from the second', () => {
    const origin = { runId: 'r', pipelineName: 'P', stepName: 'Execute', stepNumber: 2, total: 4, round: 1, parentId: 'x' };
    expect(originLine(origin)).toEqual({ head: 'Execute', tail: 'step 2 of P' });
    expect(originLine({ ...origin, round: 2 }).head).toBe('Execute (round 2)');
  });
});

describe('words', () => {
  it('cuts a task to its first line', () => {
    expect(taskTitle('Add a toggle\n\nwith details')).toBe('Add a toggle');
    expect(taskTitle('\n  \n')).toBe('Pipeline run');
    expect(taskTitle('x'.repeat(100), 20)).toBe(`${'x'.repeat(19)}…`);
  });

  it('names the scopes and sums a pipeline up', () => {
    expect(scopeLabel({ kind: 'builtin' })).toBe('Built in');
    expect(scopeLabel({ kind: 'shared', root: '/p' })).toBe('Shared with the project');
    expect(pipelineSummary(BUILTIN_PIPELINES[0]!)).toBe('4 steps · new worktree');
    expect(pipelineSummary({ steps: BUILTIN_PIPELINES[0]!.steps.slice(0, 1), workspace: 'current' })).toBe('1 step · in the project folder');
  });

  it('labels the push button for what the step does, and while it works', () => {
    expect(pushLabel({ commit: true, pullRequest: { base: null, draft: false } })).toBe('Push and open pull request');
    expect(pushLabel({ commit: true, pullRequest: null })).toBe('Commit and push');
    expect(pushLabel({ commit: false, pullRequest: null })).toBe('Push');
    expect(pushBusyLabel('commit')).toBe('Committing…');
    expect(pushBusyLabel('create')).toBe('Opening pull request…');
    expect(pushBusyLabel('done')).toBeNull();
  });

  it('asks for the blanks a pipeline leaves open', () => {
    const body = { steps: [{ ...BUILTIN_PIPELINES[0]!.steps[0]!, prompt: '{{task}} in {{area}} {{note?}}' }] as never };
    expect(missingBlanks(body, {})).toEqual(['area']);
    expect(missingBlanks(body, { area: 'the sidebar' })).toEqual([]);
    expect(missingBlanks(BUILTIN_PIPELINES[0]!, {})).toEqual([]);
  });

  it('gives a step one line from its catch-up', () => {
    const card = (state: CatchUp['state'], did: string[], title = ''): Pick<CatchUp, 'state' | 'did' | 'need'> => ({ state, did, need: { kind: 'none', title, text: '' } });
    expect(catchUpLine(undefined)).toBeNull();
    expect(catchUpLine(card('finished', ['Added the toggle', 'Ran the tests']))).toBe('Added the toggle');
    expect(catchUpLine(card('waiting', ['x'], 'Allow a command'))).toBe('Allow a command');
    expect(catchUpLine(card('error', []))).toBe('Stopped with an error');
    expect(catchUpLine(card('finished', []))).toBeNull();
  });
});

describe('mergeRunRows', () => {
  const item = (key: string, at: number | null): DisplayItem => ({ kind: 'text', key, at, text: key, subagent: false });
  const rows: RunRow[] = [
    { id: 'a', at: 15, text: 'Plan done' },
    { id: 'b', at: 35, text: 'Execute done' },
  ];

  it('puts each row at the time its step ended, as a muted notice', () => {
    const merged = mergeRunRows([item('m1', 10), item('m2', 20), item('m3', 30)], rows);
    expect(merged.map((i) => i.key)).toEqual(['m1', 'run-row:a', 'm2', 'm3', 'run-row:b']);
    expect(merged[1]).toEqual({ kind: 'notice', key: 'run-row:a', at: 15, text: 'Plan done' });
  });

  it('puts rows before the next item that has a time, keeps untimed items in place and leaves the list alone without rows', () => {
    const items = [item('m1', 10), item('m2', null), item('m3', 40)];
    expect(mergeRunRows(items, rows).map((i) => i.key)).toEqual(['m1', 'm2', 'run-row:a', 'run-row:b', 'm3']);
    expect(mergeRunRows(items, [])).toBe(items);
  });
});
