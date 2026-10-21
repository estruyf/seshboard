// Pipelines (#179) as the views show them: the words of the step tree, a sub-session, a run row, the sidebar's tree and
// New session's Run as, without zod, React or the stores. Shared by the app's windows and the remote app, so a run reads
// the same on the computer and on a phone. They take a run as either has it (`RunView`): the app's `PipelineRunState`,
// or a phone's `RemoteRunState`, which leaves out the plan, the actions' output and the folders.

import { clockTime } from './queueStates.ts';
import type { PermissionMode } from './host.ts';
import type { Pipeline, PipelineClaudeStep, PipelineRun, PipelineRunStep, PipelineStep, PushPreview, StepVerdict } from './pipelineSchema.ts';
import { choicesLeftOpen, outOfRounds, readVerdict, roundOf, RUN_FENCE, runProgress, stepStateWord, writeRunStub, type TreeStatus } from './pipelines.ts';

/** A step's round as the views read it. */
export type RunViewStep = Pick<PipelineRunStep, 'step' | 'index' | 'round' | 'sessionId' | 'status' | 'verdict' | 'reason' | 'startedAt' | 'endedAt'>;

/** A run as the views read it: the app's `PipelineRunState`, or a phone's `RemoteRunState`. */
export interface RunView<S extends RunViewStep = RunViewStep> {
  run: Pick<PipelineRun, 'id' | 'status' | 'reason' | 'waitingFor' | 'hold' | 'step' | 'round' | 'sentBackTo' | 'parentSessionId' | 'createdAt' | 'endedAt'> & {
    pipeline: Pick<Pipeline, 'name' | 'steps' | 'autoPush'>;
  };
  steps: readonly S[];
}

/** A permission mode in a few words, as the mode chip names it. */
const MODE_WORDS: Record<PermissionMode, string> = {
  default: 'Ask before edits',
  acceptEdits: 'Accept edits',
  plan: 'Plan mode',
  auto: 'Auto mode',
  dontAsk: "Don't ask",
  bypassPermissions: 'Bypass permissions',
};

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
  return step.permissionMode === 'plan' ? 'plan mode' : MODE_WORDS[step.permissionMode];
}

// --- A step's state ---------------------------------------------------------------------------------------------------

/** How a step's round stands, as the step tree names it. */
export type StepView = 'done' | 'working' | 'needsYou' | 'waiting' | 'failed' | 'skipped' | 'stopped';

