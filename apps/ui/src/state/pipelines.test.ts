import { describe, expect, it } from 'vitest';
import { BUILT_IN_PIPELINES, type PipelineRunState } from '@switchboard/protocol/client';
import { finishedLine, mentionChoices, modelWord, runHeaderLine, stepLabel, stepSummary, stepView, stopAdvice, treeLines } from './pipelines.ts';

const pipeline = { ...BUILT_IN_PIPELINES[0]!, builtIn: true, createdAt: 0, updatedAt: 0 };

const state = (over: Partial<PipelineRunState['run']> = {}, steps: Array<Partial<PipelineRunState['steps'][number]>> = []): PipelineRunState => ({
  run: { id: 'run-1', pipelineId: pipeline.id, pipeline, parentSessionId: 'p', task: null, title: 'Add a usage cost toggle', projectRoot: '/p', cwd: '/p', profileId: null, status: 'running', reason: null, waitingFor: null, hold: null, step: 2, round: 2, sentBackTo: null, pr: null, createdAt: 0, updatedAt: 0, endedAt: null, ...over },
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
