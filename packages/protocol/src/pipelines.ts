// Pipelines (#179): the rules, without zod, React or the engine. What happens when a step ends, how a verdict is read,
// what fills a step's prompt, what a shared pipeline may do, how the sidebar nests sub-sessions and what the parent is
// told about its run. Shared: the engine decides, and the UI shows the same words. The stored shapes are in
// `pipelineSchema.ts`; the design is docs/pipelines.md.

import { fenceFor, RUN_FENCE, RUN_LABEL, withoutRunBrief } from './contextBlocks.ts';
import { stripFences } from './githubContext.ts';
import type { CatchUpNeedKind } from './catchUp.ts';
import type { HeldBy, Pipeline, PipelineBody, PipelineRun, PipelineRunStep, RunState, StepState, Verdict } from './pipelineSchema.ts';
import { PR_BODY_LIMIT } from './pullRequestConstants.ts';
import { parse as parsePrompt } from './savedPrompts.ts';
import { BRIEF_BUDGET, BRIEFS_BUDGET, linkLabel, uniqueLabel } from './sessionLinks.ts';

/** What a pipeline's numbers can be. */
export const PIPELINE_LIMITS = {
  steps: 12,
  stepName: 40,
  actions: 10,
  rounds: { min: 1, max: 5 },
} as const;

/** The lines of an action's output that go into a step's prompt. */
export const ACTION_OUTPUT_LINES = 150;
export { RUN_FENCE, withoutRunBrief };
/** A run row in the sidebar has this id prefix, then the run's id. */
export const RUN_ROW_PREFIX = 'run:';

/** The id the sidebar and `session_parents` use for a run row. */
export const runRowId = (runId: string) => `${RUN_ROW_PREFIX}${runId}`;
/** The run id of a run row's id, or null when it is a session's. */
export const runIdOfRow = (id: string) => (id.startsWith(RUN_ROW_PREFIX) ? id.slice(RUN_ROW_PREFIX.length) : null);

type Step = PipelineBody['steps'][number];
type ClaudeStepLike = Extract<Step, { kind: 'claude' }>;

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
const cutTo = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

// --- Rows --------------------------------------------------------------------------------------------------------------

/** The rows of one step, oldest round first. */
export const rowsOf = (rows: readonly PipelineRunStep[], stepIndex: number) =>
  rows.filter((r) => r.stepIndex === stepIndex).sort((a, b) => a.round - b.round);

/** The newest row of a step (its latest round), or null before it started. */
export const latestRow = (rows: readonly PipelineRunStep[], stepIndex: number): PipelineRunStep | null => rowsOf(rows, stepIndex).at(-1) ?? null;

/** The round a step starts next: one more than it has had. */
export const nextRound = (rows: readonly PipelineRunStep[], stepIndex: number) => rowsOf(rows, stepIndex).length + 1;

/** What a step says for `{{previous.reply}}` and `{{step:<name>.reply}}`: the plan when its turn had one, else its last reply. */
export const replyOf = (row: Pick<PipelineRunStep, 'plan' | 'reply'>): string => (row.plan ?? row.reply ?? '').trim();

// --- Verdicts ----------------------------------------------------------------------------------------------------------

/** What a verdict step's reply decided, and the list of what to change. `verdict` is null when no line says it. */
export interface ReadVerdict {
  verdict: Verdict | null;
  /** For `changes`: everything after the verdict line, or the whole reply when nothing follows it. */
  list: string;
}

const VERDICT_LINE = /^\s*[*_]*Verdict:?[*_]*\s*(pass|changes needed)\b(.*)$/i;

/**
 * Reads the verdict from a reply: the last line that says `Verdict: pass` or `Verdict: changes needed` (case does not
 * matter, bold and a missing colon are fine). Two different verdict lines: the last wins. No such line: null, which
 * stops the run, so a confused reviewer never lets work through.
 */
export function readVerdict(reply: string | null | undefined): ReadVerdict {
  const text = (reply ?? '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  let found: { at: number; verdict: Verdict; rest: string } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const match = VERDICT_LINE.exec(lines[i]!);
    if (!match) continue;
    found = {
      at: i,
      verdict: match[1]!.toLowerCase() === 'pass' ? 'pass' : 'changes',
      rest: match[2]!.replace(/^[\s*_:.\-–]+/, '').replace(/[*_]+\s*$/, '').trim(),
    };
  }
  if (!found) return { verdict: null, list: text.trim() };
  const after = [found.rest, ...lines.slice(found.at + 1)].join('\n').trim();
  return { verdict: found.verdict, list: after || text.trim() };
}

// --- When a step ends --------------------------------------------------------------------------------------------------

/**
 * How a step ended. `clean`: the turn finished without an error; `error`, `stopped` (you stopped it) and `closed` (its
 * session was closed or deleted) stop the run; `skipped` is you skipping the step; `accepted` is you going on past a
 * step that stopped for you (Continue), as it is.
 */
