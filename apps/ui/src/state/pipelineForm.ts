import { PIPELINE_LIMITS, sharedPipelineIssues, validatePipeline, type Pipeline, type PipelineSave, type PipelineSaveScope } from '@switchboard/protocol/client';

// The pipeline editor's form (#179), without React: what a pipeline looks like while it is edited, the changes the
// buttons make (renaming a step keeps every name that points at it right), what is wrong with it and what
// `pipelines.save` gets. The rules for a valid pipeline are the protocol's (`validatePipeline`, `sharedPipelineIssues`);
// this only says where to show them.

type AnyStep = Pipeline['steps'][number];
export type ClaudeForm = Extract<AnyStep, { kind: 'claude' }> & { key: string };
export type PushForm = Extract<AnyStep, { kind: 'push' }> & { key: string };
export type StepForm = ClaudeForm | PushForm;

export type FormScope = 'global' | 'project' | 'shared';

export interface PipelineForm {
  /** The pipeline being edited; null for a new one. */
  id: string | null;
  name: string;
  workspace: 'worktree' | 'current';
  scope: FormScope;
  /** The project a `project` or `shared` pipeline belongs to. */
  root: string | null;
  autoPush: boolean;
  confirmBefore: string[];
  steps: StepForm[];
}

let counter = 0;
/** A key that stays with a step card while it is renamed and moved. */
export const stepKey = () => `step-${++counter}`;

const claudeStep = (name: string, prompt: string): ClaudeForm => ({ key: stepKey(), kind: 'claude', name, prompt, start: { kind: 'fresh' }, model: null, effort: null, permissionMode: null });

const pushStep = (name: string): PushForm => ({ key: stepKey(), kind: 'push', name, commit: true, pullRequest: null });

/** A new pipeline: one Claude step that gets the task, in the project when there is one. */
export function newPipelineForm(root: string | null, scope?: FormScope): PipelineForm {
  return {
    id: null,
    name: '',
    workspace: 'worktree',
    scope: scope ?? (root ? 'project' : 'global'),
    root,
    autoPush: false,
    confirmBefore: [],
    steps: [claudeStep('Execute', '{{task}}')],
  };
}

/** The form for editing a pipeline of yours or a shared one; `root` is the project the editor opened in. */
export function pipelineForm(pipeline: Pipeline, root: string | null): PipelineForm {
  const scope = pipeline.scope;
  return {
    id: pipeline.id,
    name: pipeline.name,
    workspace: pipeline.workspace,
    scope: scope.kind === 'project' ? 'project' : scope.kind === 'shared' ? 'shared' : 'global',
    root: scope.kind === 'project' || scope.kind === 'shared' ? scope.root : root,
    autoPush: pipeline.autoPush === true,
    confirmBefore: [...pipeline.confirmBefore],
    steps: pipeline.steps.map((step) => ({ ...structuredClone(step), key: stepKey() })),
  };
}

/** Where the form saves: null while a project scope has no project. */
export function formScope(form: Pick<PipelineForm, 'scope' | 'root'>): PipelineSaveScope | null {
  if (form.scope === 'global') return { kind: 'global' };
  return form.root ? { kind: form.scope, root: form.root } : null;
}

// --- Changing the steps -------------------------------------------------------------------------------------------------

