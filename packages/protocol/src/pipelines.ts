// Pipelines (#179): the rules, without zod, React or the engine. What a run does after a step, how a verdict is read,
// the prompt a step gets (with `@parent` and `@<step>` as session links), the sidebar's tree and what an editor
// refuses. Shared: the engine decides, and the UI shows the same words. The stored shapes are in `pipelineSchema.ts`.

import { fencedBlocks, fenceFor, RUN_FENCE } from './contextBlocks.ts';
import type { Effort, PermissionMode } from './host.ts';
import type { Pipeline, PipelineClaudeStep, PipelineRun, PipelineRunState, PipelineScope, PipelineStep, StepActionResult, StepVerdict } from './pipelineSchema.ts';
import type { RunView } from './pipelineView.ts';
import type { SessionOutcome } from './later.ts';
import { writeStub } from './sessionLinks.ts';

/** What pipelines can hold. */
export const PIPELINE_LIMITS = {
  /** A step's name. */
  name: 40,
  pipelineName: 100,
  steps: 10,
  /** A step's prompt, and a run's task. */
  prompt: 20_000,
  rounds: { min: 1, max: 5 },
} as const;

/** Lines of an action's output a step's prompt gets. */
export const ACTION_TAIL_LINES = 40;

/** The fence of a project action's result in a step's prompt; its label line says which action. */
export const ACTION_FENCE = 'switchboard-action';
const ACTION_LABEL = 'Action: ';
/** The fence of a run's brief in the parent's messages (`contextBlocks.ts`); its label line names the pipeline. */
export { RUN_FENCE };
const RUN_LABEL = 'Pipeline run: ';

/** The word in a step's prompt that links the parent. */
export const PARENT_MENTION = 'parent';

// --- Built-ins --------------------------------------------------------------------------------------------------------

const VERDICT_ASK = 'End with Verdict: pass or Verdict: changes needed, and a list of what to change.';

const plan: PipelineClaudeStep = {
  kind: 'claude',
  name: 'Plan',
  start: 'fresh',
  model: 'opus',
  effort: 'high',
  permissionMode: 'plan',
  readOnly: false,
  prompt: 'Plan the task in @parent. Read what you need, then propose a plan. Don’t edit files.',
  actionsFirst: [],
  verdict: null,
  confirmBefore: false,
  approvePlan: false,
};

const validate: PipelineClaudeStep = {
  kind: 'claude',
  name: 'Validate',
  start: 'fresh',
  model: 'opus',
  effort: 'high',
  permissionMode: null,
  readOnly: true,
  prompt: `Check the work in @Execute against the task in @parent. Read the diff and the results above. ${VERDICT_ASK}`,
  actionsFirst: ['Test', 'Lint'],
  verdict: { sendTo: 'Execute', rounds: 2 },
  confirmBefore: false,
  approvePlan: false,
};

/** The pipelines every project has. Read-only: Duplicate one to change it. */
export const BUILT_IN_PIPELINES: ReadonlyArray<{ id: string; name: string; scope: PipelineScope; steps: PipelineStep[]; autoPush: boolean }> = [
  {
    id: 'builtin-plan-execute-validate-push',
    name: 'Plan, execute, validate, push',
    scope: { kind: 'all' },
    autoPush: false,
    steps: [
      plan,
      { ...plan, name: 'Execute', start: { fork: 'Plan' }, model: 'sonnet', effort: null, permissionMode: 'acceptEdits', prompt: 'Build the plan you just made for @parent. Run the tests when you’re done.' },
      validate,
      { kind: 'push', name: 'Push', draft: false },
    ],
  },
  {
    id: 'builtin-execute-validate',
    name: 'Execute and validate',
    scope: { kind: 'all' },
    autoPush: false,
    steps: [{ ...plan, name: 'Execute', model: 'sonnet', effort: null, permissionMode: 'acceptEdits', prompt: 'Do the task in @parent. Run the tests when you’re done.' }, validate],
  },
];

export const isBuiltInPipeline = (id: string) => BUILT_IN_PIPELINES.some((p) => p.id === id);

// --- New session's choices ------------------------------------------------------------------------------------------

/** The model, effort and mode New session's message box has: a run's steps that don't set their own take these. */
export interface RunChoices {
  model: string | null;
  effort: Effort | null;
  permissionMode: PermissionMode | null;
}

