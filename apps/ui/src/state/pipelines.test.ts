import { describe, expect, it } from 'vitest';
import { BUILT_IN_PIPELINES, type PipelineRunState } from '@switchboard/protocol/client';
import { boxChoiceUse, finishedLine, keptRunAs, mentionChoices, pipelineMeta, runAsLabel, runAsOrder, runAsSteps, modelWord, runHeaderLine, stepLabel, stepSummary, stepView, stopAdvice, treeLines } from './pipelines.ts';

const pipeline = { ...BUILT_IN_PIPELINES[0]!, builtIn: true, createdAt: 0, updatedAt: 0 };

const state = (over: Partial<PipelineRunState['run']> = {}, steps: Array<Partial<PipelineRunState['steps'][number]>> = []): PipelineRunState => ({
  run: { id: 'run-1', pipelineId: pipeline.id, pipeline, parentSessionId: 'p', task: null, title: 'Add a usage cost toggle', projectRoot: '/p', cwd: '/p', profileId: null, status: 'running', reason: null, waitingFor: null, hold: null, step: 2, round: 2, sentBackTo: null, pr: null, createdAt: 0, updatedAt: 0, endedAt: null, archivedAt: null, restoredAt: null, ...over },
  steps: steps.map((s, i) => ({ runId: 'run-1', step: 'Plan', index: i, round: 1, sessionId: `s${i}`, status: 'done', outcome: 'clean', verdict: null, reason: null, plan: null, actions: [], startedAt: 0, endedAt: 240_000, ...s })),
});

describe('pipeline words', () => {
  it('names models and folds a step to one line', () => {
    expect(modelWord('opus')).toBe('Opus');
    expect(modelWord('claude-sonnet-5-5')).toBe('Sonnet');
    expect(modelWord(null)).toBe('Default model');
    expect(stepSummary(pipeline.steps[0]!, pipeline)).toBe('Fresh · Opus · plan mode · @parent');
    expect(stepSummary(pipeline.steps[1]!, pipeline)).toBe('Fork of Plan · Sonnet · Accept edits · @parent');
    expect(stepSummary(pipeline.steps[2]!, pipeline)).toBe('Fresh · Opus · read only · @Execute · @parent · runs Test, Lint first · ↺ Execute ×2');
    expect(stepSummary(pipeline.steps[3]!, pipeline)).toBe('commit, push, pull request · waits for you');
  });

  it('draws the tree it makes', () => {
    const lines = treeLines(pipeline).map((l) => `${l.name}${l.detail}`.trimEnd());
    expect(lines[0]).toBe('<your task>');
    expect(lines[1]).toMatch(/^├─ Plan\s+Opus · plan mode$/);
    expect(lines[2]).toMatch(/^├─ Execute\s+Sonnet · fork$/);
    expect(lines[4]).toMatch(/^│\s+↺ Execute, 2 rounds$/);
    expect(lines[5]).toMatch(/^└─ Push\s+waits for you$/);
  });

  it('offers the parent and earlier sessions after @', () => {
    expect(mentionChoices(pipeline.steps, 2)).toEqual(['parent', 'Plan', 'Execute']);
    expect(mentionChoices(pipeline.steps, 0)).toEqual(['parent']);
  });

  it('labels steps for screen readers', () => {
    const s = state({}, [{ step: 'Plan' }, { step: 'Execute', index: 1 }, { step: 'Validate', index: 2, round: 2, status: 'working' }]);
    expect(stepLabel(s, 2)).toBe('Validate, round 2 of 2, working, Opus, read only');
    expect(stepView(s, 3).view).toBe('waiting');
    expect(stepView(state({ status: 'waiting', waitingFor: 'push', step: 3 }), 3).view).toBe('needsYou');
  });

  it('says how a run and its steps went, and what to do after a stop', () => {
    expect(runHeaderLine(state({ createdAt: 0 }), 18 * 60_000)).toBe('step 3 of 4 · 18m');
    expect(finishedLine(state({}, [{ step: 'Plan', reason: 'plan approved' }]).steps[0]!)).toBe('Plan finished · plan approved · 4m');
    expect(finishedLine(state({}, [{ step: 'Validate', verdict: { kind: 'changes', items: [] }, reason: 'Changes needed: sent to Execute.' }]).steps[0]!)).toBe('Validate: changes needed · Changes needed: sent to Execute');
    expect(stopAdvice(state({ status: 'waiting', waitingFor: 'you', reason: 'Execute ended with an error.', step: 1 }))).toBe('Run this step again, or reply in Execute.');
    expect(stopAdvice(state({ status: 'waiting', waitingFor: 'you', reason: 'Still changes needed after 2 rounds.' }))).toBe('Look at Validate · round 2, then Continue or Stop the run.');
    expect(stopAdvice(state({ status: 'paused', reason: 'Paused' }))).toBe('The run goes on at the next start.');
  });
});

