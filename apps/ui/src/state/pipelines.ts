import { mentionsIn, outOfRounds, PARENT_MENTION, roundOf, choicesLeftOpen, type Pipeline, type PipelineClaudeStep, type PipelineRunState, type PipelineRunStep, type PipelineStep, type TreeStatus } from '@switchboard/protocol/client';
import { MODE_LABEL } from '../lib/modes.ts';

// Pipelines (#179) in the window: the words the step tree, the sidebar and the editor show, without React or the
// stores, so they can be tested. The rules themselves are the protocol's (`pipelines.ts`).

/** "Opus" for `opus` or `claude-opus-5-5`, "Default model" for none: a step's model in a few letters. */
export function modelWord(model: string | null | undefined): string {
  if (!model) return 'Default model';
  const family = model.split(/[-_ ]/).find((part) => part !== 'claude' && /^[a-z]+$/i.test(part));
  return family ? family[0]!.toUpperCase() + family.slice(1) : model;
}

/** A step's mode in a few words, lower case after the first ("plan mode", "Accept edits"): null for the default. */
export function modeWord(step: Pick<PipelineClaudeStep, 'permissionMode' | 'readOnly'>): string | null {
  if (step.readOnly) return 'read only';
  if (!step.permissionMode || step.permissionMode === 'default') return null;
  return step.permissionMode === 'plan' ? 'plan mode' : MODE_LABEL[step.permissionMode];
}

/** The @ names a step's prompt uses, in order, once each ("@parent", "@Execute"). */
export function stepMentions(step: PipelineClaudeStep, names: readonly string[]): string[] {
  const out: string[] = [];
  for (const m of mentionsIn(step.prompt, names)) if (m.name && !out.includes(m.name)) out.push(m.name);
  return out.map((name) => `@${name}`);
}

/**
 * A step folded to one line, as its card in the editor shows it: "Fresh · Opus · plan mode · @parent", or "commit,
 * push, pull request · waits for you" for Push.
 */
export function stepSummary(step: PipelineStep, pipeline: Pick<Pipeline, 'steps' | 'autoPush'>): string {
  if (step.kind === 'push') return ['commit, push, pull request', step.draft ? 'draft' : null, pipeline.autoPush ? 'by itself' : 'waits for you'].filter(Boolean).join(' · ');
  const names = pipeline.steps.map((s) => s.name);
  const parts = [typeof step.start === 'object' ? `Fork of ${step.start.fork}` : 'Fresh', modelWord(step.model), modeWord(step), ...stepMentions(step, names)];
  if (step.actionsFirst.length) parts.push(`runs ${step.actionsFirst.join(', ')} first`);
  if (step.verdict) parts.push(`↺ ${step.verdict.sendTo} ×${step.verdict.rounds}`);
  if (step.confirmBefore) parts.push('waits for you');
  return parts.filter(Boolean).join(' · ');
}

/** "The tree it makes": the parent and each step with its model and how it starts, as mono lines. */
export function treeLines(pipeline: Pick<Pipeline, 'steps' | 'autoPush'>): Array<{ step: string | null; name: string; detail: string }> {
  const width = Math.max(8, ...pipeline.steps.map((s) => s.name.length + 2));
  const lines: Array<{ step: string | null; name: string; detail: string }> = [{ step: null, name: '<your task>', detail: '' }];
  pipeline.steps.forEach((step, i) => {
    const last = i === pipeline.steps.length - 1;
    const branch = last ? '└─ ' : '├─ ';
    if (step.kind === 'push') {
      lines.push({ step: step.name, name: `${branch}${step.name.padEnd(width)}`, detail: pipeline.autoPush ? 'by itself' : 'waits for you' });
      return;
    }
    const how = [modelWord(step.model), typeof step.start === 'object' ? 'fork' : (modeWord(step) ?? 'fresh')].join(' · ');
    lines.push({ step: step.name, name: `${branch}${step.name.padEnd(width)}`, detail: how });
    if (step.verdict) lines.push({ step: step.name, name: `${last ? '   ' : '│  '}${''.padEnd(width)}`, detail: `↺ ${step.verdict.sendTo}, ${step.verdict.rounds} ${step.verdict.rounds === 1 ? 'round' : 'rounds'}` });
  });
  return lines;
}

/** How a step's round stands, as the step tree names it. */
export type StepView = 'done' | 'working' | 'needsYou' | 'waiting' | 'failed' | 'skipped' | 'stopped';

/** The state a step's row shows: its latest round, or `waiting` when it hasn't started. */
export function stepView(state: PipelineRunState, index: number): { view: StepView; row: PipelineRunStep | null } {
  const rows = state.steps.filter((s) => s.index === index);
  const row = rows.at(-1) ?? null;
  const { run } = state;
  if (!row) {
    if (run.step === index && run.status === 'waiting' && (run.waitingFor === 'push' || run.waitingFor === 'confirm')) return { view: 'needsYou', row: null };
    return { view: 'waiting', row: null };
  }
  if (row.status === 'done') return { view: 'done', row };
  if (row.status === 'skipped') return { view: 'skipped', row };
  if (row.status === 'failed') return { view: 'failed', row };
  if (row.status === 'stopped') return { view: 'stopped', row };
  if (row.status === 'waiting') return { view: 'needsYou', row };
  return { view: run.status === 'paused' ? 'waiting' : 'working', row };
}