export type StepEndKind = 'clean' | 'error' | 'stopped' | 'closed' | 'skipped' | 'accepted';

export interface StepEnd {
  kind: StepEndKind;
  /** Claude Code's message for `error`. */
  error?: string | null;
  /** What the turn leaves for you (the catch-up's `need`, computed without a model). */
  need: CatchUpNeedKind;
  /** The turn's last reply. */
  reply: string | null;
}

/** What a step's end means for the step itself. */
export type StepResult =
  | { kind: 'done'; verdict?: Verdict | null; verdictText?: string | null }
  | { kind: 'changes'; list: string }
  | { kind: 'stop'; heldBy: HeldBy; rowState: StepState; note: string };

/** Needs that mean Claude waits for you. */
const WAITING: ReadonlySet<CatchUpNeedKind> = new Set(['reply', 'permission', 'question']);

/**
 * Whether a step is done: the turn ended `clean`, Claude doesn't wait for you (a reply, a permission or a question),
 * and for a step with a verdict, the verdict is read. A verdict is the answer, so a reviewer that also asks something
 * in its last paragraph is not held for it. A missing verdict stops the run.
 */
export function stepOutcome(step: Step, end: StepEnd): StepResult {
  const name = step.name;
  switch (end.kind) {
    case 'error':
      return { kind: 'stop', heldBy: 'error', rowState: 'failed', note: end.error ? `${name} stopped with an error: ${oneLine(end.error)}` : `${name} stopped with an error` };
    case 'stopped':
      return { kind: 'stop', heldBy: 'error', rowState: 'stopped', note: `${name} was stopped` };
    case 'closed':
      return { kind: 'stop', heldBy: 'closed', rowState: 'stopped', note: `The ${name} session was closed` };
    case 'skipped':
    case 'accepted':
      return { kind: 'done' };
    default:
      break;
  }
  if (step.kind === 'push') return { kind: 'done' };
  if (step.verdict) {
    if (end.need === 'permission' || end.need === 'question') return { kind: 'stop', heldBy: 'reply', rowState: 'needs-you', note: `${name} waits for you` };
    const read = readVerdict(end.reply);
    if (read.verdict === 'pass') return { kind: 'done', verdict: 'pass', verdictText: null };
    if (read.verdict === 'changes') return { kind: 'changes', list: read.list };
    return { kind: 'stop', heldBy: 'verdict', rowState: 'needs-you', note: `${name} gave no verdict. It should end with “Verdict: pass” or “Verdict: changes needed”.` };
  }
  if (WAITING.has(end.need)) return { kind: 'stop', heldBy: 'reply', rowState: 'needs-you', note: `${name} waits for you` };
  return { kind: 'done' };
}

/** The note on a step you went on past with Continue. */
export const ACCEPTED_NOTE = 'You went on as it is';

/** What the runner does after a step ended. */
export type Then =
  /** Start step `index` (round `round`). */
  | { kind: 'start'; index: number; round: number }
  /** Wait before step `index`: for you to confirm it, or for you to push. */
  | { kind: 'hold'; heldBy: 'confirm' | 'push'; index: number }
  /** Send `list` to the sub-session of step `sendToIndex`, then start the verdict step again (round `nextRound`) when that ends. */
  | { kind: 'feedback'; verdictIndex: number; sendToIndex: number; list: string; nextRound: number }
  | { kind: 'stop'; heldBy: HeldBy; note: string }
  | { kind: 'done' };

/** How the ended step's row is recorded. A field that is left out stays as it is. */
export interface RowPatch {
  state: StepState;
  verdict?: Verdict | null;
  verdictText?: string | null;
  note?: string | null;
}

export interface NextPlan {
  row: RowPatch;
  then: Then;
}

export interface NextInput {
  pipeline: Pick<PipelineBody, 'steps' | 'confirmBefore'>;
  /** Push steps run by themselves (an own pipeline with `autoPush`). */
  autoPush?: boolean;
  /** The run's `loopTo`: the verdict step to start again once the step that ended is done. */
  loopTo: number | null;
  /** Every row of the run, the one that ended included. */
  rows: readonly PipelineRunStep[];
  ended: { index: number; round: number; end: StepEnd };
}

/** The step after `from`, or where a loop goes back to, and whether it starts or waits for you first. */
function successor(input: NextInput, from: number): Then {
  const { steps, confirmBefore } = input.pipeline;
  if (input.loopTo !== null && input.loopTo !== from) return { kind: 'start', index: input.loopTo, round: nextRound(input.rows, input.loopTo) };
  const index = from + 1;
  const step = steps[index];
  if (!step) return { kind: 'done' };
  // A push step waits for you, unless the pipeline is allowed to push by itself.
  if (step.kind === 'push') return input.autoPush ? { kind: 'start', index, round: nextRound(input.rows, index) } : { kind: 'hold', heldBy: 'push', index };
  if (confirmBefore.includes(step.name)) return { kind: 'hold', heldBy: 'confirm', index };
  return { kind: 'start', index, round: nextRound(input.rows, index) };
}

