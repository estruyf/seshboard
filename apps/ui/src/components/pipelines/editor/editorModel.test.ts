import { describe, expect, it } from 'vitest';
import { BUILT_IN_PIPELINES, PIPELINE_LIMITS, type Pipeline, type PipelineClaudeStep } from '@seshboard/protocol/client';
import {
  addStep,
  canMove,
  filterChoices,
  formIssues,
  formOf,
  insertMention,
  isDirty,
  mentionQuery,
  moveStep,
  newPipelineForm,
  pipelineGroups,
  pipelineRowDetail,
  promptParts,
  removeStep,
  renameStep,
  toSave,
  updateStep,
  verdictOn,
  type PipelineForm,
} from './editorModel.ts';

const builtIn = (i: number): Pipeline => ({ ...BUILT_IN_PIPELINES[i]!, builtIn: true, createdAt: 0, updatedAt: 0 });
/** Plan, Execute, Validate, Push. */
const full = () => formOf(builtIn(0));
const claude = (form: PipelineForm, i: number) => form.steps[i] as PipelineClaudeStep;
const names = (form: PipelineForm) => form.steps.map((s) => s.name);

describe('the form', () => {
  it('starts a new pipeline with one step that links the parent', () => {
    const form = newPipelineForm();
    expect(form.id).toBeNull();
    expect(names(form)).toEqual(['Step 1']);
    expect(claude(form, 0).prompt).toContain('@parent');
    // Only the name is missing.
    expect(formIssues(form).map((i) => i.message)).toEqual(['Give the pipeline a name.']);
  });

  it('asks for a project when it is for one', () => {
    const form = { ...newPipelineForm({ kind: 'project', root: '' }), name: 'Mine' };
    expect(formIssues(form).map((i) => i.message)).toEqual(['Pick a project.']);
  });

  it('turns into what the engine saves, with names trimmed', () => {
    let form = { ...newPipelineForm(), name: '  Mine ' };
    form = renameStep(form, 0, ' Build ');
    form = updateStep<PipelineClaudeStep>(form, 0, { actionsFirst: [' Test', 'Test', ''] });
    const save = toSave(form);
    expect(save).not.toHaveProperty('id');
    expect(save.name).toBe('Mine');
    expect(save.steps[0]).toMatchObject({ name: 'Build', actionsFirst: ['Test'] });
    expect(toSave(full()).id).toBe('builtin-plan-execute-validate-push');
  });

  it('knows when it changed', () => {
    const saved = builtIn(0);
    const form = formOf(saved);
    expect(isDirty(form, saved)).toBe(false);
    expect(isDirty(updateStep<PipelineClaudeStep>(form, 0, { readOnly: true }), saved)).toBe(true);
    expect(isDirty(form, null)).toBe(true);
  });
});

describe('adding, moving and removing steps', () => {
  it('adds a step before Push, and Push only once at the end', () => {
    const { form, index } = addStep(full(), 'claude');
    expect(index).toBe(3);
    expect(names(form)).toEqual(['Plan', 'Execute', 'Validate', 'Step 5', 'Push']);
    expect(addStep(form, 'push').index).toBe(-1);
    const noPush = removeStep(full(), 3);
    const added = addStep(noPush, 'push');
    expect(names(added.form).at(-1)).toBe('Push');
    // Keys stay unique.
    expect(new Set(form.keys).size).toBe(form.keys.length);
  });

  it(`stops at ${PIPELINE_LIMITS.steps} steps`, () => {
    let form = newPipelineForm();
    for (let i = 0; i < 20; i++) form = addStep(form, 'claude').form;
    expect(form.steps.length).toBe(PIPELINE_LIMITS.steps);
  });

  it('keeps Push last when moving', () => {
    const form = full();
    expect(canMove(form, 2, 1)).toBe(false);
    expect(canMove(form, 3, -1)).toBe(false);
    expect(canMove(form, 0, -1)).toBe(false);
    expect(canMove(form, 1, -1)).toBe(true);
    expect(names(moveStep(form, 0, 3))).toEqual(['Execute', 'Validate', 'Plan', 'Push']);
    expect(moveStep(form, 3, 0)).toBe(form);
  });

  it('moves keys with their steps, and shows a fork that now points forward', () => {
    const form = full();
    const moved = moveStep(form, 1, 0);
    expect(moved.keys).toEqual([1, 0, 2, 3]);
    expect(formIssues(moved).some((i) => i.step === 0 && /forks Plan/.test(i.message))).toBe(true);
  });

  it('removing a step makes its forks fresh and sends verdicts to the step before', () => {
    const form = removeStep(full(), 1);
    expect(names(form)).toEqual(['Plan', 'Validate', 'Push']);
    expect(claude(form, 1).verdict).toEqual({ sendTo: 'Plan', rounds: 2 });
    const noPlan = removeStep(full(), 0);
    expect(claude(noPlan, 0).start).toBe('fresh');
  });

  it('offers a verdict only with a step before to send changes to', () => {
    const form = full();
    expect(verdictOn(form.steps, 0)).toBeNull();
    expect(verdictOn(form.steps, 2)).toEqual({ sendTo: 'Execute', rounds: 2 });
  });
});

