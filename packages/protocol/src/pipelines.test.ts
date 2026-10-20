import { describe, expect, it } from 'vitest';
import { PipelineSave, type PipelineClaudeStep, type PipelineRunState, type PipelineStep } from './pipelineSchema.ts';
import {
  BUILT_IN_PIPELINES,
  changesMessage,
  enterStep,
  fillStepPrompt,
  mentionsIn,
  mostUrgent,
  nextStep,
  parseActionResults,
  parseRunBriefs,
  pipelineIssues,
  readVerdict,
  runProgress,
  sidebarTree,
  stepTitle,
  writeRunBrief,
  writeRunStub,
  type StepResult,
  type TreeRow,
} from './pipelines.ts';
import { parseBriefs } from './sessionLinks.ts';

const claude = (name: string, over: Partial<PipelineClaudeStep> = {}): PipelineClaudeStep => ({
  kind: 'claude',
  name,
  start: 'fresh',
  model: null,
  effort: null,
  permissionMode: null,
  readOnly: false,
  prompt: `Do ${name} for @parent.`,
  actionsFirst: [],
  verdict: null,
  confirmBefore: false,
  ...over,
});
const push: PipelineStep = { kind: 'push', name: 'Push', draft: false };
const [planExecute] = BUILT_IN_PIPELINES;
const steps = planExecute!.steps;
const clean: StepResult = { outcome: 'clean', waitsForYou: false, verdict: null };
const at = (step: number, round = 1, sentBackTo: number | null = null, autoPush = false) => ({ step, round, sentBackTo, autoPush });

describe('pipelineIssues', () => {
  it('accepts the built-ins', () => {
    for (const pipeline of BUILT_IN_PIPELINES) expect(pipelineIssues(pipeline)).toEqual([]);
  });

  it('refuses a fork of a step that comes later, or of one that does not exist', () => {
    expect(pipelineIssues({ steps: [claude('A', { start: { fork: 'B' } }), claude('B')] }).map((i) => i.message)).toEqual(['A forks B, which doesn’t come before it.']);
    expect(pipelineIssues({ steps: [claude('A', { start: { fork: 'Nope' } })] })[0]!.message).toBe('A forks Nope, and there is no step called that.');
    expect(pipelineIssues({ steps: [claude('A', { start: { fork: 'A' } })] })[0]!.message).toBe('A forks A, which doesn’t come before it.');
  });

  it('refuses sendTo naming a step that does not exist or comes later', () => {
    expect(pipelineIssues({ steps: [claude('A'), claude('V', { verdict: { sendTo: 'Build', rounds: 2 } })] })[0]).toEqual({ step: 1, message: 'V sends changes to Build, and there is no step called that.' });
    expect(pipelineIssues({ steps: [claude('V', { verdict: { sendTo: 'A', rounds: 2 } }), claude('A')] })[0]!.step).toBe(0);
  });

  it('wants Push last, and once', () => {
    expect(pipelineIssues({ steps: [push, claude('A')] }).map((i) => i.message)).toEqual(['Push has to be the last step.']);
    expect(pipelineIssues({ steps: [claude('A'), { ...push, name: 'P1' }, { ...push, name: 'P2' }] }).map((i) => i.message)).toContain('A pipeline has one Push step at most.');
  });

  it('refuses duplicate and empty names, and a step called parent', () => {
    expect(pipelineIssues({ steps: [claude('A'), claude('A')] }).map((i) => i.message)).toEqual(['Two steps are called A.']);
    expect(pipelineIssues({ steps: [claude(' ')] }).map((i) => i.message)).toContain('Step 1 needs a name.');
    expect(pipelineIssues({ steps: [claude('Parent')] }).map((i) => i.message)).toContain('“parent” is taken: @parent links the session you run it from.');
  });

  it('refuses @ naming a step that is not before this one, or no step at all', () => {
    const issues = pipelineIssues({ steps: [claude('A', { prompt: 'Look at @B and @parent.' }), claude('B', { prompt: 'Check @A and @Nobody, mail me@example.com' })] });
    expect(issues.map((i) => i.message)).toEqual(['@B in A’s prompt isn’t a step before it.', '@Nobody in B’s prompt names no step. Use @parent or an earlier step.']);
  });

  it('wants a prompt', () => {
    expect(pipelineIssues({ steps: [claude('A', { prompt: '  ' })] }).map((i) => i.message)).toEqual(['Write a prompt for A.']);
  });

  it('is what PipelineSave refuses', () => {
    const result = PipelineSave.safeParse({ name: 'Bad', scope: { kind: 'all' }, steps: [push, claude('A')] });
    expect(result.success).toBe(false);
    expect(PipelineSave.safeParse({ name: 'Good', scope: { kind: 'all' }, steps: [claude('A'), push] }).success).toBe(true);
  });
});

