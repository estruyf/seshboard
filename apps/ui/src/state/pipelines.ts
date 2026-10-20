import {
  heldByLabel,
  latestRow,
  pipelineBlanks,
  rowsOf,
  runIdOfRow,
  type CatchUp,
  type HeldBy,
  type Pipeline,
  type PipelineRun,
  type PipelineRunState,
  type PipelineRunStep,
  type RunRow,
  type StepState,
} from '@switchboard/protocol/client';
import type { DisplayItem } from '../components/transcript/displayItems.ts';

// Pipelines (#179) in the window: the words and rules the sidebar, the run panel and the entry points share. Without
// React or the stores, so they are tested on their own. The engine decides what a run does (`packages/protocol/src/
// pipelines.ts`); this only says what to show and which buttons apply.

/** The word for a step's state, as the panel shows it. */
export const STEP_STATE_LABEL: Record<StepState, string> = {
  pending: 'Not started',
  running: 'Working',
  done: 'Done',
  'needs-you': 'Needs you',
  failed: 'Failed',
  skipped: 'Skipped',
  stopped: 'Stopped',
};

/** The status colour of a step's state (AGENTS.md › Status colours): a text class and a dot class. */
export const STEP_TONE: Record<StepState, { text: string; dot: string }> = {
  pending: { text: 'text-faint', dot: 'border border-faint' },
  running: { text: 'text-accent-ink', dot: 'bg-accent-ink' },
  done: { text: 'text-muted', dot: 'bg-ok' },
  'needs-you': { text: 'text-warn', dot: 'bg-warn' },
  failed: { text: 'text-error', dot: 'bg-error' },
  skipped: { text: 'text-faint', dot: 'bg-faint' },
  stopped: { text: 'text-faint', dot: 'bg-faint' },
};

/** A model as the panel names it: the picker's aliases and Claude's ids both read as "Opus", "Sonnet 4.5"; nothing picked is the default. */
export function modelName(model: string | null | undefined): string {
  const raw = (model ?? '').trim();
  if (!raw) return 'Default model';
  const words = raw
    .replace(/^claude[-\s]*/i, '')
    .replace(/\[.*?\]/g, '')
    .split(/[-\s]+/)
    .filter(Boolean);
  const family = words.find((w) => /^[a-z]+$/i.test(w));
  if (!family) return raw;
  const version = words.filter((w) => /^\d+$/.test(w)).slice(0, 2).join('.');
  return `${family[0]!.toUpperCase()}${family.slice(1)}${version ? ` ${version}` : ''}`;
}

export interface StepView {
  index: number;
  name: string;
  kind: 'claude' | 'push';
  /** The model's name for a Claude step, null for a push. */
  model: string | null;
  /** The state of the step's latest round; `pending` before it ran. */
  state: StepState;
  /** The latest round (1 before it ran). */
  round: number;
  /** The step's sub-session in its latest round, or null. */
  sessionId: string | null;
  /** The earlier rounds' sessions, oldest first (a verdict step that ran again). */
  earlier: Array<{ round: number; sessionId: string }>;
  /** Why it stopped or what it decided, in a sentence. */
  note: string | null;
  /** The step the run is at. */
  current: boolean;
  /** "Changes needed" / "Pass" for a verdict step. */
  verdict: PipelineRunStep['verdict'];
  /** The step forks another step's session: its name. */
  forks: string | null;
}

/** The pipeline's steps, each with where its latest round stands: what the panel lists. */
export function stepViews(run: Pick<PipelineRun, 'pipeline' | 'stepIndex' | 'state'>, rows: readonly PipelineRunStep[]): StepView[] {
  return run.pipeline.steps.map((step, index) => {
    const all = rowsOf(rows, index);
    const latest = latestRow(rows, index);
    const claude = step.kind === 'claude';
    return {
      index,
      name: step.name,
      kind: step.kind,
      model: claude ? modelName(step.model) : null,
      state: latest?.state ?? 'pending',
      round: latest?.round ?? 1,
      sessionId: latest?.sessionId ?? null,
      earlier: all.slice(0, -1).flatMap((r) => (r.sessionId ? [{ round: r.round, sessionId: r.sessionId }] : [])),
      note: latest?.note ?? null,
      current: run.state !== 'done' && index === run.stepIndex,
      verdict: latest?.verdict ?? null,
      forks: claude && step.start.kind === 'fork' ? step.start.step : null,
    };
  });
}

