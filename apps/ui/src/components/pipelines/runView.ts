import { clockTime, readVerdict, RUN_FENCE, writeRunStub, type PipelineRun, type PipelineRunState, type PipelineRunStep, type PipelineStep, type PushPreview, type StepVerdict } from '@switchboard/protocol/client';
import { currentIndex, finishedLine, modelWord, modeWord, spanWords, stepView, stopAdvice } from '../../state/pipelines.ts';

// Pipelines (#179): what the parent's step tree, a sub-session and a run row show, in words, without React or the
// stores, so it can be tested. The shared words are in `state/pipelines.ts`.

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
export function stepPills(step: PipelineStep, row: PipelineRunStep | null): Array<{ kind: 'plan' | 'fork' | 'round'; text: string }> {
  if (step.kind === 'push') return [];
  const pills: Array<{ kind: 'plan' | 'fork' | 'round'; text: string }> = [];
  if (step.permissionMode === 'plan') pills.push({ kind: 'plan', text: 'plan' });
  if (typeof step.start === 'object') pills.push({ kind: 'fork', text: 'fork' });
  if (step.verdict && row && row.round > 1) pills.push({ kind: 'round', text: `round ${row.round} of ${step.verdict.rounds}` });
  return pills;
}

/** The step's name in its row: "Validate · round 2" from the second round on. */
export const stepRowName = (step: PipelineStep, row: PipelineRunStep | null) => (row && row.round > 1 ? `${step.name} · round ${row.round}` : step.name);

/**
 * A step row's second line: why it stopped or what it did (the row's reason), else its catch-up's first lines, else
 * what it waits for.
 */