describe('the Run as chip', () => {
  const executeValidate = { ...BUILT_IN_PIPELINES[1]!, builtIn: true, createdAt: 0, updatedAt: 0 };

  it('sums up what each step uses on one line', () => {
    expect(pipelineMeta(pipeline)).toBe('Plan: Opus · Execute: Sonnet · Validate: Opus · Push');
    expect(pipelineMeta(executeValidate)).toBe('Execute: Sonnet · Validate: Opus');
  });

  it('lists the last used first, then the built-ins, then the rest by name', () => {
    const mine = (id: string, name: string) => ({ id, name, builtIn: false });
    const list = [pipeline, mine('z', 'Zed'), executeValidate, mine('a', 'Audit')];
    expect(runAsOrder(list, null).map((p) => p.id)).toEqual([pipeline.id, executeValidate.id, 'a', 'z']);
    expect(runAsOrder(list, 'z').map((p) => p.id)).toEqual(['z', pipeline.id, executeValidate.id, 'a']);
    expect(runAsOrder(list, executeValidate.id).map((p) => p.id)).toEqual([executeValidate.id, pipeline.id, 'a', 'z']);
    expect(runAsOrder(list, 'gone').map((p) => p.id)).toEqual([pipeline.id, executeValidate.id, 'a', 'z']);
  });

  it('keeps the pick only where the project can run it', () => {
    expect(keptRunAs(pipeline.id, [pipeline, executeValidate])).toBe(pipeline.id);
    // Another project without it, or the pipeline deleted.
    expect(keptRunAs('mine', [pipeline, executeValidate])).toBeNull();
    expect(keptRunAs(null, [pipeline])).toBeNull();
  });

  it('shows each step with who does it, Push with you', () => {
    expect(runAsSteps(pipeline)).toEqual([
      { name: 'Plan', who: 'Opus' },
      { name: 'Execute', who: 'Sonnet' },
      { name: 'Validate', who: 'Opus' },
      { name: 'Push', who: 'you' },
    ]);
    expect(runAsSteps({ ...pipeline, autoPush: true }).at(-1)).toEqual({ name: 'Push', who: 'by itself' });
    const open = { steps: [{ ...pipeline.steps[0]!, model: null }], autoPush: false } as typeof pipeline;
    expect(runAsSteps(open, 'Haiku')).toEqual([{ name: 'Plan', who: 'Haiku' }]);
    expect(runAsSteps(open)).toEqual([{ name: 'Plan', who: 'Default model' }]);
  });

  it('reads the steps out in one sentence', () => {
    expect(runAsLabel(pipeline.name, runAsSteps(pipeline))).toBe('Runs as Plan, execute, validate, push: Plan with Opus, Execute with Sonnet, Validate with Opus, then Push');
    expect(runAsLabel(executeValidate.name, runAsSteps(executeValidate))).toBe('Runs as Execute and validate: Execute with Sonnet, then Validate with Opus');
  });

  it('dims the chips no step uses, and names the steps that use the others', () => {
    expect(boxChoiceUse(pipeline)).toEqual({
      model: { dim: true, note: 'The pipeline sets this for each step.' },
      effort: { dim: false, note: 'Used by steps without their own: Execute.' },
      permissionMode: { dim: true, note: 'The pipeline sets this for each step.' },
    });
    const own = { steps: pipeline.steps.map((s) => (s.kind === 'claude' ? { ...s, effort: s.effort ?? 'low' } : s)) };
    expect(Object.values(boxChoiceUse(own)).every((u) => u.dim)).toBe(true);
  });
});