/** A name no other step has: the base, else “<base> 2”, “<base> 3”… */
export function freeStepName(steps: readonly Pick<StepForm, 'name'>[], base: string): string {
  const taken = new Set(steps.map((s) => s.name.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

/** Adds a step at the end (a Claude step that works from the step before, or a push step). */
export function addStep(form: PipelineForm, kind: 'claude' | 'push'): PipelineForm {
  if (form.steps.length >= PIPELINE_LIMITS.steps) return form;
  const step = kind === 'push' ? pushStep(freeStepName(form.steps, 'Push')) : claudeStep(freeStepName(form.steps, `Step ${form.steps.length + 1}`), form.steps.length ? '{{previous.reply}}' : '{{task}}');
  return { ...form, steps: [...form.steps, step] };
}

/** Takes a step out, and every name that pointed at it with it: a fork of it starts fresh, a verdict that sent to it ends. */
export function removeStep(form: PipelineForm, index: number): PipelineForm {
  const gone = form.steps[index];
  if (!gone || form.steps.length <= 1) return form;
  const steps = form.steps
    .filter((_, i) => i !== index)
    .map((step): StepForm => {
      if (step.kind !== 'claude') return step;
      let next: ClaudeForm = step;
      if (next.start.kind === 'fork' && next.start.step === gone.name) next = { ...next, start: { kind: 'fresh' } };
      if (next.start.kind === 'fresh' && next.start.briefOf?.includes(gone.name)) {
        const briefOf = next.start.briefOf.filter((n) => n !== gone.name);
        next = { ...next, start: briefOf.length ? { kind: 'fresh', briefOf } : { kind: 'fresh' } };
      }
      if (next.verdict?.sendTo === gone.name) {
        const { verdict: _verdict, ...rest } = next;
        next = rest;
      }
      return next;
    });
  return { ...form, steps, confirmBefore: form.confirmBefore.filter((n) => n !== gone.name) };
}

/** Moves a step one place up (-1) or down (1). */
export function moveStep(form: PipelineForm, index: number, by: -1 | 1): PipelineForm {
  const to = index + by;
  if (to < 0 || to >= form.steps.length) return form;
  const steps = [...form.steps];
  [steps[index], steps[to]] = [steps[to]!, steps[index]!];
  return { ...form, steps };
}

/** `{{step:old.reply}}` blanks in a prompt, pointed at the new name. */
const renameInPrompt = (prompt: string, from: string, to: string) => prompt.split(`{{step:${from}.reply}}`).join(`{{step:${to}.reply}}`);

/** Renames a step, and every place that names it (forks, briefs, verdicts, waits and the prompts' `{{step:…}}`). */
export function renameStep(form: PipelineForm, index: number, name: string): PipelineForm {
  const from = form.steps[index]?.name;
  if (from === undefined || from === name) return form;
  const steps = form.steps.map((step, i): StepForm => {
    if (i === index) return { ...step, name };
    if (step.kind !== 'claude') return step;
    let next: ClaudeForm = { ...step, prompt: renameInPrompt(step.prompt, from, name) };
    if (next.start.kind === 'fork' && next.start.step === from) next = { ...next, start: { kind: 'fork', step: name } };
    if (next.start.kind === 'fresh' && next.start.briefOf?.includes(from)) next = { ...next, start: { kind: 'fresh', briefOf: next.start.briefOf.map((n) => (n === from ? name : n)) } };
    if (next.verdict?.sendTo === from) next = { ...next, verdict: { ...next.verdict, sendTo: name } };
    return next;
  });
  return { ...form, steps, confirmBefore: form.confirmBefore.map((n) => (n === from ? name : n)) };
}

/** Changes one step. Use `renameStep` for its name. */
export function updateStep(form: PipelineForm, index: number, patch: Partial<ClaudeForm> | Partial<PushForm>): PipelineForm {
  return { ...form, steps: form.steps.map((step, i) => (i === index ? ({ ...step, ...patch } as StepForm) : step)) };
}

/** Whether a step waits for you before it starts. */
export const waitsBefore = (form: PipelineForm, index: number) => form.confirmBefore.includes(form.steps[index]?.name ?? '');

export function setWaitsBefore(form: PipelineForm, index: number, on: boolean): PipelineForm {
  const name = form.steps[index]?.name;
  if (name === undefined) return form;
  const rest = form.confirmBefore.filter((n) => n !== name);
  return { ...form, confirmBefore: on ? [...rest, name] : rest };
}

/** Picks a step's start: a fresh session, or a fork of the earlier step called `forkOf`. */
export function setStart(form: PipelineForm, index: number, forkOf: string | null): PipelineForm {
  const step = form.steps[index];
  if (step?.kind !== 'claude') return form;
  return updateStep(form, index, { start: forkOf ? { kind: 'fork', step: forkOf } : { kind: 'fresh' } });
}

/** Ticks or unticks a step in a fresh step's “brief of” (none ticked: the step before). */
export function toggleBrief(form: PipelineForm, index: number, name: string, on: boolean): PipelineForm {
  const step = form.steps[index];
  if (step?.kind !== 'claude' || step.start.kind !== 'fresh') return form;
  const have = step.start.briefOf ?? [];
  const briefOf = on ? [...have.filter((n) => n !== name), name] : have.filter((n) => n !== name);
  // In the pipeline's order.
  const ordered = form.steps.map((s) => s.name).filter((n) => briefOf.includes(n));
  return updateStep(form, index, { start: ordered.length ? { kind: 'fresh', briefOf: ordered } : { kind: 'fresh' } });
}

/** The earlier steps that have a session: what a fork, a brief or a verdict can point at. */
export const earlierClaudeSteps = (form: PipelineForm, index: number): ClaudeForm[] => form.steps.slice(0, index).filter((s): s is ClaudeForm => s.kind === 'claude');

/** Turns a step's verdict on (sending to the nearest earlier Claude step, two rounds) or off. */
export function setVerdict(form: PipelineForm, index: number, on: boolean): PipelineForm {
  const step = form.steps[index];
  if (step?.kind !== 'claude') return form;
  if (on) return updateStep(form, index, { verdict: { sendTo: earlierClaudeSteps(form, index).at(-1)?.name ?? '', rounds: 2 } });
  const { verdict: _verdict, ...rest } = step;
  return { ...form, steps: form.steps.map((s, i) => (i === index ? rest : s)) };
}

/** How deep each step sits in the tree it makes: a fork is one level under the step it forks. Steps stay in the order they run. */
export function stepDepths(steps: readonly StepForm[]): number[] {
  const depth = new Map<string, number>();
  return steps.map((step) => {
    const d = step.kind === 'claude' && step.start.kind === 'fork' ? (depth.get(step.start.step) ?? 0) + 1 : 0;
    if (!depth.has(step.name)) depth.set(step.name, d);
    return d;
  });
}

/** The blanks a prompt can take at this step, to insert: the task, the step before, and each earlier step's reply. */
export function blankChoices(form: PipelineForm, index: number): Array<{ text: string; label: string }> {
  const choices = [{ text: '{{task}}', label: 'Task' }];
  if (index > 0) choices.push({ text: '{{previous.reply}}', label: 'Previous reply' });
  for (const step of earlierClaudeSteps(form, index)) choices.push({ text: `{{step:${step.name}.reply}}`, label: `${step.name} reply` });
  return choices;
}

// --- What is wrong ------------------------------------------------------------------------------------------------------

export interface FormProblems {
  /** About the pipeline as a whole. */
  pipeline: string[];
  /** By step, in the form's order. */
  steps: string[][];
}

const BYPASS_TAIL = / In a shared pipeline it runs in default mode instead\.$/;

/**
 * Everything wrong with the form, each problem under the step it is about (or the pipeline). The protocol's checks
 * (`validatePipeline`, and a shared pipeline's `sharedPipelineIssues`) name a step by its “name” or by its number, which is
 * how they are placed. A shared pipeline that asks to bypass permissions is refused here rather than saved in another mode.
 */
export function formProblems(form: PipelineForm): FormProblems {
  const pipeline: string[] = [];
  const steps: string[][] = form.steps.map(() => []);
  if (!form.name.trim()) pipeline.push('Give the pipeline a name.');
  if (form.scope !== 'global' && !form.root) pipeline.push('Choose a project.');
  form.steps.forEach((step, i) => {
    if (!step.name.trim()) steps[i]!.push('Give the step a name.');
    else if (/[{}\n\r]/.test(step.name)) steps[i]!.push('A step name can’t have braces or line breaks.');
    if (step.kind === 'claude' && !step.prompt.trim()) steps[i]!.push('Write the step’s prompt.');
  });
  const body = { steps: form.steps, confirmBefore: form.confirmBefore };
  const place = (text: string) => {
    const numbers = /^Steps? (\d+)(?: and (\d+))?/.exec(text);
    if (numbers) {
      const at = Number(numbers[2] ?? numbers[1]) - 1;
      if (steps[at]) return void steps[at]!.push(text);
    }
    const quoted = /^“(.+?)”/.exec(text);
    const at = quoted ? form.steps.findIndex((s) => s.name === quoted[1]) : -1;
    (at >= 0 ? steps[at]! : pipeline).push(text);
  };
  // The name-based checks skip an empty name, which is already reported above.
  const found = form.scope === 'shared' ? sharedPipelineIssues(body) : validatePipeline(body);
  for (const problem of found) place(problem.replace(BYPASS_TAIL, ' Pick another mode: a pipeline shared with the project can’t bypass permissions.'));
  return { pipeline, steps };
}

/** The first problem, for the Save button's reason; null when it can be saved. */
export function firstProblem(form: PipelineForm): string | null {
  const { pipeline, steps } = formProblems(form);
  return pipeline[0] ?? steps.flat()[0] ?? null;
}

/** What `pipelines.save` gets, or null while it can't be saved. Empty extras are left out, as the file would have them. */
export function formToSave(form: PipelineForm): PipelineSave | null {
  const scope = formScope(form);
  if (!scope || firstProblem(form)) return null;
  const steps = form.steps.map((step) => {
    const { key: _key, ...rest } = step;
    if (rest.kind === 'push') return { ...rest, name: rest.name.trim(), pullRequest: rest.pullRequest ? { base: rest.pullRequest.base?.trim() || null, draft: rest.pullRequest.draft } : null };
    const { readOnly, actionsFirst, verdict, ...base } = rest;
    const actions = (actionsFirst ?? []).map((a) => a.trim()).filter(Boolean);
    return { ...base, name: rest.name.trim(), ...(readOnly ? { readOnly: true } : {}), ...(actions.length ? { actionsFirst: actions } : {}), ...(verdict ? { verdict } : {}) };
  });
  return {
    ...(form.id ? { id: form.id } : {}),
    name: form.name.trim(),
    workspace: form.workspace,
    steps: steps as PipelineSave['steps'],
    confirmBefore: form.confirmBefore,
    ...(form.autoPush && form.scope !== 'shared' ? { autoPush: true } : {}),
    scope,
  };
}

/** The line under a step's name in its card: what kind of step it is. */
export function stepSummary(step: StepForm): string {
  if (step.kind === 'push') return step.pullRequest ? 'Commit, push and open a pull request' : step.commit ? 'Commit and push' : 'Push';
  if (step.start.kind === 'fork') return `Forks ${step.start.step}`;
  return step.verdict ? `Checks the work, up to ${step.verdict.rounds} ${step.verdict.rounds === 1 ? 'round' : 'rounds'}` : 'Fresh session';
}