describe('mentionsIn', () => {
  it('finds the longest step name, and leaves e-mail addresses alone', () => {
    expect(mentionsIn('see @Validate all, @Validate. a@b.c', ['Validate', 'Validate all']).map((m) => m.name)).toEqual(['Validate all', 'Validate']);
    expect(mentionsIn('@Validated', ['Validate'])).toEqual([{ at: 0, name: null, word: 'Validated' }]);
  });
});

describe('readVerdict', () => {
  it('reads pass and changes needed in any case', () => {
    expect(readVerdict('All good.\n\nVerdict: pass')).toEqual({ kind: 'pass', items: [] });
    expect(readVerdict('verdict: PASS')).toEqual({ kind: 'pass', items: [] });
    expect(readVerdict('VERDICT: Changes Needed\n- one\n- two')).toEqual({ kind: 'changes', items: ['one', 'two'] });
  });

  it('reads it in bold, in code and as a heading', () => {
    expect(readVerdict('**Verdict: changes needed**\n1. Fix the tooltip.\n2) Two lint errors.')).toEqual({ kind: 'changes', items: ['Fix the tooltip.', 'Two lint errors.'] });
    expect(readVerdict('**Verdict:** pass')?.kind).toBe('pass');
    expect(readVerdict('`Verdict: pass`')?.kind).toBe('pass');
    expect(readVerdict('## Verdict: changes-needed')?.kind).toBe('changes');
  });

  it('takes the last verdict line', () => {
    expect(readVerdict('I will end with Verdict: pass or not.\nVerdict: changes needed\n- fix it')).toEqual({ kind: 'changes', items: ['fix it'] });
    expect(readVerdict('Verdict: changes needed\n- a\n\nVerdict: pass')).toEqual({ kind: 'pass', items: [] });
  });

  it('joins a wrapped item to the one above it', () => {
    expect(readVerdict('Verdict: changes needed\n- LimitsCard still shows\n  the cost.\n- Lint')!.items).toEqual(['LimitsCard still shows the cost.', 'Lint']);
  });

  it('is null without a verdict line', () => {
    expect(readVerdict('Looks fine to me.')).toBeNull();
    expect(readVerdict('Verdict: maybe')).toBeNull();
    expect(readVerdict('')).toBeNull();
    expect(readVerdict(null)).toBeNull();
  });
});

