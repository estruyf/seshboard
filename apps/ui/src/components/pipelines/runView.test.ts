import { describe, expect, it } from 'vitest';
import { BUILT_IN_PIPELINES, clockTime, parseRunBriefs, type PipelineRunState } from '@switchboard/protocol/client';
import { actionDetail, parentRows, pushLine, roundDivider, runButtons, stepDetail, stepMeta, stepPills, stopNotice, verdictView, waitsOnStep, withRunStub, holdLine } from './runView.ts';

const pipeline = { ...BUILT_IN_PIPELINES[0]!, builtIn: true, createdAt: 0, updatedAt: 0 };

const state = (over: Partial<PipelineRunState['run']> = {}, steps: Array<Partial<PipelineRunState['steps'][number]>> = []): PipelineRunState => ({
  run: { id: 'run-1', pipelineId: pipeline.id, pipeline, parentSessionId: 'p', task: null, title: 'Add a usage cost toggle', projectRoot: '/p', cwd: '/p', profileId: null, status: 'running', reason: null, waitingFor: null, hold: null, step: 2, round: 1, sentBackTo: null, pr: null, unattended: false, createdAt: 0, updatedAt: 0, endedAt: null, archivedAt: null, restoredAt: null, ...over },
  steps: steps.map((s, i) => ({ runId: 'run-1', step: 'Plan', index: i, round: 1, sessionId: `s${i}`, status: 'done', outcome: 'clean', verdict: null, reason: null, plan: null, actions: [], startedAt: 0, endedAt: 240_000, ...s })),
});

describe('step rows', () => {
  it('says how a step runs and which pills it has', () => {
    expect(stepMeta(pipeline.steps[0]!)).toBe('Opus · plan mode');
    expect(stepMeta(pipeline.steps[1]!)).toBe('Sonnet · fork of Plan');
    expect(stepMeta(pipeline.steps[2]!)).toBe('Opus · read only');
    expect(stepMeta(pipeline.steps[3]!)).toBe('commit, push, pull request');
    expect(stepPills(pipeline.steps[0]!, null).map((p) => p.text)).toEqual(['plan']);
    expect(stepPills(pipeline.steps[1]!, null).map((p) => p.text)).toEqual(['fork']);
    const s = state({}, [{}, { index: 1 }, { index: 2, round: 2, status: 'working', endedAt: null }]);
    expect(stepPills(pipeline.steps[2]!, s.steps[2]!).map((p) => p.text)).toEqual(['round 2 of 2']);
  });

  it('takes the reason, then the catch-up, then what it waits for', () => {
    const s = state({}, [{ reason: 'plan approved' }, { index: 1 }, { index: 2, status: 'working', endedAt: null }]);
    expect(stepDetail(s, 0)).toBe('plan approved');
    expect(stepDetail(s, 1, { did: ['Changed 6 files.', 'npm run check passes.', 'More.'] })).toBe('Changed 6 files. npm run check passes.');
    expect(stepDetail(s, 2)).toBe('Working');
    expect(stepDetail(s, 3)).toBe('Waits for you after Validate passes.');
    expect(stepDetail(state({ step: 0 }), 1)).toBe('Starts after Plan.');
    expect(stepDetail(state({ step: 3, status: 'waiting', waitingFor: 'push' }), 3)).toBe('Waits for you to push.');
  });

  it('says what holds the next step', () => {
    expect(holdLine({ status: 'running', hold: 'focus' })).toBe('Waits for a free slot');
    expect(holdLine({ status: 'running', hold: 'limit' })).toBe('Waits for the usage limit to reset');
    expect(holdLine({ status: 'running', hold: null })).toBeNull();
  });
});

describe('the run buttons and stops', () => {
  it('shows Continue only while the run waits for you, and Push keeps its own card', () => {
    const working = runButtons(state({}, [{}, { index: 1 }, { index: 2, status: 'working', endedAt: null }]));
    expect(working).toEqual({ continue: false, anotherRound: false, skip: true, retry: true, stop: true });
    expect(runButtons(state({ status: 'waiting', waitingFor: 'you', reason: 'Validate has no verdict.' })).continue).toBe(true);
    expect(runButtons(state({ status: 'waiting', waitingFor: 'push', step: 3 }))).toEqual({ continue: false, anotherRound: false, skip: false, retry: false, stop: false });
    expect(runButtons(state({ status: 'done' }))).toEqual({ continue: false, anotherRound: false, skip: false, retry: false, stop: false });
  });

  it('says why the run stopped and what to do', () => {
    expect(stopNotice(state({ status: 'waiting', waitingFor: 'you', reason: 'Execute ended with an error.', step: 1 }))).toEqual({
      title: 'Execute ended with an error',
      advice: 'The run stopped. Run this step again, or reply in Execute.',
      kind: 'stop',
      index: 1,
      anotherRound: null,
    });
    expect(stopNotice(state({ status: 'paused', reason: 'Paused: Switchboard was closed. The run goes on at the next start.' }))).toMatchObject({ title: 'Paused: Switchboard was closed', advice: 'The run goes on at the next start.', kind: 'paused' });
    expect(stopNotice(state({ status: 'waiting', waitingFor: 'push', reason: 'Push waits for you.', step: 3 }))).toBeNull();
    expect(stopNotice(state())).toBeNull();
  });

  it('offers another round when changes are still needed after the last round', () => {
    const changes = { kind: 'changes' as const, items: ['Fix the tooltip.'] };
    const out = state({ status: 'waiting', waitingFor: 'you', reason: 'Still changes needed after 2 rounds.', round: 2 }, [{}, { index: 1 }, { index: 2, verdict: changes }, { index: 2, round: 2, status: 'waiting', verdict: changes }]);
    expect(runButtons(out)).toMatchObject({ continue: true, anotherRound: true });
    expect(stopNotice(out)).toMatchObject({
      title: 'Still changes needed after 2 rounds',
      advice: 'Another round sends the changes to Execute. Or work on them in Execute yourself: Validate checks again when that turn ends. Continue goes on without the changes.',
      anotherRound: 'Execute',
    });
    // Not while rounds are left, or once the changes went back.
    expect(runButtons(state({ ...out.run, round: 1 }, out.steps.slice(0, 3))).anotherRound).toBe(false);
    expect(runButtons(state({ ...out.run, status: 'running', sentBackTo: 1, round: 3 }, out.steps)).anotherRound).toBe(false);
  });

  it('knows the step the run waits on', () => {
    const s = state({ status: 'waiting', waitingFor: 'you', reason: 'Validate has no verdict.' }, [{}, { index: 1 }, { index: 2 }, { index: 2, round: 2 }].map((r, i) => ({ ...r, sessionId: `s${i}` })));
    expect(waitsOnStep(s, 2, 2)).toBe(true);
    expect(waitsOnStep(s, 2, 1)).toBe(false);
    expect(waitsOnStep(s, 1, 1)).toBe(false);
  });
});