/**
 * What the runner does when a step ended: how to record the step, and then start the next step, wait for you (a step
 * in `confirmBefore`, a push), send a verdict's list back and loop, stop the run, or finish it. Covers the stop rules
 * (an error, a stop, a close, a question, a missing verdict), rounds, skipping and `autoPush`.
 */
export function nextStep(input: NextInput): NextPlan {
  const { index, end } = input.ended;
  const step = input.pipeline.steps[index];
  if (!step) return { row: { state: 'done' }, then: { kind: 'done' } };
  const result = stepOutcome(step, end);
  if (result.kind === 'stop') return { row: { state: result.rowState, note: result.note }, then: { kind: 'stop', heldBy: result.heldBy, note: result.note } };
  if (result.kind === 'done') {
    const state: StepState = end.kind === 'skipped' ? 'skipped' : 'done';
    return {
      row: { state, ...(result.verdict !== undefined ? { verdict: result.verdict, verdictText: result.verdictText ?? null } : {}), ...(end.kind === 'accepted' ? { note: ACCEPTED_NOTE } : {}) },
      then: successor(input, index),
    };
  }
  // Changes needed: the list goes back, while there are rounds left.
  const verdict = step.kind === 'claude' ? step.verdict : undefined;
  if (!verdict) return { row: { state: 'done' }, then: successor(input, index) };
  const sendToIndex = input.pipeline.steps.findIndex((s) => s.name === verdict.sendTo);
  const changes = input.rows.filter((r) => r.stepIndex === index && r.verdict === 'changes' && r.round !== input.ended.round).length + 1;
  if (sendToIndex < 0 || input.pipeline.steps[sendToIndex]!.kind !== 'claude') {
    const note = `${step.name} sends its changes to “${verdict.sendTo}”, which isn’t a step`;
    return { row: { state: 'needs-you', verdict: 'changes', verdictText: result.list, note }, then: { kind: 'stop', heldBy: 'error', note } };
  }
  if (changes >= verdict.rounds) {
    const note = `${step.name} still asks for changes after ${verdict.rounds === 1 ? '1 round' : `${verdict.rounds} rounds`}`;
    return { row: { state: 'needs-you', verdict: 'changes', verdictText: result.list, note }, then: { kind: 'stop', heldBy: 'verdict', note } };
  }
  const to = input.pipeline.steps[sendToIndex]!.name;
  return {
    row: { state: 'done', verdict: 'changes', verdictText: result.list, note: `Changes needed, sent to ${to}` },
    then: { kind: 'feedback', verdictIndex: index, sendToIndex, list: result.list, nextRound: nextRound(input.rows, index) },
  };
}

/** Whether a run holds waiting for a limit rather than for you (so it is `held`, not `needs-you`). */
export const HOLDS_FOR_LIMIT: ReadonlySet<HeldBy> = new Set(['focus', 'limit', 'folder']);

/** The run's state for why it waits: `held` for a limit or another run in the folder, `needs-you` for the rest. */
export const stateFor = (heldBy: HeldBy): RunState => (HOLDS_FOR_LIMIT.has(heldBy) ? 'held' : 'needs-you');

/** Why a run waits, in a sentence, when nothing more specific was recorded. `step` is the step it is at. */
export function heldByLabel(heldBy: HeldBy, step: string): string {
  switch (heldBy) {
    case 'focus':
      return 'Waiting for a free slot at your focus limit';
    case 'limit':
      return 'Waiting for the usage limit to reset';
    case 'folder':
      return 'Waiting for another run in this folder to finish';
    case 'confirm':
      return `Waiting for you to start ${step}`;
    case 'push':
      return 'Ready to push';
    case 'reply':
      return `${step} waits for you`;
    case 'verdict':
      return `${step} needs a decision`;
    case 'error':
      return `${step} stopped with an error`;
    case 'closed':
      return `The ${step} session was closed`;
    case 'worktree':
      return 'The run’s folder is gone';
    case 'trust':
      return 'Check this shared pipeline before it runs';
  }
}

// --- Checking a pipeline -----------------------------------------------------------------------------------------------

/**
 * Everything wrong with a pipeline, in plain sentences: names that repeat, references to steps that don't exist, a fork
 * of itself or a later step, rounds outside 1 to 5. Empty when it can run.
 */