/** What the buttons under the step list offer. */
export interface RunActions {
  /** Start the step that waits, go on past a step that stopped for you, or look again at one that errored. */
  continue: boolean;
  /** Run the step the run is at again, as a new sub-session. */
  retry: boolean;
  skip: boolean;
  stop: boolean;
  /** The one yellow button: what most likely comes next. Null when none stands out. */
  primary: 'continue' | 'retry' | null;
}

const NONE: RunActions = { continue: false, retry: false, skip: false, stop: false, primary: null };

/**
 * Which of Continue, Run this step again, Skip this step and Stop the run apply, from why the run waits. A finished or
 * stopped run offers none. Waiting for a limit or another run only offers Stop; a push, a missing folder and a shared
 * pipeline's first run have their own card (or nothing to press).
 */
export function runActions(run: Pick<PipelineRun, 'state' | 'heldBy'>): RunActions {
  if (run.state === 'done' || run.state === 'stopped') return NONE;
  if (run.state === 'running' || run.state === 'held') return { ...NONE, stop: true };
  switch (run.heldBy) {
    case 'confirm':
      return { continue: true, retry: false, skip: true, stop: true, primary: 'continue' };
    case 'reply':
    case 'verdict':
      return { continue: true, retry: true, skip: true, stop: true, primary: 'continue' };
    case 'error':
      return { continue: true, retry: true, skip: true, stop: true, primary: 'retry' };
    case 'closed':
      return { continue: false, retry: true, skip: true, stop: true, primary: 'retry' };
    default:
      // push, trust, worktree: their card, or nothing to press but Stop.
      return { ...NONE, stop: true };
  }
}

/** Whether the run still does something or waits for something (so it shows in the panel with a Stop). */
export const runIsOpen = (run: Pick<PipelineRun, 'state'>) => run.state !== 'done' && run.state !== 'stopped';

/** Why the run waits, in a sentence: the plain label for the reason, and the engine's more specific note after it when it adds something. */
export function heldLine(run: Pick<PipelineRun, 'state' | 'heldBy' | 'note' | 'pipeline' | 'stepIndex'>): { label: string; note: string | null } | null {
  if (run.state !== 'held' && run.state !== 'needs-you') return null;
  if (!run.heldBy) return run.note ? { label: run.note, note: null } : null;
  const step = run.pipeline.steps[Math.min(run.stepIndex, run.pipeline.steps.length - 1)]?.name ?? 'The step';
  const label = heldByLabel(run.heldBy as HeldBy, step);
  const note = run.note && run.note !== label ? run.note : null;
  return { label, note };
}

/** The first line of a task, cut for a title. */
export function taskTitle(task: string, max = 80): string {
  const line = (task.split('\n').find((l) => l.trim()) ?? '').replace(/\s+/g, ' ').trim();
  return line.length <= max ? line || 'Pipeline run' : `${line.slice(0, max - 1).trimEnd()}…`;
}

/** The runs a parent has, newest first: a session id, or `run:<id>` for a run row. */
export function runsOfParent(parentId: string, runs: Iterable<PipelineRunState>): PipelineRunState[] {
  const runId = runIdOfRow(parentId);
  return [...runs].filter((r) => (runId !== null ? r.run.id === runId : r.run.parentSessionId === parentId)).sort((a, b) => b.run.createdAt - a.run.createdAt);
}

/** The run to show in a parent's panel: the newest that is still open, else the newest. */
export function shownRun(parentId: string, runs: Iterable<PipelineRunState>): PipelineRunState | null {
  const mine = runsOfParent(parentId, runs);
  return mine.find((r) => runIsOpen(r.run)) ?? mine[0] ?? null;
}

/** Where a sub-session sits in its run, for the bar over it. */
export interface Origin {
  runId: string;
  pipelineName: string;
  stepName: string;
  /** 1-based. */
  stepNumber: number;
  total: number;
  round: number;
  /** The parent session's id, or `run:<id>`. */
  parentId: string;
}