export function stepDetail(state: PipelineRunState, index: number, catchUp: { did: readonly string[] } | null = null): string | null {
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
export function stepDuration(row: PipelineRunStep | null, now: number): string | null {
  if (!row) return null;
  return spanWords(row.startedAt, row.endedAt ?? now);
}

/** Why the next step hasn't started though nothing else holds it. */
export function holdLine(run: Pick<PipelineRun, 'hold' | 'status'>): string | null {
  if (run.status !== 'running' || !run.hold) return null;
  return run.hold === 'focus' ? 'Waits for a free slot' : 'Waits for the usage limit to reset';
}

/** The step tree's buttons: Continue while the run waits for you, else Skip, Run again and Stop while it goes on. */
export function runButtons(state: PipelineRunState): { continue: boolean; skip: boolean; retry: boolean; stop: boolean } {
  const { run } = state;
  const active = run.status === 'running' || run.status === 'waiting' || run.status === 'paused';
  const step = run.pipeline.steps[run.step];
  const claudeStep = step?.kind === 'claude';
  // Push has its own buttons on its card.
  const waitsForPush = run.status === 'waiting' && run.waitingFor === 'push';
  return {
    continue: run.status === 'waiting' && !waitsForPush,
    skip: active && claudeStep,
    retry: active && claudeStep && state.steps.some((s) => s.index === run.step),
    stop: active && !waitsForPush,
  };
}

/** A stop to show on the step tree and in the step: what happened, and what to do. */
export interface StopNotice {
  title: string;
  advice: string | null;
  /** `stop`: something went wrong or needs a look; `paused`: Switchboard was closed; `confirm`: a step waits to start. */
  kind: 'stop' | 'paused' | 'confirm';
  /** The step it stopped at. */
  index: number;
}

/** The run's stop, if it has one: Push has its own card, a run that goes on has none. */
export function stopNotice(state: PipelineRunState): StopNotice | null {
  const { run } = state;
  const index = run.sentBackTo ?? run.step;
  if (run.status === 'paused') return { title: 'Paused: Switchboard was closed', advice: stopAdvice(state), kind: 'paused', index };
  if (run.status !== 'waiting' || run.waitingFor === 'push' || !run.reason) return null;
  const title = run.reason.replace(/\.\s*$/, '');
  const advice = stopAdvice(state);
  if (run.waitingFor === 'confirm') return { title, advice, kind: 'confirm', index };
  const failed = /ended with an error|could not start|was stopped/.test(run.reason);
  return { title, advice: failed && advice ? `The run stopped. ${advice}` : advice, kind: 'stop', index };
}

/** "6 files · worktree-usage-cost → main": what Push commits and where it goes. */
export function pushLine(preview: Pick<PushPreview, 'files' | 'branch' | 'base'>): string {
  const files = `${preview.files} ${preview.files === 1 ? 'file' : 'files'}`;
  const where = preview.branch ? (preview.base ? `${preview.branch} → ${preview.base}` : preview.branch) : null;
  return [files, where].filter(Boolean).join(' · ');
}

/** A row of the parent's conversation that Switchboard adds, not a message: the run's start, and each finished step. */
export type ParentRow =
  | { kind: 'start'; key: string; pipeline: string; at: string }
  | { kind: 'step'; key: string; head: string; rest: string; tone: 'ok' | 'caution' | 'error' | 'muted'; sessionId: string | null };

/** The run's own rows for the parent's conversation, oldest first: "You started …", then a row per finished step. */
export function parentRows(state: PipelineRunState): ParentRow[] {
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
export function withRunStub(text: string, run: Pick<PipelineRun, 'id' | 'pipeline'>): string {
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
export function verdictView(state: PipelineRunState, index: number, round: number, lastReply: string | null): VerdictView | null {
  const step = state.run.pipeline.steps[index];
  if (!step || step.kind !== 'claude' || !step.verdict) return null;
  const row = state.steps.find((s) => s.index === index && s.round === round) ?? null;
  const verdict = readVerdict(lastReply) ?? row?.verdict ?? null;
  if (!verdict) return null;
  const rounds = step.verdict.rounds;
  const view: VerdictView = { verdict, round: `round ${round} of ${rounds}`, next: null };
  if (verdict.kind === 'changes') {
    view.next =
      round < rounds
        ? { to: step.verdict.sendTo, text: `as round ${round + 1}. ${step.name} runs again when it finishes.` }
        : { to: '', text: `Still changes needed after ${round} ${round === 1 ? 'round' : 'rounds'}. The run is paused. Reply in this step to ask Claude to fix the points above, then press Continue in the run's step tree. Or Stop the run.` };
  }
  return view;
}

/** "Round 2 · started 14:21": the divider at the top of a round's sub-session; null for a step without rounds. */
export function roundDivider(state: PipelineRunState, index: number, round: number): string | null {
  const step = state.run.pipeline.steps[index];
  if (!step || step.kind !== 'claude' || !step.verdict) return null;
  const row = state.steps.find((s) => s.index === index && s.round === round);
  return row ? `Round ${round} · started ${clockTime(row.startedAt)}` : `Round ${round}`;
}

/** A project action's result in a step's prompt, in a few words: "exit 0 · 214 passed", "exit 1 · 2 problems · last 40 lines attached". */
export function actionDetail(action: { exitCode: number | null; tail: string }): string {
  if (action.exitCode === null) return ['did not run', firstLine(action.tail)].filter(Boolean).join(' · ');
  const parts = [`exit ${action.exitCode}`];
  const count = countIn(action.tail, action.exitCode === 0);
  if (count) parts.push(count);
  if (action.exitCode !== 0) {
    const lines = action.tail.replace(/\n+$/, '').split('\n').filter((l, i, all) => l.trim() || i < all.length - 1).length;
    if (lines) parts.push(`last ${lines} ${lines === 1 ? 'line' : 'lines'} attached`);
  }
  return parts.join(' · ');
}

const firstLine = (text: string) => text.split('\n').find((l) => l.trim())?.trim().slice(0, 80) ?? '';

/** The count a test or lint run ends with ("214 passed", "2 problems"), from the end of its output. */
function countIn(tail: string, ok: boolean): string | null {
  const patterns = ok ? [/(\d+) (passed)/i, /(\d+) (tests?)\b/i] : [/(\d+) (problems?)/i, /(\d+) (failed)/i, /(\d+) (errors?)/i];
  const lines = tail.split('\n').reverse();
  for (const pattern of patterns) {
    for (const line of lines) {
      const m = pattern.exec(line);
      if (m) return `${m[1]} ${m[2]!.toLowerCase()}`;
    }
  }
  return null;
}

/** Whether a sub-session is the step the run waits on now (so its message box and notice say so). */
export function waitsOnStep(state: PipelineRunState, index: number, round: number): boolean {
  const { run } = state;
  if (run.status !== 'waiting' && run.status !== 'paused') return false;
  if (currentIndex(state) !== index) return false;
  const latest = state.steps.filter((s) => s.index === index).at(-1);
  return !latest || latest.round === round;
}