describe('nextStep', () => {
  it('goes to the next step after a clean turn', () => {
    expect(nextStep(at(0), steps, clean)).toEqual({ kind: 'start', index: 1, round: 1 });
  });

  it('stops on an error, a stop, and when Claude waits for you', () => {
    expect(nextStep(at(1), steps, { ...clean, outcome: 'error' })).toEqual({ kind: 'stop', reason: 'Execute ended with an error.' });
    expect(nextStep(at(1), steps, { ...clean, outcome: 'stopped' })).toEqual({ kind: 'stop', reason: 'Execute was stopped.' });
    expect(nextStep(at(0), steps, { ...clean, waitsForYou: true })).toEqual({ kind: 'stop', reason: 'Plan waits for you.' });
  });

  it('stops on a missing verdict', () => {
    expect(nextStep(at(2), steps, clean)).toEqual({ kind: 'stop', reason: 'Validate has no verdict.' });
  });

  it('sends changes back, then runs the step again as the next round', () => {
    const changes = { ...clean, verdict: { kind: 'changes' as const, items: ['fix'] } };
    expect(nextStep(at(2, 1), steps, changes)).toEqual({ kind: 'sendBack', to: 1, from: 2, round: 2 });
    // Execute's turn after the changes ended cleanly: Validate round 2.
    expect(nextStep(at(2, 2, 1), steps, clean)).toEqual({ kind: 'start', index: 2, round: 2 });
    expect(nextStep(at(2, 2, 1), steps, { ...clean, outcome: 'error' })).toEqual({ kind: 'stop', reason: 'Execute ended with an error.' });
    expect(nextStep(at(2, 2, 1), steps, { ...clean, waitsForYou: true })).toEqual({ kind: 'stop', reason: 'Execute waits for you.' });
  });

  it('stops when changes are still needed after the last round', () => {
    const changes = { ...clean, verdict: { kind: 'changes' as const, items: [] } };
    expect(nextStep(at(2, 2), steps, changes)).toEqual({ kind: 'stop', reason: 'Still changes needed after 2 rounds.' });
    expect(nextStep(at(0, 1), [claude('V', { verdict: { sendTo: 'V', rounds: 1 } })], changes)).toEqual({ kind: 'stop', reason: 'Still changes needed after 1 round.' });
  });

  it('a verdict decides, even when the catch-up says Claude asks back', () => {
    expect(nextStep(at(2), steps, { outcome: 'clean', waitsForYou: true, verdict: { kind: 'pass', items: [] } })).toEqual({ kind: 'confirm', index: 3, wait: 'push', reason: 'Push waits for you.' });
  });

  it('waits before Push unless autoPush, and before a step with confirmBefore', () => {
    const pass = { ...clean, verdict: { kind: 'pass' as const, items: [] } };
    expect(nextStep(at(2, 1, null, true), steps, pass)).toEqual({ kind: 'push', index: 3 });
    expect(enterStep([claude('A'), claude('B', { confirmBefore: true })], 1, false)).toEqual({ kind: 'confirm', index: 1, wait: 'confirm', reason: 'B waits for you to start it.' });
  });

  it('is done after the last step', () => {
    expect(nextStep(at(1), BUILT_IN_PIPELINES[1]!.steps, { ...clean, verdict: { kind: 'pass', items: [] } })).toEqual({ kind: 'done' });
    expect(nextStep(at(3), steps, clean)).toEqual({ kind: 'done' });
  });
});