export function validatePipeline(pipeline: Pick<PipelineBody, 'steps' | 'confirmBefore'>): string[] {
  const problems: string[] = [];
  const { steps } = pipeline;
  if (steps.length === 0) problems.push('A pipeline needs at least one step.');
  if (steps.length > PIPELINE_LIMITS.steps) problems.push(`A pipeline can have up to ${PIPELINE_LIMITS.steps} steps.`);
  const indexOf = (name: string) => steps.findIndex((s) => s.name === name);
  const seen = new Map<string, number>();
  steps.forEach((step, i) => {
    const key = step.name.trim().toLowerCase();
    if (!key) problems.push(`Step ${i + 1} needs a name.`);
    else if (seen.has(key)) problems.push(`Steps ${seen.get(key)! + 1} and ${i + 1} are both called “${step.name}”. Give each step its own name.`);
    else seen.set(key, i);
  });
  steps.forEach((step, i) => {
    if (step.kind !== 'claude') return;
    const label = `“${step.name}”`;
    if (step.start.kind === 'fork') {
      const at = indexOf(step.start.step);
      if (at < 0) problems.push(`${label} forks “${step.start.step}”, which isn’t a step.`);
      else if (at === i) problems.push(`${label} can’t fork itself.`);
      else if (at > i) problems.push(`${label} forks “${step.start.step}”, which comes after it. A fork needs an earlier step.`);
      else if (steps[at]!.kind !== 'claude') problems.push(`${label} forks “${step.start.step}”, which has no session to fork.`);
    }
    if (step.start.kind === 'fresh') {
      for (const name of step.start.briefOf ?? []) {
        const at = indexOf(name);
        if (at < 0) problems.push(`${label} takes a brief of “${name}”, which isn’t a step.`);
        else if (at >= i) problems.push(`${label} takes a brief of “${name}”, which doesn’t come before it.`);
        else if (steps[at]!.kind !== 'claude') problems.push(`${label} takes a brief of “${name}”, which has no session.`);
      }
    }
    if (step.verdict) {
      const at = indexOf(step.verdict.sendTo);
      if (at < 0) problems.push(`${label} sends its changes to “${step.verdict.sendTo}”, which isn’t a step.`);
      else if (at >= i) problems.push(`${label} sends its changes to “${step.verdict.sendTo}”, which doesn’t come before it.`);
      else if (steps[at]!.kind !== 'claude') problems.push(`${label} sends its changes to “${step.verdict.sendTo}”, which has no session.`);
      const { min, max } = PIPELINE_LIMITS.rounds;
      if (!Number.isInteger(step.verdict.rounds) || step.verdict.rounds < min || step.verdict.rounds > max) problems.push(`${label} can go ${min} to ${max} rounds.`);
    }
    if (i === 0 && step.start.kind === 'fork') problems.push(`${label} is the first step, so there is nothing to fork.`);
  });
  for (const name of pipeline.confirmBefore) if (indexOf(name) < 0) problems.push(`“${name}” is set to wait for you, but isn’t a step.`);
  return problems;
}

/** The first thing wrong with a pipeline, or null. */
export const pipelineProblem = (pipeline: Pick<PipelineBody, 'steps' | 'confirmBefore'>): string | null => validatePipeline(pipeline)[0] ?? null;

/**
 * What a pipeline from a project's .switchboard.json may not do, or does differently: bypass permissions (the step
 * runs in default mode instead), `autoPush` (ignored), and everything `validatePipeline` finds. It comes from whoever
 * can commit to the repository, so these are never allowed there.
 */
export function sharedPipelineIssues(pipeline: Pick<PipelineBody, 'steps' | 'confirmBefore' | 'autoPush'>): string[] {
  const issues: string[] = [];
  for (const step of pipeline.steps) {
    if (step.kind === 'claude' && step.permissionMode === 'bypassPermissions') issues.push(`“${step.name}” asks to bypass permissions. In a shared pipeline it runs in default mode instead.`);
  }
  if (pipeline.autoPush) issues.push('A shared pipeline never pushes without you, so autoPush is ignored.');
  return [...issues, ...validatePipeline(pipeline)];
}

/** A shared pipeline as it runs here: no bypass permissions (default mode instead) and no `autoPush`. */
export function limitSharedPipeline<T extends Pick<PipelineBody, 'steps' | 'autoPush'>>(pipeline: T): T {
  const { autoPush: _ignored, ...rest } = pipeline;
  return {
    ...rest,
    steps: pipeline.steps.map((step) => (step.kind === 'claude' && step.permissionMode === 'bypassPermissions' ? { ...step, permissionMode: 'default' as const } : step)),
  } as T;
}

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

/**
 * A stable hash of a pipeline's content (sorted keys, no `undefined`), to tell whether a shared pipeline changed since
 * you trusted it. Not a security hash: it only has to change when the pipeline does.
 */