describe('renaming a step', () => {
  it('follows its forks, verdicts and @mentions', () => {
    const form = renameStep(full(), 1, 'Build');
    expect(claude(form, 2).verdict?.sendTo).toBe('Build');
    expect(claude(form, 2).prompt).toContain('@Build against');
    const plan = renameStep(full(), 0, 'Think');
    expect(claude(plan, 1).start).toEqual({ fork: 'Think' });
    expect(formIssues({ ...plan, name: 'x' })).toEqual([]);
  });

  it('keeps the references while the name is empty or taken, then follows the next usable one', () => {
    let form = renameStep(full(), 1, '');
    expect(claude(form, 2).verdict?.sendTo).toBe('Execute');
    form = renameStep(form, 1, 'Plan');
    expect(claude(form, 2).verdict?.sendTo).toBe('Execute');
    form = renameStep(form, 1, 'Planner');
    expect(claude(form, 2).verdict?.sendTo).toBe('Planner');
    expect(claude(form, 2).prompt).toContain('@Planner');
    // Plan's own fork is untouched.
    expect(claude(form, 1).start).toEqual({ fork: 'Plan' });
    expect(formIssues(form)).toEqual([]);
  });

  it('never takes "parent"', () => {
    const form = renameStep(full(), 1, 'parent');
    expect(claude(form, 2).prompt).toContain('@Execute');
    expect(formIssues(form).some((i) => i.step === 1)).toBe(true);
  });
});

describe('the prompt field', () => {
  it('finds the @ being typed', () => {
    expect(mentionQuery('Check @Exe', 10)).toEqual({ start: 6, query: 'Exe' });
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionQuery('mail@example', 12)).toBeNull();
    expect(mentionQuery('Check @Exe now', 14)).toBeNull();
  });

  it('puts a mention in with a space after it', () => {
    expect(insertMention('Check @Ex', 6, 9, 'Execute')).toEqual({ text: 'Check @Execute ', caret: 15 });
    expect(insertMention('Check @Ex now', 6, 9, 'Execute')).toEqual({ text: 'Check @Execute now', caret: 15 });
  });

  it('lists choices that start with the query first', () => {
    expect(filterChoices(['parent', 'Plan', 'Execute'], 'p')).toEqual(['parent', 'Plan']);
    expect(filterChoices(['parent', 'Plan', 'Execute'], 'e')).toEqual(['Execute', 'parent']);
  });

  it('splits a prompt into text and the mentions it can link', () => {
    const parts = promptParts('Check @Execute against @parent and @Nope.', ['parent', 'Plan', 'Execute']);
    expect(parts.filter((p) => p.mention).map((p) => p.text)).toEqual(['@Execute', '@parent']);
    expect(parts.map((p) => p.text).join('')).toBe('Check @Execute against @parent and @Nope.');
  });
});

describe('the list', () => {
  const mine = (id: string, scope: Pipeline['scope']): Pipeline => ({ id, name: id, scope, steps: [], autoPush: false, builtIn: false, createdAt: 0, updatedAt: 0 });

  it('groups built-ins, every project’s, then each project by name', () => {
    const groups = pipelineGroups([builtIn(0), mine('a', { kind: 'project', root: '/z' }), mine('b', { kind: 'all' }), mine('c', { kind: 'project', root: '/y' })], (root) => (root === '/z' ? 'Alpha' : 'Beta'));
    expect(groups.map((g) => g.label)).toEqual(['Built in', 'All projects', 'Alpha', 'Beta']);
  });

  it('says how many steps, and when it is one project’s', () => {
    expect(pipelineRowDetail(builtIn(0))).toBe('4 steps');
    expect(pipelineRowDetail({ ...mine('x', { kind: 'project', root: '/a' }), steps: builtIn(1).steps })).toBe('2 steps · this project');
  });
});