describe('fillStepPrompt', () => {
  const parent = { kind: 'session' as const, sessionId: 'parent-id', label: 'Add a usage cost toggle' };

  it('turns @parent and @<step> into session links, with the labels in the text', () => {
    const filled = fillStepPrompt(claude('Validate', { prompt: 'Check @Execute against @parent. Then @Execute again.' }), { task: null, parent, steps: { Plan: 'plan-id', Execute: 'exec-id' } });
    const { text, briefs } = parseBriefs(filled.text);
    expect(text).toBe('Check @Execute against @Add a usage cost toggle. Then @Execute again.');
    expect(briefs.map((b) => [b.label, b.sessionId, b.stub])).toEqual([
      ['Execute', 'exec-id', true],
      ['Add a usage cost toggle', 'parent-id', true],
    ]);
    expect(filled.links).toEqual([
      { label: 'Execute', sessionId: 'exec-id' },
      { label: 'Add a usage cost toggle', sessionId: 'parent-id' },
    ]);
  });

  it('fills {{task}} and other blanks, and keeps an escaped one', () => {
    const filled = fillStepPrompt(claude('A', { prompt: '{{task}} on {{branch}}, not \\{{task}} or {{nope}}' }), { task: 'Add dark mode', parent, steps: {}, fields: { branch: 'main' } });
    expect(filled.text).toBe('Add dark mode on main, not {{task}} or {{nope}}');
  });

  it('gives a run row’s task as a block, since there is no session to link', () => {
    const filled = fillStepPrompt(claude('Plan'), { task: 'Add dark mode\nto the remote app', parent: { kind: 'task', label: 'Add dark mode', text: 'Add dark mode\nto the remote app' }, steps: {} });
    expect(filled.links).toEqual([]);
    expect(filled.text).toBe('Do Plan for @Add dark mode.\n\nThe task, from @Add dark mode:\n```text\nAdd dark mode\nto the remote app\n```');
  });

  it('leaves an unknown @ name as it is', () => {
    expect(fillStepPrompt(claude('A', { prompt: 'Ask @Bob' }), { task: null, parent, steps: {} }).text).toBe('Ask @Bob');
  });

  it('puts the actions’ results in the prompt, and reads them back for the card', () => {
    const filled = fillStepPrompt(claude('Validate', { prompt: 'Check it.' }), {
      task: null,
      parent,
      steps: {},
      actions: [
        { name: 'Test', exitCode: 0, tail: '214 passed', ms: 1200 },
        { name: 'Lint', exitCode: 1, tail: 'UsageBars.tsx: unused import\n```', ms: 300 },
        { name: 'Types', exitCode: null, tail: 'There is no action called Types here.', ms: 0 },
      ],
    });
    const read = parseActionResults(filled.text);
    expect(read.text).toBe('Check it.');
    expect(read.actions).toEqual([
      { name: 'Test', exitCode: 0, tail: '214 passed' },
      { name: 'Lint', exitCode: 1, tail: 'UsageBars.tsx: unused import\n```' },
      { name: 'Types', exitCode: null, tail: 'There is no action called Types here.' },
    ]);
  });
});

describe('changesMessage', () => {
  it('lists the changes and links the step that found them', () => {
    const text = changesMessage({ name: 'Validate', sessionId: 'v1' }, { kind: 'changes', items: ['Fix the tooltip', 'Lint'] }, 1, 3);
    const { text: typed, briefs } = parseBriefs(text);
    expect(typed).toContain('@Validate found changes needed (round 1 of 3):\n\n1. Fix the tooltip\n2. Lint');
    expect(briefs.map((b) => b.sessionId)).toEqual(['v1']);
  });
});

const runState = (over: Partial<PipelineRunState['run']> = {}, stepRows: Array<Partial<PipelineRunState['steps'][number]>> = []): PipelineRunState => ({
  run: {
    id: 'run-1',
    pipelineId: planExecute!.id,
    pipeline: { ...planExecute!, builtIn: true, createdAt: 0, updatedAt: 0 },
    parentSessionId: 'parent',
    task: null,
    title: 'Add a usage cost toggle',
    projectRoot: '/p',
    cwd: '/p/.claude/worktrees/usage',
    profileId: null,
    status: 'running',
    reason: null,
    waitingFor: null,
    hold: null,
    step: 2,
    round: 1,
    sentBackTo: null,
    pr: null,
    createdAt: 0,
    updatedAt: 0,
    endedAt: null,
    ...over,
  },
  steps: stepRows.map((row, i) => ({ runId: 'run-1', step: 'Plan', index: i, round: 1, sessionId: `s${i}`, status: 'done', outcome: 'clean', verdict: null, reason: null, plan: null, actions: [], startedAt: 0, endedAt: null, ...row })),
});