export function pipelineHash(pipeline: Pick<PipelineBody, 'name' | 'workspace' | 'steps' | 'confirmBefore'>): string {
  const text = stable({ name: pipeline.name, workspace: pipeline.workspace, steps: pipeline.steps, confirmBefore: pipeline.confirmBefore });
  // cyrb53: two 32-bit lanes mixed into 53 bits.
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

// --- Prompts -----------------------------------------------------------------------------------------------------------

/** How a project action went before a step: its exit code and the end of its output. */
export interface ActionResult {
  name: string;
  /** `ran`: it ran; `missing`: no action has this name here; `skipped`: it isn't a shell action, or wasn't approved yet. */
  status: 'ran' | 'missing' | 'skipped';
  exitCode?: number;
  /** The end of its output (`ACTION_OUTPUT_LINES` lines). */
  tail?: string;
  /** Why it was skipped. */
  note?: string;
}

export interface PromptContext {
  /** What the run is for. */
  task: string;
  /** The blanks of the pipeline's prompts, as filled in. */
  blanks?: Readonly<Record<string, string | undefined>>;
  /** The step before: `{{previous.reply}}`. */
  previous?: { name: string; reply: string } | null;
  /** The reply of each step that is done, by step name: `{{step:<name>.reply}}`. */
  replies?: Readonly<Record<string, string | undefined>>;
  /** What the step's `actionsFirst` found. */
  actions?: readonly ActionResult[];
}

const STEP_REPLY = /^\{\{\s*step\s*:\s*(.+?)\s*\.reply\s*\??\s*\}\}$/;

/** The text one action puts in a prompt: how it went, then the end of its output in a fence. */
export function actionText(action: ActionResult): string {
  if (action.status === 'missing') return `Action ${action.name}: not run, there is no action with this name here.`;
  if (action.status === 'skipped') return `Action ${action.name}: not run${action.note ? `, ${action.note}` : ''}.`;
  const head = `Action ${action.name}: exit ${action.exitCode ?? 0}`;
  const tail = (action.tail ?? '').replace(/\s+$/, '');
  if (!tail) return `${head} (no output)`;
  const fence = fenceFor(tail);
  return `${head}\n${fence}text\n${tail}\n${fence}`;
}

/**
 * A step's prompt with its blanks filled: `{{task}}`, `{{previous.reply}}` (the plan, after a plan step),
 * `{{step:<name>.reply}}`, and the pipeline's own saved-prompt blanks (`{{name}}`, `{{name:type}}`, `{{name?}}`, which
 * the person fills when the run starts). An empty or unknown one leaves nothing. What `actionsFirst` found follows the text.
 */
export function fillStepPrompt(step: Pick<ClaudeStepLike, 'prompt'>, context: PromptContext): string {
  const text = parsePrompt(step.prompt)
    .map((part) => {
      if (part.kind === 'text') return part.text;
      if (part.name === 'task') return context.task.trim();
      if (part.name === 'previous.reply') return (context.previous?.reply ?? '').trim();
      const stepReply = STEP_REPLY.exec(part.raw);
      if (stepReply) return (context.replies?.[stepReply[1]!] ?? '').trim();
      return (context.blanks?.[part.name] ?? '').trim();
    })
    .join('')
    .trim();
  const actions = (context.actions ?? []).map(actionText);
  return [text, ...(actions.length ? ['What the project actions found before you started:', ...actions] : [])].join('\n\n').trim();
}

/** The blanks a pipeline asks for when it starts: the saved-prompt blanks of its steps' prompts, apart from the ones a run fills itself. */
export function pipelineBlanks(pipeline: Pick<PipelineBody, 'steps'>): Array<{ name: string; type: string; options: string[]; optional: boolean }> {
  const seen = new Set<string>();
  const out: Array<{ name: string; type: string; options: string[]; optional: boolean }> = [];
  for (const step of pipeline.steps) {
    if (step.kind !== 'claude') continue;
    for (const part of parsePrompt(step.prompt)) {
      if (part.kind !== 'blank' || part.name === 'task' || part.name === 'previous.reply' || STEP_REPLY.test(part.raw) || seen.has(part.name)) continue;
      seen.add(part.name);
      out.push({ name: part.name, type: part.type, options: part.options, optional: part.optional });
    }
  }
  return out;
}

/**
 * The sessions a fresh step gets a brief of, as session-link stubs: the steps named in `briefOf`, else the step before
 * it, else (for the first step) the parent session when there is one. Each is that step's latest sub-session.
 */
export function briefTargets(input: { pipeline: Pick<PipelineBody, 'steps'>; index: number; rows: readonly PipelineRunStep[]; parentSessionId: string | null }): Array<{ label: string; sessionId: string }> {
  const { pipeline, index, rows } = input;
  const step = pipeline.steps[index];
  if (!step || step.kind !== 'claude' || step.start.kind !== 'fresh') return [];
  const named = step.start.briefOf;
  const sessionOf = (stepIndex: number) => [...rowsOf(rows, stepIndex)].reverse().find((r) => r.sessionId && r.state !== 'skipped')?.sessionId ?? null;
  const wanted: number[] = named ? named.map((n) => pipeline.steps.findIndex((s) => s.name === n)).filter((i) => i >= 0 && i < index) : [];
  if (!named) {
    for (let i = index - 1; i >= 0; i--) {
      if (pipeline.steps[i]!.kind === 'claude' && sessionOf(i)) {
        wanted.push(i);
        break;
      }
    }
  }
  const out: Array<{ label: string; sessionId: string }> = [];
  const used: string[] = [];
  const add = (title: string, sessionId: string | null) => {
    if (!sessionId || out.some((o) => o.sessionId === sessionId)) return;
    const label = uniqueLabel(linkLabel(title), used);
    used.push(label);
    out.push({ label, sessionId });
  };
  for (const i of wanted) add(pipeline.steps[i]!.name, sessionOf(i));
  if (!named && out.length === 0 && input.parentSessionId) add('Parent session', input.parentSessionId);
  return out;
}

/** The step a fork step forks: its latest sub-session. Null before that step ran. */
export function forkSource(pipeline: Pick<PipelineBody, 'steps'>, index: number, rows: readonly PipelineRunStep[]): PipelineRunStep | null {
  const step = pipeline.steps[index];
  if (!step || step.kind !== 'claude' || step.start.kind !== 'fork') return null;
  const at = pipeline.steps.findIndex((s) => s.name === (step.start as { step: string }).step);
  return at < 0 ? null : ([...rowsOf(rows, at)].reverse().find((r) => r.sessionId) ?? null);
}

// --- The sidebar -------------------------------------------------------------------------------------------------------

/** A session row's status, as the sidebar knows it (`RowStatus` in the app). */
export type TreeStatus = 'needs-you' | 'running' | 'error' | 'unread' | 'background' | 'idle' | null;

const URGENCY: readonly TreeStatus[] = ['needs-you', 'error', 'running', 'background', 'unread', 'idle', null];

/** The more urgent of two statuses: Needs you, then failed, working, background, unread, idle. */
export const moreUrgent = (a: TreeStatus, b: TreeStatus): TreeStatus => (URGENCY.indexOf(a) <= URGENCY.indexOf(b) ? a : b);

export interface TreeSessionInput {
  id: string;
  /** A session id, or `run:<runId>`. */
  parentId?: string;
  status: TreeStatus;
}

export interface TreeRunInput {
  run: PipelineRun;
  steps: readonly PipelineRunStep[];
}

export interface TreeChild {
  /** The sub-session's id. */
  id: string;
  /** Null for a child that no run explains (a fork put under its source later). */
  stepName: string | null;
  stepIndex: number | null;
  round: number;
  status: TreeStatus;
}

export interface TreeParent {
  /** A session id, or `run:<runId>` for a run row. */
  id: string;
  runId: string | null;
  children: TreeChild[];
  /** The most urgent of the parent's own status and its children's (and a run waiting for you). */
  status: TreeStatus;
  /** "Validate · 3 of 4", while the parent has a run; null otherwise. */
  progress: string | null;
}

/** "Validate · 3 of 4": the step the run is at and how far along it is; "Done" and "Stopped" at the ends. */
export function progressLabel(run: Pick<PipelineRun, 'state' | 'stepIndex' | 'pipeline'>, steps: readonly PipelineRunStep[]): string {
  if (run.state === 'done') return 'Done';
  if (run.state === 'stopped') return 'Stopped';
  const total = run.pipeline.steps.length;
  const step = run.pipeline.steps[Math.min(run.stepIndex, total - 1)];
  if (!step) return '';
  const round = latestRow(steps, run.stepIndex)?.round ?? 1;
  return `${step.name}${round > 1 ? ` (round ${round})` : ''} · ${Math.min(run.stepIndex + 1, total)} of ${total}`;
}

/** A run's own status, for a run row and for the parent's rollup. */
const runStatus = (run: Pick<PipelineRun, 'state'>): TreeStatus => (run.state === 'needs-you' ? 'needs-you' : run.state === 'running' ? 'running' : 'idle');

/**
 * Nests sub-sessions under their parents: children in step order (rounds in order), the parent's rolled-up status (a
 * child that needs you, or a run waiting for you, puts the parent in Needs you) and the progress line. A session with
 * a `parentId` whose parent isn't known stays out of `childIds`, so it stays a top-level row instead of disappearing.
 */
export function sidebarTree(sessions: readonly TreeSessionInput[], runs: readonly TreeRunInput[]): { parents: Map<string, TreeParent>; childIds: Set<string> } {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const runById = new Map(runs.map((r) => [r.run.id, r]));
  /** Which run and step each session is, from the runs' rows. */
  const rowOf = new Map<string, { run: PipelineRun; row: PipelineRunStep }>();
  for (const { run, steps } of runs) for (const row of steps) if (row.sessionId) rowOf.set(row.sessionId, { run, row });
  const parents = new Map<string, TreeParent>();
  const parentFor = (id: string): TreeParent | null => {
    const existing = parents.get(id);
    if (existing) return existing;
    const runId = runIdOfRow(id);
    if (runId !== null) {
      const known = runById.get(runId);
      if (!known) return null;
      const parent: TreeParent = { id, runId, children: [], status: runStatus(known.run), progress: progressLabel(known.run, known.steps) };
      parents.set(id, parent);
      return parent;
    }
    const own = byId.get(id);
    if (!own) return null;
    const parent: TreeParent = { id, runId: null, children: [], status: own.status, progress: null };
    parents.set(id, parent);
    return parent;
  };
  // A parent session of a run shows its progress even before it has a child.
  for (const { run, steps } of runs) {
    if (run.parentSessionId === null) {
      parentFor(runRowId(run.id));
      continue;
    }
    const parent = parentFor(run.parentSessionId);
    if (parent) {
      parent.runId = run.id;
      parent.progress = progressLabel(run, steps);
      parent.status = moreUrgent(parent.status, runStatus(run));
    }
  }
  const childIds = new Set<string>();
  for (const session of sessions) {
    if (!session.parentId) continue;
    const parent = parentFor(session.parentId);
    if (!parent || session.parentId === session.id) continue;
    const link = rowOf.get(session.id);
    parent.children.push({ id: session.id, stepName: link?.row.stepName ?? null, stepIndex: link?.row.stepIndex ?? null, round: link?.row.round ?? 1, status: session.status });
    parent.status = moreUrgent(parent.status, session.status);
    childIds.add(session.id);
  }
  for (const parent of parents.values()) {
    parent.children = parent.children
      .map((child, order) => ({ child, order }))
      .sort((a, b) => (a.child.stepIndex ?? 1e9) - (b.child.stepIndex ?? 1e9) || a.child.round - b.child.round || a.order - b.order)
      .map(({ child }) => child);
  }
  return { parents, childIds };
}

// --- What the parent shows and is told ---------------------------------------------------------------------------------

/** A muted row in the parent's transcript for a step that ended. Not sent to Claude. */
export interface RunRow {
  id: string;
  at: number;
  text: string;
}

/** One row per finished step, oldest first: “Plan done”, “Validate: changes needed, sent to Execute”, “Pull request #152 opened”. */
export function runRows(run: Pick<PipelineRun, 'pipeline'>, steps: readonly PipelineRunStep[]): RunRow[] {
  const rows: RunRow[] = [];
  for (const row of steps) {
    if (row.endedAt === null) continue;
    const cfg = run.pipeline.steps[row.stepIndex];
    const where = row.round > 1 ? `${row.stepName} (round ${row.round})` : row.stepName;
    let text: string | null = null;
    if (row.state === 'done') {
      if (cfg?.kind === 'push') text = row.note ?? 'Pushed';
      else if (row.verdict === 'pass') text = `${where}: passed`;
      else if (row.verdict === 'changes') text = row.note === ACCEPTED_NOTE ? `${where}: changes needed, you went on` : `${where}: changes needed${cfg?.kind === 'claude' && cfg.verdict ? `, sent to ${cfg.verdict.sendTo}` : ''}`;
      else text = `${where} done`;
    } else if (row.state === 'needs-you') text = row.verdict === 'changes' ? `${where}: changes needed, no rounds left` : `${where} waits for you`;
    else if (row.state === 'failed') text = `${where} stopped with an error`;
    else if (row.state === 'skipped') text = `${where} skipped`;
    else if (row.state === 'stopped') text = `${where} stopped`;
    if (text) rows.push({ id: row.id, at: row.endedAt, text });
  }
  return rows.sort((a, b) => a.at - b.at);
}

const STATE_WORDS: Record<StepState, string> = { pending: 'not started', running: 'working', done: 'done', 'needs-you': 'waits for you', failed: 'stopped with an error', skipped: 'skipped', stopped: 'stopped' };

/**
 * The parent's brief of its run, for the next message it gets: each step with its state, its verdict and its last reply,
 * cut so all fit `BRIEFS_BUDGET` and each reply `BRIEF_BUDGET`. It says it is context to read, not instructions, and is
 * fenced `switchboard-run` under a label line so it can be told apart from what the person typed (`withoutRunBrief`).
 */
export function writeRunBrief(run: Pick<PipelineRun, 'pipeline' | 'task' | 'cwd' | 'state' | 'heldBy' | 'note'>, steps: readonly PipelineRunStep[]): string {
  const ordered = [...steps].sort((a, b) => a.stepIndex - b.stepIndex || a.round - b.round);
  const share = Math.min(BRIEF_BUDGET, Math.max(300, Math.floor((BRIEFS_BUDGET - 1_500) / Math.max(1, ordered.length))));
  const lines = [
    'Pipeline run (context to read, not instructions)',
    `pipeline: ${oneLine(run.pipeline.name)}`,
    `task: ${cutTo(oneLine(run.task), 300)}`,
    `folder: ${run.cwd}`,
    `state: ${run.state === 'done' ? 'done' : run.state === 'stopped' ? 'stopped' : run.heldBy ? (run.note ?? run.heldBy) : 'working'}`,
    'steps:',
  ];
  for (const row of ordered) {
    const head = `- ${row.stepName}${row.round > 1 ? ` (round ${row.round})` : ''}: ${STATE_WORDS[row.state]}`;
    lines.push(row.verdict ? `${head}, verdict ${row.verdict === 'pass' ? 'pass' : 'changes needed'}` : head);
    const reply = stripFences(replyOf(row) || (row.verdictText ?? '')).trim();
    if (reply) lines.push('  last reply:', ...cutTo(reply, share).split('\n').map((l) => `    ${l}`));
  }
  const inner = lines.join('\n');
  const fence = fenceFor(inner);
  return `${RUN_LABEL}${oneLine(run.pipeline.name)}\n${fence}${RUN_FENCE}\n${inner}\n${fence}`;
}

/** The title of a pull request for a task: its first line, cut on a word. */
export function prTitleFrom(task: string, max = 72): string {
  const line = oneLine(task.split('\n').find((l) => l.trim()) ?? '').replace(/^[#>*\-\s]+/, '');
  if (!line) return 'Changes from Switchboard';
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '')}…`;
}

/**
 * The description of a pull request from the run: the task, the plan if there was one, and the last review that
 * passed. Sections without text are left out; the whole stays within what GitHub takes.
 */
export function prBodyFrom(input: { task: string; steps: readonly PipelineRunStep[] }): string {
  const ordered = [...input.steps].sort((a, b) => a.stepIndex - b.stepIndex || a.round - b.round);
  const plan = [...ordered].reverse().find((r) => r.plan)?.plan?.trim() ?? '';
  const review = [...ordered].reverse().find((r) => r.verdict === 'pass' && r.reply)?.reply?.trim() ?? '';
  const sections: string[] = [];
  if (input.task.trim()) sections.push(`## Task\n\n${input.task.trim()}`);
  if (plan) sections.push(`## Plan\n\n${plan}`);
  if (review) sections.push(`## Review\n\n${cutTo(review, 3_000)}`);
  const body = sections.join('\n\n');
  return body.length <= PR_BODY_LIMIT ? body : cutTo(body, PR_BODY_LIMIT);
}

// --- Built-in pipelines ------------------------------------------------------------------------------------------------

const claude = (step: Partial<ClaudeStepLike> & Pick<ClaudeStepLike, 'name' | 'prompt'>): ClaudeStepLike => ({
  kind: 'claude',
  start: { kind: 'fresh' },
  model: null,
  effort: null,
  permissionMode: null,
  ...step,
});

const push = { kind: 'push', name: 'Push', commit: true, pullRequest: { base: null, draft: false } } as const;

/** The pipelines that ship with Switchboard: read only, and to duplicate. Models are the picker's aliases. */
export const BUILTIN_PIPELINES: readonly Pipeline[] = [
  {
    id: 'plan-execute-validate-push',
    name: 'Plan, execute, validate, push',
    workspace: 'worktree',
    scope: { kind: 'builtin' },
    createdAt: 0,
    updatedAt: 0,
    issues: [],
    confirmBefore: [],
    steps: [
      claude({ name: 'Plan', prompt: '{{task}}\n\nPlan this. Don’t edit files.', model: 'opus', effort: 'high', permissionMode: 'plan' }),
      claude({ name: 'Execute', prompt: 'Build the plan you just made. Run the tests.', start: { kind: 'fork', step: 'Plan' }, model: 'sonnet', permissionMode: 'acceptEdits' }),
      claude({
        name: 'Validate',
        prompt: 'Check the diff against main and the results above. End with “Verdict: pass” or “Verdict: changes needed”, and the list of what to change.',
        start: { kind: 'fresh', briefOf: ['Execute'] },
        model: 'opus',
        readOnly: true,
        actionsFirst: ['Test', 'Lint'],
        verdict: { sendTo: 'Execute', rounds: 2 },
      }),
      { ...push, pullRequest: { ...push.pullRequest } },
    ],
  },
  {
    id: 'execute-and-validate',
    name: 'Execute and validate',
    workspace: 'worktree',
    scope: { kind: 'builtin' },
    createdAt: 0,
    updatedAt: 0,
    issues: [],
    confirmBefore: [],
    steps: [
      claude({ name: 'Execute', prompt: '{{task}}\n\nRun the tests when you are done.', model: 'sonnet', permissionMode: 'acceptEdits' }),
      claude({
        name: 'Validate',
        prompt: 'Check the diff against main and the results above. End with “Verdict: pass” or “Verdict: changes needed”, and the list of what to change.',
        start: { kind: 'fresh', briefOf: ['Execute'] },
        model: 'opus',
        readOnly: true,
        actionsFirst: ['Test', 'Lint'],
        verdict: { sendTo: 'Execute', rounds: 2 },
      }),
      { ...push, pullRequest: { ...push.pullRequest } },
    ],
  },
];