describe('push, the parent and the verdict', () => {
  it('says what Push commits and where', () => {
    expect(pushLine({ files: 6, branch: 'worktree-usage-cost', base: 'main' })).toBe('6 files · worktree-usage-cost → main');
    expect(pushLine({ files: 1, branch: null, base: null })).toBe('1 file');
  });

  it("writes the parent's own rows", () => {
    const s = state({ createdAt: new Date(2026, 9, 20, 14, 2).getTime() }, [
      { reason: 'plan approved' },
      { step: 'Validate', index: 2, verdict: { kind: 'changes', items: ['a'] }, reason: '2 fixes sent to Execute, round 2', endedAt: 500_000 },
      { step: 'Execute', index: 1, status: 'working', endedAt: null },
    ]);
    const rows = parentRows(s);
    expect(rows[0]).toMatchObject({ kind: 'start', pipeline: pipeline.name, at: clockTime(new Date(2026, 9, 20, 14, 2).getTime()) });
    expect(rows[1]).toMatchObject({ kind: 'step', head: 'Plan finished', rest: 'plan approved · 4m', tone: 'ok', sessionId: 's0' });
    expect(rows[2]).toMatchObject({ head: 'Validate: changes needed', rest: '2 fixes sent to Execute, round 2', tone: 'caution' });
    expect(rows).toHaveLength(3);
  });

  it('links the run once to a message to the parent', () => {
    const s = state();
    const once = withRunStub('What did the review find?', s.run);
    expect(parseRunBriefs(once)).toMatchObject({ text: 'What did the review find?', runs: [{ runId: 'run-1', stub: true }] });
    expect(withRunStub(once, s.run)).toBe(once);
    expect(withRunStub('/compact', s.run)).toBe('/compact');
    expect(withRunStub('', s.run)).toBe('');
  });

  it('reads the verdict card from the last reply', () => {
    const s = state({}, [{}, { index: 1 }, { index: 2, status: 'working', endedAt: null }]);
    const view = verdictView(s, 2, 1, 'Looks mostly fine.\n\nVerdict: changes needed\n1. LimitsCard still shows the cost.\n2. Two lint errors.');
    expect(view?.verdict).toEqual({ kind: 'changes', items: ['LimitsCard still shows the cost.', 'Two lint errors.'] });
    expect(view?.round).toBe('round 1 of 2');
    expect(view?.next).toEqual({ to: 'Execute', text: 'as round 2. Validate runs again when it finishes.' });
    expect(verdictView(s, 2, 2, 'Verdict: changes needed')?.next?.text).toBe('Still changes needed after 2 rounds. Another round sends them to Execute. Or work on them in Execute yourself: Validate checks again when that turn ends.');
    // Another round went on from round 2: its card says where the changes went, and round 3 has no "of".
    const more = state({ step: 2, round: 3 }, [{}, { index: 1 }, { index: 2 }, { index: 2, round: 2 }, { index: 2, round: 3, status: 'working', endedAt: null }]);
    expect(verdictView(more, 2, 2, 'Verdict: changes needed')?.next).toEqual({ to: 'Execute', text: 'as round 3. Validate runs again when it finishes.' });
    expect(verdictView(more, 2, 3, 'Verdict: changes needed')?.round).toBe('round 3');
    expect(verdictView(s, 2, 1, 'Verdict: pass')?.next).toBeNull();
    expect(verdictView(s, 0, 1, 'Verdict: pass')).toBeNull();
    expect(verdictView(s, 2, 1, 'No verdict here')).toBeNull();
  });

  it('marks the rounds of a step with a verdict', () => {
    const s = state({}, [{ index: 2, round: 2, startedAt: new Date(2026, 9, 20, 14, 21).getTime() }]);
    expect(roundDivider(s, 2, 2)).toBe(`Round 2 · started ${clockTime(new Date(2026, 9, 20, 14, 21).getTime())}`);
    expect(roundDivider(s, 0, 1)).toBeNull();
  });

  it("sums up an action's result", () => {
    expect(actionDetail({ exitCode: 0, tail: 'Test Files  12 passed\n      Tests  214 passed (214)\n' })).toBe('exit 0 · 214 passed');
    const lint = Array.from({ length: 38 }, (_, i) => `line ${i}`).concat(['', '✖ 2 problems (2 errors, 0 warnings)']).join('\n');
    expect(actionDetail({ exitCode: 1, tail: lint })).toBe('exit 1 · 2 problems · last 40 lines attached');
    expect(actionDetail({ exitCode: null, tail: 'No action called Lint here.' })).toBe('did not run · No action called Lint here.');
  });
});