describe('runs', () => {
  it('says where a run is', () => {
    expect(runProgress(runState().run)).toBe('Validate · 3 of 4');
    expect(runProgress(runState({ round: 2 }).run)).toBe('Validate · round 2 · 3 of 4');
    expect(runProgress(runState({ status: 'done', step: 3 }).run)).toBe('Done · 4 of 4');
    expect(stepTitle('Validate', 1)).toBe('Validate');
    expect(stepTitle('Validate', 2)).toBe('Validate · round 2');
  });

  it('writes a run brief that reads back, and a stub', () => {
    const state = runState({ status: 'waiting', reason: 'Validate has no verdict.', pr: { number: 152, url: 'https://github.com/o/r/pull/152' } }, [
      { step: 'Plan', reason: 'plan approved' },
      { step: 'Validate', index: 2, verdict: { kind: 'changes', items: ['fix'] }, status: 'failed' },
    ]);
    const brief = writeRunBrief(state);
    const read = parseRunBriefs(`what did the review find?\n\n${brief}`);
    expect(read.text).toBe('what did the review find?');
    expect(read.runs[0]).toMatchObject({ label: 'Plan, execute, validate, push', runId: 'run-1', stub: false });
    expect(read.runs[0]!.body).toContain('- Validate: failed, verdict changes needed (fix), session s1');
    expect(read.runs[0]!.body).toContain('pull request: #152');
    expect(parseRunBriefs(`hi\n\n${writeRunStub('Plan, execute', 'run-1')}`).runs).toEqual([{ label: 'Plan, execute', runId: 'run-1', stub: true, body: '' }]);
  });

  it('cuts a long run brief to its budget', () => {
    const state = runState({}, Array.from({ length: 30 }, (_, i) => ({ step: `Step ${i}`, reason: 'x'.repeat(400) })));
    expect(writeRunBrief(state, 2_000).length).toBeLessThanOrEqual(2_000);
  });
});

describe('sidebarTree', () => {
  const row = (id: string, parentId: string | null, status: TreeRow['status'] = 'idle', createdAt = 0): TreeRow => ({ id, parentId, status, createdAt });

  it('nests children under their parent in step order, rounds included', () => {
    const state = runState({}, [
      { sessionId: 'plan', index: 0 },
      { sessionId: 'exec', index: 1 },
      { sessionId: 'val2', index: 2, round: 2 },
      { sessionId: 'val1', index: 2, round: 1 },
    ]);
    const tree = sidebarTree([row('val2', 'parent'), row('parent', null), row('exec', 'parent'), row('val1', 'parent'), row('plan', 'parent'), row('other', null)], [state]);
    expect(tree.roots.map((r) => r.id)).toEqual(['parent', 'other']);
    expect(tree.children.get('parent')!.map((r) => r.id)).toEqual(['plan', 'exec', 'val1', 'val2']);
  });

  it('gives the parent the most urgent state of its own and its children', () => {
    const tree = sidebarTree([row('parent', null, 'unread'), row('a', 'parent', 'working'), row('b', 'parent', 'needsYou')]);
    expect(tree.status.get('parent')).toBe('needsYou');
    expect(sidebarTree([row('parent', null, 'idle'), row('a', 'parent', 'working')]).status.get('parent')).toBe('working');
    expect(mostUrgent(['idle', 'unread', 'failed'])).toBe('failed');
  });

  it('nests under a run row, and shows a child whose parent is gone on its own', () => {
    const state = runState({ id: 'run-9', parentSessionId: null }, [{ sessionId: 'plan' }]);
    const tree = sidebarTree([row('plan', 'run-9', 'working'), row('orphan', 'gone')], [state]);
    expect(tree.children.get('run-9')!.map((r) => r.id)).toEqual(['plan']);
    expect(tree.status.get('run-9')).toBe('working');
    expect(tree.roots.map((r) => r.id)).toEqual(['orphan']);
  });

  it('takes the run’s own state, so a run at Push makes the parent Needs you', () => {
    const state = runState({ status: 'waiting', waitingFor: 'push' }, [{ sessionId: 'plan' }]);
    const tree = sidebarTree([row('parent', null), row('plan', 'parent', 'idle')], [state], (s) => (s.run.status === 'waiting' ? 'needsYou' : null));
    expect(tree.status.get('parent')).toBe('needsYou');
  });
});