/** A step's state in words. */
export const STEP_VIEW_WORD: Record<StepView, string> = { done: 'done', working: 'working', needsYou: 'needs you', waiting: 'waits', failed: 'failed', skipped: 'skipped', stopped: 'stopped' };

/** The step the run is at: the current one, or the one its changes went back to. */
export const currentIndex = (state: PipelineRunState) => (state.run.status === 'done' ? -1 : (state.run.sentBackTo ?? state.run.step));

/**
 * What a screen reader says for a step: "Validate, round 2 of 3, working, Opus, read only".
 */
export function stepLabel(state: PipelineRunState, index: number): string {
  const step = state.run.pipeline.steps[index]!;
  const { view, row } = stepView(state, index);
  const parts = [step.name];
  if (step.kind === 'claude' && step.verdict && row && row.round > 1) parts.push(roundOf(row.round, step.verdict.rounds));
  parts.push(STEP_VIEW_WORD[view]);
  if (step.kind === 'claude') {
    parts.push(modelWord(step.model));
    const mode = modeWord(step);
    if (mode) parts.push(mode);
  }
  return parts.join(', ');
}

/** A run's own state, for the parent's row: waiting for you (a stop, Wait for me, Push), working, or failed. */
export function runTreeStatus(state: PipelineRunState): TreeStatus | null {
  const { run } = state;
  if (run.status === 'waiting') return 'needsYou';
  if (run.status === 'running') return 'working';
  return null;
}

/** A run is going on: it isn't done or stopped. */
export const runIsActive = (state: PipelineRunState) => state.run.status !== 'done' && state.run.status !== 'stopped';

/** "18m", "1h 4m": how long a run or a step took, or has taken so far. */
export function spanWords(from: number, to: number): string {
  const minutes = Math.max(0, Math.round((to - from) / 60_000));
  if (minutes < 1) return `${Math.max(0, Math.round((to - from) / 1000))}s`;
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** "step 3 of 4 · 18m": the run's header line. */
export function runHeaderLine(state: PipelineRunState, now: number): string {
  const { run } = state;
  const total = run.pipeline.steps.length;
  const at = run.status === 'done' ? total : Math.min(run.step + 1, total);
  return `step ${at} of ${total} · ${spanWords(run.createdAt, run.endedAt ?? now)}`;
}

/** What a finished step's row in the parent's conversation says: "Plan finished · plan approved · 4m". */
export function finishedLine(row: PipelineRunStep): string {
  const name = row.round > 1 ? `${row.step} · round ${row.round}` : row.step;
  if (row.verdict) {
    const verdict = row.verdict.kind === 'pass' ? `${row.step}: pass` : `${row.step}: changes needed`;
    return [verdict, row.reason?.replace(/\.$/, '') ?? null].filter(Boolean).join(' · ');
  }
  const head = row.status === 'skipped' ? `${name} skipped` : row.status === 'failed' ? `${name} failed` : row.status === 'stopped' ? `${name} stopped` : `${name} finished`;
  const parts = [head, row.reason?.replace(/\.$/, '') ?? null];
  if (row.endedAt) parts.push(spanWords(row.startedAt, row.endedAt));
  return parts.filter(Boolean).join(' · ');
}

/** What to do about a run that stopped, under its reason. */
export function stopAdvice(state: PipelineRunState): string | null {
  const { run } = state;
  if (run.status === 'paused') return 'The run goes on at the next start.';
  if (run.status !== 'waiting' || !run.reason) return null;
  const step = run.pipeline.steps[run.sentBackTo ?? run.step];
  if (run.waitingFor === 'push') return null;
  if (run.waitingFor === 'confirm') return 'Continue to start it.';
  if (/ended with an error|could not start|was stopped/.test(run.reason)) return `Run this step again, or reply in ${step?.name ?? 'the step'}.`;
  if (/has no verdict/.test(run.reason)) return `Its last reply doesn’t end with Verdict: pass or changes needed. Reply in ${step?.name ?? 'the step'}, or Continue.`;
  const to = outOfRounds(state);
  if (to) return `Another round sends the changes to ${to.name}. Or work on them in ${to.name} yourself: ${step?.name ?? 'the step'} checks again when that turn ends. Continue goes on without the changes.`;
  if (/Still changes needed/.test(run.reason)) return `Look at ${step?.name ?? 'the step'} · round ${run.round}, then Continue or Stop the run.`;
  if (/waits for you|asks/.test(run.reason)) return `Answer in ${step?.name ?? 'the step'}. The run goes on when that turn ends cleanly.`;
  return null;
}

/** Whether a run is a run row's: started from New session, with no session of its own yet. */
export const isRunRow = (state: PipelineRunState) => state.run.parentSessionId === null;

/** The pipelines a project can run: every project's, and its own. */
export function pipelinesFor(pipelines: readonly Pipeline[], root: string | null): Pipeline[] {
  return pipelines.filter((p) => p.scope.kind === 'all' || (root !== null && p.scope.root === root));
}

/** A copy of a pipeline to start from (Duplicate): yours, with "copy" after the name. */
export function duplicateOf(pipeline: Pipeline, root: string | null): { name: string; scope: Pipeline['scope']; steps: PipelineStep[]; autoPush: boolean } {
  return { name: `${pipeline.name} copy`, scope: pipeline.builtIn || pipeline.scope.kind === 'all' || !root ? pipeline.scope : { kind: 'project', root }, steps: pipeline.steps.map((s) => ({ ...s })), autoPush: pipeline.autoPush };
}

/** The `@` choices in a step's prompt: the parent, then the steps before it that are sessions. */
export function mentionChoices(steps: readonly PipelineStep[], index: number): string[] {
  return [PARENT_MENTION, ...steps.slice(0, index).filter((s) => s.kind === 'claude').map((s) => s.name)];
}

// --- New session's Run as chip ---------------------------------------------------------------------------------------

/**
 * What each step uses, on one line, under a pipeline's name in the Run as menu: "Plan: Opus · Execute: Sonnet ·
 * Validate: Opus · Push".
 */
export function pipelineMeta(pipeline: Pick<Pipeline, 'steps'>): string {
  return pipeline.steps.map((step) => (step.kind === 'push' ? step.name : `${step.name}: ${modelWord(step.model)}`)).join(' · ');
}

/** The Run as menu's order: the pipeline last used in this project, then the built-ins, then the rest by name. */
export function runAsOrder<P extends Pick<Pipeline, 'id' | 'name' | 'builtIn'>>(pipelines: readonly P[], lastUsed: string | null): P[] {
  const rank = (p: P) => (p.id === lastUsed ? 0 : p.builtIn ? 1 : 2);
  // Built-ins keep their own order; the rest go by name.
  return pipelines
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p) - rank(b.p) || (rank(a.p) === 2 ? a.p.name.localeCompare(b.p.name) : a.i - b.i))
    .map(({ p }) => p);
}

