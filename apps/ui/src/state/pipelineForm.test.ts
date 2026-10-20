import { describe, expect, it } from 'vitest';
import { BUILTIN_PIPELINES } from '@switchboard/protocol/client';
import {
  addStep,
  blankChoices,
  firstProblem,
  formProblems,
  formToSave,
  moveStep,
  newPipelineForm,
  pipelineForm,
  removeStep,
  renameStep,
  setStart,
  setVerdict,
  setWaitsBefore,
  stepDepths,
  toggleBrief,
  updateStep,
  type ClaudeForm,
  type PipelineForm,
} from './pipelineForm.ts';

const ROOT = '/work/app';
const builtin = BUILTIN_PIPELINES.find((p) => p.name === 'Plan, execute, validate, push')!;
const claude = (form: PipelineForm, i: number) => form.steps[i] as ClaudeForm;

/** The built-in four-step pipeline as a form for a project. */
const four = (): PipelineForm => ({ ...pipelineForm(builtin, ROOT), id: null, scope: 'project', root: ROOT });

describe('a new pipeline', () => {
  it('starts with one Execute step that gets the task, in the project when there is one', () => {
    const form = newPipelineForm(ROOT);
    expect(form.scope).toBe('project');
    expect(form.steps.map((s) => s.name)).toEqual(['Execute']);
    expect(claude(form, 0).prompt).toBe('{{task}}');
    expect(newPipelineForm(null).scope).toBe('global');
  });

  it('cannot be saved until it has a name', () => {
    const form = newPipelineForm(ROOT);
    expect(firstProblem(form)).toBe('Give the pipeline a name.');
    expect(formToSave({ ...form, name: ' Ship it ' })).toMatchObject({ name: 'Ship it', scope: { kind: 'project', root: ROOT }, steps: [{ kind: 'claude', name: 'Execute' }] });
  });

  it('needs a project for a project or shared scope', () => {
    const form = { ...newPipelineForm(null, 'shared'), name: 'x' };
    expect(firstProblem(form)).toBe('Choose a project.');
    expect(formToSave(form)).toBeNull();
  });
});

describe('editing the steps', () => {
  it('adds steps with free names and stops at the limit', () => {
    let form = newPipelineForm(ROOT);
    form = addStep(form, 'claude');
    form = addStep(form, 'push');
    form = addStep(form, 'push');
    expect(form.steps.map((s) => s.name)).toEqual(['Execute', 'Step 2', 'Push', 'Push 2']);
    expect(claude(form, 1).prompt).toBe('{{previous.reply}}');
    for (let i = 0; i < 20; i++) form = addStep(form, 'claude');
    expect(form.steps).toHaveLength(12);
  });

  it('renames a step everywhere it is named', () => {
    const renamed = renameStep({ ...four(), confirmBefore: ['Execute'] }, 1, 'Build');
    expect(renamed.steps[1]!.name).toBe('Build');
    expect(claude(renamed, 2).verdict?.sendTo).toBe('Build');
    expect(claude(renamed, 2).prompt).not.toContain('{{step:Execute');
    expect(renamed.confirmBefore).toEqual(['Build']);
    expect(formProblems(renamed).pipeline).toEqual([]);
  });

  it('keeps the references right when a step goes', () => {
    const form = four();
    const withFork = updateStep(form, 2, { start: { kind: 'fork', step: 'Execute' } });
    const removed = removeStep(withFork, 1);
    expect(removed.steps.map((s) => s.name)).toEqual(['Plan', 'Validate', 'Push']);
    expect(claude(removed, 1).start).toEqual({ kind: 'fresh' });
    expect(claude(removed, 1).verdict).toBeUndefined();
  });

  it('keeps one step at least', () => {
    const form = newPipelineForm(ROOT);
    expect(removeStep(form, 0)).toBe(form);
  });

  it('moves a step and not past the ends', () => {
    const form = four();
    expect(moveStep(form, 0, -1)).toBe(form);
    expect(moveStep(form, 3, 1)).toBe(form);
    expect(moveStep(form, 0, 1).steps.map((s) => s.name)).toEqual([form.steps[1]!.name, form.steps[0]!.name, form.steps[2]!.name, form.steps[3]!.name]);
  });

  it('reports a fork that comes before its source on the step, and mends when moved back', () => {
    const form = setStart(four(), 2, 'Execute');
    expect(formProblems(form).steps[2]).toEqual([]);
    const moved = moveStep(form, 2, -1);
    expect(moved.steps[1]!.name).toBe('Validate');
    expect(formProblems(moved).steps[1]!.join(' ')).toContain('comes after it');
    expect(firstProblem(moved)).toContain('Validate');
  });

  it('shows a fork one level under its source', () => {
    // Execute forks Plan (built in); Validate forks Execute, so it sits two levels down.
    const form = setStart(four(), 2, 'Execute');
    expect(stepDepths(form.steps)).toEqual([0, 1, 2, 0]);
    expect(stepDepths(four().steps)).toEqual([0, 1, 0, 0]);
  });

  it('puts briefs in the pipeline order and falls back to the step before', () => {
    let form = toggleBrief(four(), 2, 'Execute', true);
    form = toggleBrief(form, 2, 'Plan', true);
    expect(claude(form, 2).start).toEqual({ kind: 'fresh', briefOf: ['Plan', 'Execute'] });
    form = toggleBrief(toggleBrief(form, 2, 'Plan', false), 2, 'Execute', false);
    expect(claude(form, 2).start).toEqual({ kind: 'fresh' });
  });

  it('turns a verdict on towards the step before, and off', () => {
    const on = setVerdict(newPipelineForm(ROOT), 0, true);
    expect(claude(on, 0).verdict).toEqual({ sendTo: '', rounds: 2 });
    expect(firstProblem({ ...on, name: 'x' })).toContain('isn’t a step');
    const withTwo = setVerdict(addStep(newPipelineForm(ROOT), 'claude'), 1, true);
    expect(claude(withTwo, 1).verdict).toEqual({ sendTo: 'Execute', rounds: 2 });
    expect(claude(setVerdict(withTwo, 1, false), 1).verdict).toBeUndefined();
  });

  it('offers the blanks a step can take', () => {
    const form = four();
    expect(blankChoices(form, 0).map((b) => b.text)).toEqual(['{{task}}']);
    expect(blankChoices(form, 2).map((b) => b.text)).toEqual(['{{task}}', '{{previous.reply}}', '{{step:Plan.reply}}', '{{step:Execute.reply}}']);
  });

  it('waits for you before a step', () => {
    const form = setWaitsBefore(four(), 1, true);
    expect(form.confirmBefore).toEqual(['Execute']);
    expect(setWaitsBefore(form, 1, false).confirmBefore).toEqual([]);
  });
});