/** The state a step's row shows: its latest round, or `waiting` when it hasn't started. */
export function stepView<S extends RunViewStep>(state: RunView<S>, index: number): { view: StepView; row: S | null } {
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
export const currentIndex = (state: RunView) => (state.run.status === 'done' ? -1 : (state.run.sentBackTo ?? state.run.step));

/** What a screen reader says for a step: "Validate, round 2 of 3, working, Opus, read only". */
export function stepLabel(state: RunView, index: number): string {
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
export function runTreeStatus(state: RunView): TreeStatus | null {
  const { run } = state;
  if (run.status === 'waiting') return 'needsYou';
  if (run.status === 'running') return 'working';
  return null;
}

/** A run is going on: it isn't done or stopped. */
export const runIsActive = (state: RunView) => state.run.status !== 'done' && state.run.status !== 'stopped';

/** Whether a run is a run row's: started from New session, with no session of its own yet. */
export const isRunRow = (state: RunView) => state.run.parentSessionId === null;

/** "18m", "1h 4m": how long a run or a step took, or has taken so far. */
export function spanWords(from: number, to: number): string {
  const minutes = Math.max(0, Math.round((to - from) / 60_000));
  if (minutes < 1) return `${Math.max(0, Math.round((to - from) / 1000))}s`;
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** "step 3 of 4 · 18m": the run's header line. */
export function runHeaderLine(state: RunView, now: number): string {
  const { run } = state;
  const total = run.pipeline.steps.length;
  const at = run.status === 'done' ? total : Math.min(run.step + 1, total);
  return `step ${at} of ${total} · ${spanWords(run.createdAt, run.endedAt ?? now)}`;
}

/** What a finished step's row in the parent's conversation says: "Plan finished · plan approved · 4m". */
export function finishedLine(row: RunViewStep): string {
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
export function stopAdvice(state: RunView): string | null {
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

// --- The step tree ------------------------------------------------------------------------------------------------------

/** The line at the top of a read-only step's conversation. */
export const READ_ONLY_LINE = 'Read only: Claude can read, search and run checks. It can’t edit files.';

/** The message box of a session a run started from, and of a run row. */
export const PARENT_PLACEHOLDER = 'Message Claude. It gets a brief of the run first.';

/** The message box of a step that waits for you. */
export const replyToStepPlaceholder = (step: string) => `Reply to ${step}. The run goes on when this turn ends cleanly.`;

/** "Opus · plan mode", "Sonnet · fork of Plan", or "commit, push, pull request" for Push: a step row's grey words. */
export function stepMeta(step: PipelineStep): string {
  if (step.kind === 'push') return 'commit, push, pull request';
  const how = typeof step.start === 'object' ? `fork of ${step.start.fork}` : modeWord(step);
  return [modelWord(step.model), how].filter(Boolean).join(' · ');
}

/** The pills after a step's name: plan, fork, and "round 2 of 3" from the second round on. */
export function stepPills(step: PipelineStep, row: Pick<RunViewStep, 'round'> | null): Array<{ kind: 'plan' | 'fork' | 'round'; text: string }> {
  if (step.kind === 'push') return [];
  const pills: Array<{ kind: 'plan' | 'fork' | 'round'; text: string }> = [];
  if (step.permissionMode === 'plan') pills.push({ kind: 'plan', text: 'plan' });
  if (typeof step.start === 'object') pills.push({ kind: 'fork', text: 'fork' });
  if (step.verdict && row && row.round > 1) pills.push({ kind: 'round', text: roundOf(row.round, step.verdict.rounds) });
  return pills;
}

/** The step's name in its row: "Validate · round 2" from the second round on. */
export const stepRowName = (step: PipelineStep, row: Pick<RunViewStep, 'round'> | null) => (row && row.round > 1 ? `${step.name} · round ${row.round}` : step.name);

/**
 * A step row's second line: why it stopped or what it did (the row's reason), else its catch-up's first lines, else
 * what it waits for.
 */
export function stepDetail(state: RunView, index: number, catchUp: { did: readonly string[] } | null = null): string | null {
  const { run } = state;
  const steps = run.pipeline.steps;
  const step = steps[index]!;
  const { view, row } = stepView(state, index);
  if (row) {
    if (row.reason) return row.reason;
    if (catchUp?.did.length) return catchUp.did.slice(0, 2).join(' ');
    if (view === 'working') return 'Working';
    return null;
  }
  if (view === 'needsYou') return step.kind === 'push' ? 'Waits for you to push.' : 'Waits for you to start it.';
  const before = steps[index - 1];
  const after = before ? (before.kind === 'claude' && before.verdict ? `after ${before.name} passes` : `after ${before.name}`) : null;
  if (step.kind === 'push') return run.pipeline.autoPush ? `Pushes by itself${after ? ` ${after}` : ''}.` : `Waits for you${after ? ` ${after}` : ''}.`;
  if (step.confirmBefore) return `Waits for you${after ? ` ${after}` : ''}.`;
  return after ? `Starts ${after}.` : 'Starts first.';
}

/** How long a step took, or has taken so far; null before it starts. */
export function stepDuration(row: Pick<RunViewStep, 'startedAt' | 'endedAt'> | null, now: number): string | null {
  if (!row) return null;
  return spanWords(row.startedAt, row.endedAt ?? now);
}

/** Why the next step hasn't started though nothing else holds it. */
export function holdLine(run: Pick<PipelineRun, 'hold' | 'status'>): string | null {
  if (run.status !== 'running' || !run.hold) return null;
  return run.hold === 'focus' ? 'Waits for a free slot' : 'Waits for the usage limit to reset';
}

/** The step tree's buttons: Continue while the run waits for you, else Skip, Run again and Stop while it goes on. */
export function runButtons(state: RunView): { continue: boolean; anotherRound: boolean; skip: boolean; retry: boolean; stop: boolean } {
  const { run } = state;
  const active = run.status === 'running' || run.status === 'waiting' || run.status === 'paused';
  const step = run.pipeline.steps[run.step];
  const claudeStep = step?.kind === 'claude';
  // Push has its own buttons on its card.
  const waitsForPush = run.status === 'waiting' && run.waitingFor === 'push';
  return {
    continue: run.status === 'waiting' && !waitsForPush,
    anotherRound: outOfRounds(state) !== null,
    skip: active && claudeStep,
    retry: active && claudeStep && state.steps.some((s) => s.index === run.step),
    stop: active && !waitsForPush,
  };
}

/** Push's card shows in the tree: the run waits for you at Push. */
export const waitsForPush = (state: RunView) => state.run.status === 'waiting' && state.run.waitingFor === 'push';

/** A stop to show on the step tree and in the step: what happened, and what to do. */
export interface StopNotice {
  title: string;
  advice: string | null;
  /** `stop`: something went wrong or needs a look; `paused`: Switchboard was closed; `confirm`: a step waits to start. */
  kind: 'stop' | 'paused' | 'confirm';
  /** The step it stopped at. */
  index: number;
  /** The step Another round sends the changes to, when the verdict still asks for changes after its rounds. */
  anotherRound: string | null;
}

/** The run's stop, if it has one: Push has its own card, a run that goes on has none. */
export function stopNotice(state: RunView): StopNotice | null {
  const { run } = state;
  const index = run.sentBackTo ?? run.step;
  if (run.status === 'paused') return { title: 'Paused: Switchboard was closed', advice: stopAdvice(state), kind: 'paused', index, anotherRound: null };
  if (run.status !== 'waiting' || run.waitingFor === 'push' || !run.reason) return null;
  const title = run.reason.replace(/\.\s*$/, '');
  const advice = stopAdvice(state);
  if (run.waitingFor === 'confirm') return { title, advice, kind: 'confirm', index, anotherRound: null };
  const failed = /ended with an error|could not start|was stopped/.test(run.reason);
  return { title, advice: failed && advice ? `The run stopped. ${advice}` : advice, kind: 'stop', index, anotherRound: outOfRounds(state)?.name ?? null };
}

/** "6 files · worktree-usage-cost → main": what Push commits and where it goes. */
export function pushLine(preview: Pick<PushPreview, 'files' | 'branch' | 'base'>): string {
  const files = `${preview.files} ${preview.files === 1 ? 'file' : 'files'}`;
  const where = preview.branch ? (preview.base ? `${preview.branch} → ${preview.base}` : preview.branch) : null;
  return [files, where].filter(Boolean).join(' · ');
}

// --- The parent's conversation and a sub-session's ---------------------------------------------------------------------

/** A row of the parent's conversation that Switchboard adds, not a message: the run's start, and each finished step. */
export type ParentRow =
  | { kind: 'start'; key: string; pipeline: string; at: string }
  | { kind: 'step'; key: string; head: string; rest: string; tone: 'ok' | 'caution' | 'error' | 'muted'; sessionId: string | null };

/** The run's own rows for the parent's conversation, oldest first: "You started …", then a row per finished step. */
export function parentRows(state: RunView): ParentRow[] {
  const { run } = state;
  const rows: ParentRow[] = [{ kind: 'start', key: `${run.id}:start`, pipeline: run.pipeline.name, at: clockTime(run.createdAt) }];
  const finished = state.steps.filter((s) => s.endedAt !== null && s.status !== 'working' && s.status !== 'waiting').sort((a, b) => a.endedAt! - b.endedAt!);
  for (const row of finished) {
    const line = finishedLine(row);
    const cut = line.indexOf(' · ');
    const tone = row.verdict ? (row.verdict.kind === 'pass' ? 'ok' : 'caution') : row.status === 'done' ? 'ok' : row.status === 'failed' ? 'error' : 'muted';
    rows.push({ kind: 'step', key: `${run.id}:${row.index}:${row.round}`, head: cut < 0 ? line : line.slice(0, cut), rest: cut < 0 ? '' : line.slice(cut + 3), tone, sessionId: row.sessionId });
  }
  return rows;
}

/**
 * A message to a run's parent, with the run's stub after it so the engine gives Claude the run's brief first. A slash
 * command goes as it is, and a message that already links the run isn't linked twice.
 */
export function withRunStub(text: string, run: Pick<PipelineRun, 'id'> & { pipeline: Pick<Pipeline, 'name'> }): string {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('/')) return text;
  if (text.includes(`\`\`\`${RUN_FENCE}\nrun: ${run.id}`)) return text;
  return `${trimmed}\n\n${writeRunStub(run.pipeline.name, run.id)}`;
}

/** What a step's verdict card shows: the verdict, its list, and what the run does with it. */
export interface VerdictView {
  verdict: StepVerdict;
  /** "round 1 of 3". */
  round: string;
  /** "Sent to Execute as round 2. Validate runs again when it finishes."; null for a pass. */
  next: { to: string; text: string } | null;
}

/**
 * The verdict card of a step's round: read from its last reply (`readVerdict`), else what the run recorded. Null for a
 * step without a verdict, or a round that has none yet.
 */
export function verdictView(state: RunView, index: number, round: number, lastReply: string | null): VerdictView | null {
  const step = state.run.pipeline.steps[index];
  if (!step || step.kind !== 'claude' || !step.verdict) return null;
  const row = state.steps.find((s) => s.index === index && s.round === round) ?? null;
  const verdict = readVerdict(lastReply) ?? row?.verdict ?? null;
  if (!verdict) return null;
  const rounds = step.verdict.rounds;
  const view: VerdictView = { verdict, round: roundOf(round, rounds), next: null };
  if (verdict.kind === 'changes') {
    // A round after this one means the changes went on: by the pipeline's rounds, Another round, or your own turn.
    const sentOn = round < rounds || state.steps.some((s) => s.index === index && s.round > round) || (state.run.step === index && state.run.round > round);
    view.next = sentOn
      ? { to: step.verdict.sendTo, text: `as round ${round + 1}. ${step.name} runs again when it finishes.` }
      : { to: '', text: `Still changes needed after ${round} ${round === 1 ? 'round' : 'rounds'}. Another round sends them to ${step.verdict.sendTo}. Or work on them in ${step.verdict.sendTo} yourself: ${step.name} checks again when that turn ends.` };
  }
  return view;
}

/** "Round 2 · started 14:21": the divider at the top of a round's sub-session; null for a step without rounds. */
export function roundDivider(state: RunView, index: number, round: number): string | null {
  const step = state.run.pipeline.steps[index];
  if (!step || step.kind !== 'claude' || !step.verdict) return null;
  const row = state.steps.find((s) => s.index === index && s.round === round);
  return row ? `Round ${round} · started ${clockTime(row.startedAt)}` : `Round ${round}`;
}

/** Whether a sub-session is the step the run waits on now (so its message box and notice say so). */
export function waitsOnStep(state: RunView, index: number, round: number): boolean {
  const { run } = state;
  if (run.status !== 'waiting' && run.status !== 'paused') return false;
  if (currentIndex(state) !== index) return false;
  const latest = state.steps.filter((s) => s.index === index).at(-1);
  return !latest || latest.round === round;
}

/** "Execute · step 2 of 4": a sub-session's place in its run, for its header. */
export const stepPlace = (state: RunView, index: number, round: number) => `${round > 1 ? `${state.run.pipeline.steps[index]?.name ?? 'Step'} · round ${round}` : (state.run.pipeline.steps[index]?.name ?? 'Step')} · step ${index + 1} of ${state.run.pipeline.steps.length}`;

// --- Runs and steps in a list of sessions ------------------------------------------------------------------------------

/** The newest run started from a session, or a run row's run by its id. */
export function runOfParent<R extends RunView>(runs: Iterable<R>, parentId: string): R | null {
  let found: R | null = null;
  for (const state of runs) {
    if (state.run.id === parentId) return state;
    if (state.run.parentSessionId === parentId && (!found || state.run.createdAt > found.run.createdAt)) found = state;
  }
  return found;
}

/** The run and step a sub-session is. */
export function runOfStep<R extends RunView>(runs: Iterable<R>, sessionId: string): { state: R; index: number; round: number } | null {
  for (const state of runs) {
    const row = state.steps.findLast((s) => s.sessionId === sessionId);
    if (row) return { state, index: row.index, round: row.round };
  }
  return null;
}

const clean = (text: string | null | undefined) => (text ? text.trim().replace(/\.$/, '') : null) || null;

/**
 * A sub-session's second line in the sidebar: the step's model, then how it started or its mode while it works, then
 * its state or what it did. "Opus · plan approved", "Sonnet · fork of Plan · working", "Opus · read only · working".
 */
export function childMeta(state: RunView, row: RunViewStep): string {
  const step = state.run.pipeline.steps[row.index];
  const going = row.status === 'working' || row.status === 'waiting';
  const parts: Array<string | null> = [];
  if (step?.kind === 'claude') {
    parts.push(modelWord(step.model));
    parts.push(typeof step.start === 'object' ? `fork of ${step.start.fork}` : going ? modeWord(step) : null);
  }
  const verdict = row.verdict ? (row.verdict.kind === 'pass' ? 'pass' : 'changes needed') : null;
  parts.push(going ? stepStateWord(row.status) : (verdict ?? clean(row.reason) ?? stepStateWord(row.status)));
  return parts.filter(Boolean).join(' · ');
}

/** What a waiting sub-session asks, after its name: "asks a question", "asks to use Bash". */
export function asksWords(toolName: string | null): string {
  if (toolName === null) return 'waits for you';
  if (toolName === 'AskUserQuestion') return 'asks a question';
  if (toolName === 'ExitPlanMode') return 'has a plan to review';
  return `asks to use ${toolName}`;
}

/**
 * A parent's second line when its run needs you: which sub-session asks what, or why the run waits. "Needs you ·
 * Execute asks a question", "Needs you · Push waits for you".
 */
export function treeNeedsYouLine(state: RunView | null, waitingChild: { title: string; toolName: string | null } | null): string {
  if (waitingChild) return `Needs you · ${waitingChild.title} ${asksWords(waitingChild.toolName)}`;
  const run = state?.run;
  if (!run || run.status !== 'waiting') return 'Needs you';
  if (run.waitingFor === 'push') return 'Needs you · Push waits for you';
  const reason = clean(run.reason);
  if (reason) return `Needs you · ${reason}`;
  const step = run.pipeline.steps[run.sentBackTo ?? run.step];
  return step ? `Needs you · ${step.name} waits for you` : 'Needs you';
}

/** A parent's second line while its run counts: "Validate · 3 of 4 · switchboard" (no project with the filter on). */
export const parentRunLine = (state: RunView, project: string | null) => [runProgress(state.run), project].filter(Boolean).join(' · ');

/** A run row's second line: "Run · Plan · 1 of 4 · switchboard". */
export const runRowLine = (state: RunView, project: string | null) => ['Run', runProgress(state.run), project].filter(Boolean).join(' · ');

// --- New session's Run as ----------------------------------------------------------------------------------------------

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