/** Which of the box's choices a step leaves to it: what it doesn't set. A read-only step sets its mode. */
export function choicesLeftOpen(step: PipelineClaudeStep): Array<keyof RunChoices> {
  const open: Array<keyof RunChoices> = [];
  if (step.model === null) open.push('model');
  if (step.effort === null) open.push('effort');
  if (step.permissionMode === null && !step.readOnly) open.push('permissionMode');
  return open;
}

/** The steps that take the box's choices: the Claude steps that leave at least one to it, by name. */
export function stepsTakingChoices(pipeline: Pick<Pipeline, 'steps'>): string[] {
  return pipeline.steps.filter((s): s is PipelineClaudeStep => s.kind === 'claude' && choicesLeftOpen(s).length > 0).map((s) => s.name);
}

/** A run's copy of its pipeline, with the box's choices in what each step leaves open. */
export function withRunChoices<P extends Pick<Pipeline, 'steps'>>(pipeline: P, choices: RunChoices | null): P {
  if (!choices) return pipeline;
  const steps = pipeline.steps.map((step): PipelineStep => {
    if (step.kind !== 'claude') return step;
    const open = choicesLeftOpen(step);
    return {
      ...step,
      model: open.includes('model') ? choices.model : step.model,
      effort: open.includes('effort') ? choices.effort : step.effort,
      permissionMode: open.includes('permissionMode') ? choices.permissionMode : step.permissionMode,
    };
  });
  return { ...pipeline, steps };
}

// --- What an editor refuses -------------------------------------------------------------------------------------------