describe('what is wrong, and where', () => {
  it('places duplicate names and empty prompts on their steps', () => {
    let form = { ...addStep(newPipelineForm(ROOT), 'claude'), name: 'x' };
    form = renameStep(form, 1, 'Execute');
    expect(formProblems(form).steps[1]!.join(' ')).toContain('both called');
    form = updateStep(renameStep(form, 1, 'Two'), 1, { prompt: '  ' });
    expect(formProblems(form).steps[1]).toEqual(['Write the step’s prompt.']);
  });

  it('refuses bypass permissions in a shared pipeline, with the reason on the step', () => {
    const form: PipelineForm = { ...updateStep({ ...newPipelineForm(ROOT, 'shared'), name: 'x' }, 0, { permissionMode: 'bypassPermissions' }) };
    expect(formProblems(form).steps[0]!.join(' ')).toContain('can’t bypass permissions');
    expect(formToSave(form)).toBeNull();
    expect(formToSave({ ...form, scope: 'project' })).not.toBeNull();
  });

  it('leaves autoPush out of a shared pipeline', () => {
    const own = { ...four(), name: 'Ship', autoPush: true };
    expect(formToSave(own)?.autoPush).toBe(true);
    expect(formToSave({ ...own, scope: 'shared' })?.autoPush).toBeUndefined();
  });
});

describe('saving', () => {
  it('drops the keys and the empty extras, and keeps what was set', () => {
    let form = { ...four(), name: 'Mine' };
    form = updateStep(form, 1, { readOnly: false, actionsFirst: ['  ', ' test '] });
    const saved = formToSave(form)!;
    expect(saved.steps[0]).not.toHaveProperty('key');
    expect(saved.steps[1]).toMatchObject({ actionsFirst: ['test'] });
    expect(saved.steps[1]).not.toHaveProperty('readOnly');
    expect(saved.steps[3]).toMatchObject({ kind: 'push', pullRequest: { base: null, draft: false } });
  });

  it('keeps the id when editing, in the same scope', () => {
    const own = { ...builtin, id: 'abc', scope: { kind: 'global' as const } };
    const form = pipelineForm(own, ROOT);
    expect(form.scope).toBe('global');
    expect(formToSave(form)).toMatchObject({ id: 'abc', scope: { kind: 'global' } });
  });
});