/** The run and step a session belongs to, from the runs' rows; null for a session that is no step. */
export function originOf(sessionId: string | null, runs: Iterable<PipelineRunState>): Origin | null {
  if (!sessionId) return null;
  for (const { run, steps } of runs) {
    const row = steps.find((s) => s.sessionId === sessionId);
    if (!row) continue;
    return {
      runId: run.id,
      pipelineName: run.pipeline.name,
      stepName: row.stepName,
      stepNumber: row.stepIndex + 1,
      total: run.pipeline.steps.length,
      round: row.round,
      parentId: run.parentSessionId ?? `run:${run.id}`,
    };
  }
  return null;
}

/** "Execute · step 2 of Plan, execute, validate, push", with the round after it from the second one. */
export function originLine(origin: Origin): { head: string; tail: string } {
  const head = origin.round > 1 ? `${origin.stepName} (round ${origin.round})` : origin.stepName;
  return { head, tail: `step ${origin.stepNumber} of ${origin.pipelineName}` };
}

/** The blanks a pipeline asks for that still have no value (a blank marked optional may stay empty). */
export function missingBlanks(pipeline: Pick<Pipeline, 'steps'>, values: Readonly<Record<string, string>>): string[] {
  return pipelineBlanks(pipeline)
    .filter((b) => !b.optional && !(values[b.name] ?? '').trim())
    .map((b) => b.name);
}

/** What lists a pipeline in a picker: its steps and where they work. */
export function pipelineSummary(pipeline: Pick<Pipeline, 'steps' | 'workspace'>): string {
  const count = pipeline.steps.length;
  return `${count} ${count === 1 ? 'step' : 'steps'} · ${pipeline.workspace === 'worktree' ? 'new worktree' : 'in the project folder'}`;
}

/** The scope word on a pipeline in a picker. */
export function scopeLabel(scope: Pipeline['scope']): string {
  switch (scope.kind) {
    case 'builtin':
      return 'Built in';
    case 'global':
      return 'All projects';
    case 'project':
      return 'This project';
    case 'shared':
      return 'Shared with the project';
  }
}

/** The line a push card's button says while it works, and when it has the choice of words. */
export function pushLabel(step: { commit: boolean; pullRequest: unknown | null } | undefined): string {
  if (!step) return 'Push';
  if (step.pullRequest) return 'Push and open pull request';
  return step.commit ? 'Commit and push' : 'Push';
}

/** The present-tense label on the push button while `pipelines.pushProgress` says where it is. */
export function pushBusyLabel(step: 'commit' | 'push' | 'create' | 'done' | 'failed' | null): string | null {
  switch (step) {
    case 'commit':
      return 'Committing…';
    case 'push':
      return 'Pushing…';
    case 'create':
      return 'Opening pull request…';
    default:
      return null;
  }
}

/** The one line under a step: what its catch-up says it did, or what it waits for. Null without a catch-up. */
export function catchUpLine(card: Pick<CatchUp, 'state' | 'did' | 'need'> | undefined): string | null {
  if (!card) return null;
  if (card.state === 'waiting') return card.need.title || null;
  if (card.state === 'error') return 'Stopped with an error';
  return card.did[0] ?? null;
}

/**
 * The parent's conversation with its run's muted rows in it ("Plan done", "Validate: changes needed, sent to Execute"),
 * each at the time its step ended. They are notices the app adds: nothing here is sent to Claude. Items without a time
 * stay in their place.
 */
export function mergeRunRows(items: readonly DisplayItem[], rows: readonly RunRow[]): DisplayItem[] {
  if (rows.length === 0) return items as DisplayItem[];
  const pending = [...rows].sort((a, b) => a.at - b.at);
  const out: DisplayItem[] = [];
  const flush = (until: number) => {
    while (pending.length && pending[0]!.at <= until) {
      const row = pending.shift()!;
      out.push({ kind: 'notice', key: `run-row:${row.id}`, at: row.at, text: row.text });
    }
  };
  for (const item of items) {
    if (item.at !== null) flush(item.at);
    out.push(item);
  }
  flush(Infinity);
  return out;
}