export interface PipelineIssue {
  /** The step it is about, by index; null for the pipeline as a whole. */
  step: number | null;
  message: string;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Where a step's prompt mentions a step or the parent: each `@` at the start or after a space, and what follows it. */
export function mentionsIn(prompt: string, names: readonly string[]): Array<{ at: number; name: string | null; word: string }> {
  // Longest first, so "Validate all" wins over "Validate".
  const sorted = [PARENT_MENTION, ...names].sort((a, b) => b.length - a.length);
  const out: Array<{ at: number; name: string | null; word: string }> = [];
  for (const match of prompt.matchAll(/(^|[\s(“"'])@(?=\S)/g)) {
    const at = match.index + match[1]!.length;
    const rest = prompt.slice(at + 1);
    const name = sorted.find((n) => rest.startsWith(n) && !/[\p{L}\p{N}_-]/u.test(rest.charAt(n.length))) ?? null;
    out.push({ at, name, word: name ?? /^[\p{L}\p{N}_-]+/u.exec(rest)?.[0] ?? '' });
  }
  return out;
}

/** What is wrong with a pipeline, step by step: Save is off while there is anything. */
export function pipelineIssues(pipeline: { steps: readonly PipelineStep[] }): PipelineIssue[] {
  const issues: PipelineIssue[] = [];
  const { steps } = pipeline;
  const names = steps.map((s) => s.name.trim());
  const indexOf = (name: string) => names.indexOf(name.trim());
  steps.forEach((step, i) => {
    const name = names[i]!;
    if (!name) issues.push({ step: i, message: `Step ${i + 1} needs a name.` });
    else if (name.toLowerCase() === PARENT_MENTION) issues.push({ step: i, message: '“parent” is taken: @parent links the session you run it from.' });
    else if (names.indexOf(name) !== i) issues.push({ step: i, message: `Two steps are called ${name}.` });
    if (step.kind === 'push') {
      if (i !== steps.length - 1) issues.push({ step: i, message: `${name || 'Push'} has to be the last step.` });
      return;
    }
    if (!step.prompt.trim()) issues.push({ step: i, message: `Write a prompt for ${name || `step ${i + 1}`}.` });
    if (typeof step.start === 'object') {
      const from = indexOf(step.start.fork);
      if (from < 0) issues.push({ step: i, message: `${name} forks ${step.start.fork}, and there is no step called that.` });
      else if (from >= i) issues.push({ step: i, message: `${name} forks ${step.start.fork}, which doesn’t come before it.` });
      else if (steps[from]!.kind === 'push') issues.push({ step: i, message: `${name} can’t fork ${step.start.fork}: it isn’t a session.` });
    }
    if (step.verdict) {
      const to = indexOf(step.verdict.sendTo);
      if (to < 0) issues.push({ step: i, message: `${name} sends changes to ${step.verdict.sendTo}, and there is no step called that.` });
      else if (to >= i) issues.push({ step: i, message: `${name} sends changes to ${step.verdict.sendTo}, which doesn’t come before it.` });
      else if (steps[to]!.kind === 'push') issues.push({ step: i, message: `${name} can’t send changes to ${step.verdict.sendTo}: it isn’t a session.` });
    }
    for (const mention of mentionsIn(step.prompt, names.filter(Boolean))) {
      if (mention.name === PARENT_MENTION) continue;
      if (mention.name === null) {
        if (mention.word) issues.push({ step: i, message: `@${mention.word} in ${name}’s prompt names no step. Use @parent or an earlier step.` });
        continue;
      }
      const at = indexOf(mention.name);
      if (at >= i) issues.push({ step: i, message: `@${mention.name} in ${name}’s prompt isn’t a step before it.` });
      else if (steps[at]!.kind === 'push') issues.push({ step: i, message: `@${mention.name} in ${name}’s prompt isn’t a session.` });
    }
  });
  if (steps.filter((s) => s.kind === 'push').length > 1) issues.push({ step: null, message: 'A pipeline has one Push step at most.' });
  return issues;
}

// --- Verdicts ---------------------------------------------------------------------------------------------------------

const VERDICT_LINE = /^[\s>*_`#-]*verdict[\s*_`]*:[\s*_`]*(pass(?:ed)?|changes[\s-]+needed)\b/i;
const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+(.*\S)\s*$/;

/**
 * The verdict a reply ends with: the last line that says `Verdict: pass` or `Verdict: changes needed` (any case, in
 * bold or code too), with the list after it. Null when no line says either.
 */
export function readVerdict(text: string | null | undefined): StepVerdict | null {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = VERDICT_LINE.exec(lines[i]!);
    if (!match) continue;
    const kind = /^pass/i.test(match[1]!) ? 'pass' : 'changes';
    const items: string[] = [];
    for (const line of lines.slice(i + 1)) {
      const item = LIST_ITEM.exec(line);
      if (item) items.push(item[1]!.replace(/\s+/g, ' ').slice(0, 500));
      else if (line.trim() && items.length) {
        // A wrapped line belongs to the item above it.
        const last = items.length - 1;
        items[last] = `${items[last]} ${line.trim()}`.slice(0, 500);
      }
    }
    return { kind, items: items.slice(0, 50) };
  }
  return null;
}

// --- What starts next -------------------------------------------------------------------------------------------------

/** How a step's latest turn ended, as the runner saw it. */
export interface StepResult {
  outcome: SessionOutcome;
  /** The catch-up says Claude waits for you (a question, a permission, or it asks back). */
  waitsForYou: boolean;
  /** The verdict in its last reply; null when it has none. Only read for a step with a verdict. */
  verdict: StepVerdict | null;
}

/** What a run does after a turn. */
export type NextStep =
  /** Start a step: a new sub-session (round 1), or a new round of a step with a verdict. */
  | { kind: 'start'; index: number; round: number }
  /** The verdict said changes: send them to step `to`, then run `from` again as `round`. */
  | { kind: 'sendBack'; to: number; from: number; round: number }
  /** Hold before step `index` for you: `confirm` (a step with Wait for me) or `push`. */
  | { kind: 'confirm'; index: number; wait: 'confirm' | 'push'; reason: string }
  /** Run Push now (`autoPush` on your own pipeline). */
  | { kind: 'push'; index: number }
  /** Stop for you, with the reason. */
  | { kind: 'stop'; reason: string }
  | { kind: 'done' };

/** What waits before step `index`, or starts it. */
export function enterStep(steps: readonly PipelineStep[], index: number, autoPush: boolean): NextStep {
  if (index >= steps.length) return { kind: 'done' };
  const step = steps[index]!;
  if (step.kind === 'push') return autoPush ? { kind: 'push', index } : { kind: 'confirm', index, wait: 'push', reason: `${step.name} waits for you.` };
  if (step.confirmBefore) return { kind: 'confirm', index, wait: 'confirm', reason: `${step.name} waits for you to start it.` };
  return { kind: 'start', index, round: 1 };
}

/**
 * What a run does after the latest turn of the session it waited on: the current step's sub-session, or (`sentBackTo`)
 * the step a verdict's changes went to. A step is done when its turn ended `clean`, the catch-up doesn't say Claude
 * waits for you, and its verdict, if it has one, is pass.
 */
export function nextStep(run: Pick<PipelineRun, 'step' | 'round' | 'sentBackTo'> & { autoPush: boolean }, steps: readonly PipelineStep[], last: StepResult): NextStep {
  const waitedOn = steps[run.sentBackTo ?? run.step];
  const name = waitedOn?.name ?? 'The step';
  if (last.outcome === 'error') return { kind: 'stop', reason: `${name} ended with an error.` };
  if (last.outcome === 'stopped') return { kind: 'stop', reason: `${name} was stopped.` };
  if (last.outcome === 'quit') return { kind: 'stop', reason: 'Paused: Switchboard was closed. The run goes on at the next start.' };
  const step = steps[run.step];
  if (!step || step.kind === 'push') return enterStep(steps, run.step + 1, run.autoPush);
  if (run.sentBackTo !== null) {
    if (last.waitsForYou) return { kind: 'stop', reason: `${name} waits for you.` };
    // `round` already counts the round the changes were sent back for.
    return { kind: 'start', index: run.step, round: run.round };
  }
  if (step.verdict) {
    if (!last.verdict) return { kind: 'stop', reason: `${step.name} has no verdict.` };
    if (last.verdict.kind === 'changes') {
      if (run.round >= step.verdict.rounds) return { kind: 'stop', reason: `Still changes needed after ${run.round} ${run.round === 1 ? 'round' : 'rounds'}.` };
      const to = steps.findIndex((s) => s.name === step.verdict!.sendTo);
      if (to < 0) return { kind: 'stop', reason: `${step.name} sends changes to ${step.verdict.sendTo}, and there is no step called that.` };
      return { kind: 'sendBack', to, from: run.step, round: run.round + 1 };
    }
  } else if (last.waitsForYou) return { kind: 'stop', reason: `${step.name} waits for you.` };
  return enterStep(steps, run.step + 1, run.autoPush);
}

/**
 * The step a run's verdict sends changes to, when the run stopped because that verdict still asked for changes after
 * its rounds: Another round sends them there once more, and a turn you take there starts the next round. Null otherwise.
 */
export function outOfRounds(state: { run: Pick<PipelineRun, 'status' | 'waitingFor' | 'sentBackTo' | 'step' | 'round'> & { pipeline: Pick<Pipeline, 'steps'> }; steps: ReadonlyArray<{ index: number; round: number; verdict: StepVerdict | null }> }): { index: number; name: string } | null {
  const { run } = state;
  if (run.status !== 'waiting' || run.waitingFor !== 'you' || run.sentBackTo !== null) return null;
  const step = run.pipeline.steps[run.step];
  if (step?.kind !== 'claude' || !step.verdict || run.round < step.verdict.rounds) return null;
  const row = state.steps.find((s) => s.index === run.step && s.round === run.round);
  if (row?.verdict?.kind !== 'changes') return null;
  const index = run.pipeline.steps.findIndex((s) => s.name === step.verdict!.sendTo);
  return index < 0 || index >= run.step ? null : { index, name: run.pipeline.steps[index]!.name };
}

/** "round 2 of 3", or "round 4" for a round you added after the pipeline's own. */
export const roundOf = (round: number, rounds: number) => (round > rounds ? `round ${round}` : `round ${round} of ${rounds}`);

// --- The prompt a step gets -------------------------------------------------------------------------------------------

/** What a step's prompt is filled from. */
export interface StepPromptContext {
  /** What you asked: New session's text, or the parent's first prompt. Fills `{{task}}`. */
  task: string | null;
  /** `@parent`: the session the run started from, or a run row's task. */
  parent: { kind: 'session'; sessionId: string; label: string } | { kind: 'task'; label: string; text: string };
  /** Each earlier step's latest sub-session, by name. */
  steps: Readonly<Record<string, string | undefined>>;
  /** Other `{{name}}` blanks (a trigger's event fields). */
  fields?: Readonly<Record<string, string>>;
  /** The project actions that ran first. */
  actions?: readonly StepActionResult[];
}

/** A step's prompt as Claude Code gets it, and the sessions it links. */
export interface FilledStepPrompt {
  text: string;
  links: Array<{ label: string; sessionId: string }>;
}

/** An action's result as it goes in a prompt: its label line and a fenced block with its exit code and output. */
export function writeActionResult(result: StepActionResult): string {
  const head = result.exitCode === null ? 'exit: did not run' : `exit: ${result.exitCode}`;
  const inner = `${head}\n${result.tail.replace(/\n+$/, '')}`;
  const fence = fenceFor(inner);
  return `${ACTION_LABEL}${result.name.replace(/\s+/g, ' ')}\n${fence}${ACTION_FENCE}\n${inner}\n${fence}`;
}

/** The action results in a prompt, and the text without them, for the prompt card's rows. */
export function parseActionResults(text: string): { text: string; actions: Array<{ name: string; exitCode: number | null; tail: string }> } {
  const found = fencedBlocks(text, ACTION_LABEL).filter((b) => b.info === ACTION_FENCE);
  if (!found.length) return { text, actions: [] };
  let rest = '';
  let from = 0;
  const actions = found.map((block) => {
    rest += text.slice(from, block.start);
    from = block.end;
    const [head = '', ...tail] = block.inner.split('\n');
    const code = /^exit: (-?\d+)$/.exec(head);
    return { name: block.label ?? 'Action', exitCode: code ? Number(code[1]) : null, tail: tail.join('\n') };
  });
  rest += text.slice(from);
  return { text: rest.replace(/^Project actions that ran first[^\n]*\n?/m, '').replace(/\n{3,}/g, '\n\n').trim(), actions };
}

/** The most of the task a step's prompt carries with `@parent`. */
const TASK_BLOCK_MAX = 4_000;

/**
 * A step's prompt with `{{task}}` and the other blanks filled, `@parent` and `@<step>` turned into session links (the
 * same stubs the message box writes, which the engine expands into briefs), and the actions' results. The labels
 * stay in the text: `@parent` reads as the parent's title. A run row has no session, so `@parent` brings its task
 * in a block instead.
 */
export function fillStepPrompt(step: Pick<PipelineClaudeStep, 'prompt'>, ctx: StepPromptContext): FilledStepPrompt {
  const fields: Record<string, string> = { ...ctx.fields, task: ctx.task ?? (ctx.parent.kind === 'task' ? ctx.parent.text : '') };
  let text = step.prompt.replace(/(\\?)\{\{\s*([\w.-]+)\s*\}\}/g, (whole, escaped: string, name: string) => (escaped ? whole.slice(1) : (fields[name] ?? whole)));
  const names = Object.keys(ctx.steps);
  const links: FilledStepPrompt['links'] = [];
  let withTask = false;
  const mentions = mentionsIn(text, names).filter((m) => m.name !== null);
  // From the end, so earlier positions stay right.
  for (const mention of [...mentions].reverse()) {
    const isParent = mention.name === PARENT_MENTION;
    const label = isParent ? ctx.parent.label : mention.name!;
    if (isParent) {
      if (ctx.parent.kind === 'session') links.unshift({ label, sessionId: ctx.parent.sessionId });
      else withTask = true;
    } else {
      const sessionId = ctx.steps[mention.name!];
      if (sessionId) links.unshift({ label, sessionId });
    }
    text = `${text.slice(0, mention.at)}@${label}${text.slice(mention.at + 1 + mention.name!.length)}`;
  }
  const unique = links.filter((link, i) => links.findIndex((l) => l.sessionId === link.sessionId) === i);
  const parts = [text.trim()];
  // The task goes in whole with @parent: a session's brief may cut what was asked to fit its budget. Not when the
  // prompt already has it through {{task}}.
  const taskText = (ctx.parent.kind === 'task' ? ctx.parent.text : ctx.task ?? '').trim();
  const hasTaskBlank = /(^|[^\\])\{\{\s*task\s*\}\}/.test(step.prompt);
  const parent = ctx.parent;
  const parentLinked = parent.kind === 'session' && unique.some((l) => l.sessionId === parent.sessionId);
  if ((withTask || parentLinked) && taskText && !hasTaskBlank) {
    const task = taskText.length > TASK_BLOCK_MAX ? `${taskText.slice(0, TASK_BLOCK_MAX).trimEnd()}…` : taskText;
    const fence = fenceFor(task);
    parts.push(`The task, from @${ctx.parent.label}:\n${fence}text\n${task}\n${fence}`);
  }
  if (ctx.actions?.length) parts.push(['Project actions that ran first, with their exit codes and the end of their output:', ...ctx.actions.map(writeActionResult)].join('\n\n'));
  for (const link of unique) parts.push(writeStub(link.label, link.sessionId));
  return { text: parts.join('\n\n'), links: unique };
}

/**
 * The message a verdict's changes go back with, from the round that found them: it links the step that found them,
 * so its brief comes along.
 */
export function changesMessage(from: { name: string; sessionId: string }, verdict: StepVerdict, round: number, rounds: number): string {
  const list = verdict.items.length ? verdict.items.map((item, i) => `${i + 1}. ${item}`).join('\n') : `See the last reply of @${from.name}.`;
  return `@${from.name} found changes needed (${roundOf(round, rounds)}):\n\n${list}\n\nMake these changes, then run the tests. ${from.name} checks again when you're done.\n\n${writeStub(from.name, from.sessionId)}`;
}

// --- The run's brief, for the parent ----------------------------------------------------------------------------------

/** The stub a message to the parent links a run with; the engine writes the brief in its place. */
export function writeRunStub(label: string, runId: string): string {
  const inner = `run: ${runId}`;
  return `${RUN_LABEL}${label.replace(/\s+/g, ' ')}\n\`\`\`${RUN_FENCE}\n${inner}\n\`\`\``;
}

export interface RunBriefBlock {
  label: string;
  runId: string;
  /** Only `run:`, as the message box writes it. */
  stub: boolean;
  /** The brief's lines after `run:`. */
  body: string;
}

/** The run briefs in a message, and the text without them. */
export function parseRunBriefs(text: string): { text: string; runs: RunBriefBlock[] } {
  const found = fencedBlocks(text, RUN_LABEL).filter((b) => b.info === RUN_FENCE);
  if (!found.length) return { text, runs: [] };
  let rest = '';
  let from = 0;
  const runs: RunBriefBlock[] = [];
  for (const block of found) {
    const [first = '', ...lines] = block.inner.split('\n');
    const id = /^run: (.+)$/.exec(first)?.[1]?.trim();
    if (!id) continue;
    rest += text.slice(from, block.start);
    from = block.end;
    runs.push({ label: block.label ?? 'Pipeline run', runId: id, stub: lines.every((l) => !l.trim()), body: lines.join('\n').trim() });
  }
  rest += text.slice(from);
  return { text: rest.replace(/\n{3,}/g, '\n\n').trim(), runs };
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** A step's state in a word, for briefs, labels and the tree. */
export function stepStateWord(status: PipelineRunState['steps'][number]['status']): string {
  return { working: 'working', waiting: 'needs you', done: 'done', failed: 'failed', skipped: 'skipped', stopped: 'stopped' }[status];
}

/**
 * A run's brief, for the parent's messages: the pipeline, the task, each step with its state, outcome and verdict, and
 * the pull request. Cut to `budget`; the task is never dropped.
 */
export function writeRunBrief(state: PipelineRunState, budget = 4_000): string {
  const { run } = state;
  const head = [`run: ${run.id}`, `pipeline: ${oneLine(run.pipeline.name)}`, `state: ${run.status === 'waiting' && run.reason ? `waiting, ${oneLine(run.reason)}` : run.status}`];
  if (run.task) head.push(`task: ${oneLine(cut(run.task, 600))}`);
  head.push(`folder: ${run.cwd}`);
  if (run.pr) head.push(`pull request: #${run.pr.number} ${run.pr.url}`);
  const lines = state.steps.map((s) => {
    const parts = [`${s.step}${s.round > 1 ? ` round ${s.round}` : ''}: ${stepStateWord(s.status)}`];
    if (s.verdict) parts.push(`verdict ${s.verdict.kind === 'pass' ? 'pass' : 'changes needed'}${s.verdict.items.length ? ` (${s.verdict.items.map(oneLine).join('; ')})` : ''}`);
    if (s.reason) parts.push(oneLine(s.reason));
    if (s.sessionId) parts.push(`session ${s.sessionId}`);
    return `- ${parts.join(', ')}`;
  });
  const write = (steps: string[]) => {
    const inner = [...head, ...(steps.length ? ['steps:', ...steps] : [])].join('\n');
    const fence = fenceFor(inner);
    return `${RUN_LABEL}${oneLine(run.pipeline.name)}\n${fence}${RUN_FENCE}\n${inner}\n${fence}`;
  };
  let steps = lines;
  let text = write(steps);
  // Cut each step's line, then keep only the last steps, until it fits.
  if (text.length > budget) {
    steps = lines.map((l) => cut(l, 200));
    text = write(steps);
  }
  while (text.length > budget && steps.length > 1) {
    steps = steps.slice(1);
    text = write(steps);
  }
  return text;
}

// --- Progress and the sidebar's tree ----------------------------------------------------------------------------------

/** "Validate · 3 of 4": where a run is, for the parent's row. */
export function runProgress(run: Pick<PipelineRun, 'step' | 'round' | 'status'> & { pipeline: Pick<Pipeline, 'steps'> }): string {
  const steps = run.pipeline.steps;
  if (run.status === 'done') return `Done · ${steps.length} of ${steps.length}`;
  const step = steps[Math.min(run.step, steps.length - 1)];
  return `${step?.name ?? 'Step'}${run.round > 1 ? ` · round ${run.round}` : ''} · ${Math.min(run.step + 1, steps.length)} of ${steps.length}`;
}

/** A sub-session's title: "Validate", or "Validate · round 2". */
export const stepTitle = (name: string, round: number) => (round > 1 ? `${name} · round ${round}` : name);

/** A row's state, in the order of urgency the parent takes. */
export type TreeStatus = 'needsYou' | 'working' | 'failed' | 'unread' | 'idle';
const URGENCY: Record<TreeStatus, number> = { needsYou: 4, working: 3, failed: 2, unread: 1, idle: 0 };

/** The most urgent of some states. */
export const mostUrgent = (states: Iterable<TreeStatus>): TreeStatus => [...states].reduce<TreeStatus>((a, b) => (URGENCY[b] > URGENCY[a] ? b : a), 'idle');

/** A row as the tree needs it. */
export interface TreeRow {
  id: string;
  parentId: string | null;
  status: TreeStatus;
  createdAt?: number | null;
}

export interface SidebarTree<T extends TreeRow> {
  /** Rows without a parent in the list (a child whose parent isn't listed shows on its own). */
  roots: T[];
  /** Each parent's children, in step order, rounds included. */
  children: Map<string, T[]>;
  /** A parent's state: the most urgent of its own and its children's. */
  status: Map<string, TreeStatus>;
}

/**
 * The sidebar's tree: parents with their sub-sessions in step order (rounds after each other), and each parent's
 * state as the most urgent of its own and its children's, so a child that needs you makes the parent Needs you.
 * `runs` order the children and stand in for a run row (a parent that is a run, not a session); `runStatus` is a
 * run's own state (it waits for you at Push with no child waiting).
 */
export function sidebarTree<T extends TreeRow, R extends Pick<RunView, 'run' | 'steps'> = PipelineRunState>(rows: readonly T[], runs: readonly R[] = [], runStatus: (state: R) => TreeStatus | null = () => null): SidebarTree<T> {
  const ids = new Set(rows.map((r) => r.id));
  const runIds = new Set(runs.map((r) => r.run.id));
  const order = new Map<string, number>();
  for (const { steps } of runs) for (const s of steps) if (s.sessionId) order.set(s.sessionId, s.index * 100 + s.round);
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const row of rows) {
    if (row.parentId && row.parentId !== row.id && (ids.has(row.parentId) || runIds.has(row.parentId))) {
      const list = children.get(row.parentId) ?? [];
      list.push(row);
      children.set(row.parentId, list);
    } else roots.push(row);
  }
  for (const list of children.values()) {
    list.sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
  }
  const status = new Map<string, TreeStatus>();
  const own = new Map(rows.map((r) => [r.id, r.status]));
  const runOf = new Map<string, R>();
  for (const state of runs) runOf.set(state.run.parentSessionId ?? state.run.id, state);
  for (const [parent, list] of children) {
    const state = runOf.get(parent);
    const extra = state ? runStatus(state) : null;
    status.set(parent, mostUrgent([own.get(parent) ?? 'idle', ...list.map((c) => c.status), ...(extra ? [extra] : [])]));
  }
  for (const [parent, state] of runOf) {
    if (status.has(parent)) continue;
    const extra = runStatus(state);
    if (extra) status.set(parent, mostUrgent([own.get(parent) ?? 'idle', extra]));
  }
  return { roots, children, status };
}