/** The pipeline still picked after the project or the pipelines changed: null once the project can't run it. */
export function keptRunAs(runAs: string | null, pipelines: ReadonlyArray<Pick<Pipeline, 'id'>>): string | null {
  return runAs && pipelines.some((p) => p.id === runAs) ? runAs : null;
}

/** A step in the line under the message box: its name, and who does it ("Opus", "you" for Push). */
export interface RunAsStep {
  name: string;
  who: string;
}

/** The steps a picked pipeline runs, for the line under the message box. `boxModel`: the box's model, for steps without their own. */
export function runAsSteps(pipeline: Pick<Pipeline, 'steps' | 'autoPush'>, boxModel: string | null = null): RunAsStep[] {
  return pipeline.steps.map((step) => ({
    name: step.name,
    who: step.kind === 'push' ? (pipeline.autoPush ? 'by itself' : 'you') : step.model ? modelWord(step.model) : (boxModel ?? modelWord(null)),
  }));
}

/** What a screen reader hears for that line: "Runs as Execute and validate: Execute with Sonnet, then Validate with Opus". */
export function runAsLabel(name: string, steps: readonly RunAsStep[]): string {
  const parts = steps.map((s, i) => {
    const what = s.who === 'you' || s.who === 'by itself' ? s.name : `${s.name} with ${s.who}`;
    return i > 0 && i === steps.length - 1 ? `then ${what}` : what;
  });
  return `Runs as ${name}: ${parts.join(', ')}`;
}

/** A message box chip while a pipeline is picked: dimmed when no step uses it, and what its tooltip adds. */
export interface BoxChoiceUse {
  dim: boolean;
  note: string;
}

/**
 * The model, effort and mode chips while a pipeline is picked: each applies only to the steps that don't set their own.
 * A chip no step uses is dimmed (it stays usable); one some steps use names them.
 */
export function boxChoiceUse(pipeline: Pick<Pipeline, 'steps'>): Record<'model' | 'effort' | 'permissionMode', BoxChoiceUse> {
  const use = (choice: 'model' | 'effort' | 'permissionMode'): BoxChoiceUse => {
    const names = pipeline.steps.filter((s): s is PipelineClaudeStep => s.kind === 'claude' && choicesLeftOpen(s).includes(choice)).map((s) => s.name);
    return names.length ? { dim: false, note: `Used by steps without their own: ${names.join(', ')}.` } : { dim: true, note: 'The pipeline sets this for each step.' };
  };
  return { model: use('model'), effort: use('effort'), permissionMode: use('permissionMode') };
}
