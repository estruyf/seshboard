import {
  changesMessage,
  type ImageAttachment,
  enterStep,
  fillStepPrompt,
  linkLabel,
  nextStep,
  readVerdict,
  stepTitle,
  withoutBriefs,
  withRunChoices,
  type CatchUp,
  type Effort,
  type NextStep,
  type PermissionMode,
  type Pipeline,
  type PipelineClaudeStep,
  type PipelineNotice,
  type PipelineRun,
  type PipelineRunState,
  type PipelineRunStep,
  type PushPreview,
  type RunChoices,
  type SessionOutcome,
  type SessionHostInfo,
  type SessionSummary,
  type StepActionResult,
} from '@switchboard/protocol';
import type { RunStore } from './runStore.ts';

/** How a step's sub-session runs. */
export interface StepSettings {
  model: string | null;
  effort: Effort | null;
  permissionMode: PermissionMode;
  readOnly: boolean;
}

/** Why a step that is ready can't start yet: the focus limit (a free slot), or a usage limit (its reset). */
export type StepHold = { kind: 'focus' } | { kind: 'limit'; resetsAt: number | null };

export interface RunnerDeps {
  runs: RunStore;
  pipeline(id: string): Pipeline | null;
  session(id: string): SessionSummary | null;
  /**
   * Makes the folder every step of a run works in: a new worktree from the parent's branch, or the parent's worktree
   * when it has one. `from` is the parent's folder, or the project's for a run row.
   */
  workspace(input: { from: string; projectRoot: string; parentSessionId: string | null; name: string }): Promise<string>;
  /** Starts a new session in `cwd` with the prompt; its id. */
  create(params: StepSettings & { cwd: string; prompt: string; attachments: ImageAttachment[]; profileId: string | null }): Promise<string>;
  /** Forks a session (its context and cache) with the prompt as the fork's first message; the fork's id. */
  fork(params: StepSettings & { from: string; prompt: string }): Promise<string>;
  /** Sends a message to a session (it resumes when it isn't running). */
  send(sessionId: string, text: string): Promise<void>;
  /** Stops a session's turn, if it works. */
  interrupt(sessionId: string): Promise<void>;
  /** Gives a sub-session its title once it has a transcript. */
  title(sessionId: string, title: string): void;
  /** A session's parent changed: send it again. */
  reparented(sessionId: string): void;
  /** Sessions' parents changed (a run deleted, its sub-sessions kept): send them again, in one change. */
  republishSessions(sessionIds: readonly string[]): void;
  /** Archives or unarchives sessions (a run's tree), in one change. */
  archiveSessions(sessionIds: readonly string[], archived: boolean): void;
  /** Takes sessions out of Switchboard (a run's tree deleted); their transcripts stay. */
  hideSessions(sessionIds: readonly string[]): void;
  /** A run was deleted: the windows drop it. */
  removed(runId: string): void;
  /** Runs project actions by name in the run's folder, one after the other. */
  runActions(run: PipelineRun, names: readonly string[]): Promise<StepActionResult[]>;
  /** The last reply of a session's last turn. */
  lastReply(sessionId: string): Promise<string | null>;
  /** What holds a step that is ready, or null. */
  hold(run: PipelineRun): StepHold | null;
  /** Whether a session works or waits for you right now. */
  busy(sessionId: string): 'working' | 'waiting' | null;
  /** Whether a session has a permission or a question still waiting for your answer. */
  asks(sessionId: string): boolean;
  /** Push's commit message and what it would push. */
  pushPreview(run: PipelineRun): Promise<PushPreview>;
  /** Commits (with `message`), pushes and opens the pull request; the pull request, or null when gh opened none. */
  push(run: PipelineRun, request: { message: string; title: string; body: string; draft: boolean }): Promise<{ number: number; url: string } | null>;
  changed(state: PipelineRunState): void;
  notify(notice: PipelineNotice): void;
  log(level: 'info' | 'warn', message: string): void;
  now?(): number;
}

/** Told to a step that was working when Switchboard quit, when the run goes on. */
export const RESUME_STEP_PROMPT = 'Switchboard was closed while you were working on this. Go on where you stopped.';
/** What a step in plan mode hears when you approve its plan: the next step builds it. */
export const PLAN_APPROVED_MESSAGE = 'The user approved this plan. Don’t start building it: the next step of the pipeline does that. Reply with one line that says the plan is ready, and stop.';
const PAUSED_REASON = 'Paused: Switchboard was closed. The run goes on at the next start.';

const waitsForYou = (card: CatchUp | null) => !!card && (card.state === 'waiting' || card.need.kind === 'permission' || card.need.kind === 'question' || card.need.kind === 'reply');

/** A step that waits for you to approve something: what the parent's row says. */
function askReason(step: string, toolName: string): string {
  if (toolName === 'ExitPlanMode') return `${step} waits for you to approve the plan.`;
  if (toolName === 'AskUserQuestion') return `${step} asks a question.`;
  return `${step} asks to use ${toolName}.`;
}

/**
 * Runs pipelines (#179): each step as a sub-session under the session (or run row) it was started from, all in one
 * folder, one after the other. It hears the same session outcomes and holds as `QueueAutoStarter`:
 *
 * - A step is done when its last turn ended `clean`, the catch-up doesn't say Claude waits for you, and its verdict,
 *   if it has one, is pass (`nextStep`). Then the next one starts by itself, once the focus limit has a free slot and
 *   no usage limit holds it.
 * - The run stops for you on an error or a stop, a question or a permission, a verdict still failing after its rounds
 *   or missing, and before a step with `confirmBefore` or Push. Replying in the step that stopped lets the run go on
 *   when that turn ends cleanly.
 * - Quitting pauses a run; at the next start it goes on, never in the middle of a turn: a step that was working gets
 *   a new message.
 *
 * Calls for one run are made one at a time, so a turn that ends while a step starts can't start two.
 */
export class PipelineRunner {
  /** How each session's last turn ended, for a step whose session id comes back after its turn did. */
  private readonly lastTurns = new Map<string, { outcome: SessionOutcome; catchUp: CatchUp | null }>();
  /** Steps that are ready but held, by run. */
  private readonly holds = new Map<string, StepHold>();
  /** Each run's queue of calls. */
  private readonly chains = new Map<string, Promise<unknown>>();
  /** Push previews, by run, so Haiku writes the message once. */
  private readonly previews = new Map<string, Promise<PushPreview>>();
  private limitTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  /** The state each session this app runs was last in, to see one closed in the middle of a turn. */
  private readonly hostStates = new Map<string, SessionHostInfo['state']>();

  constructor(private readonly deps: RunnerDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** Every run with its steps, with what holds them. */
  list(): PipelineRunState[] {
    return this.deps.runs.states().map((state) => this.decorate(state));
  }

  state(runId: string): PipelineRunState | null {
    const state = this.deps.runs.state(runId);
    return state ? this.decorate(state) : null;
  }

  private decorate(state: PipelineRunState): PipelineRunState {
    const hold = this.holds.get(state.run.id);
    return hold ? { ...state, run: { ...state.run, hold: hold.kind } } : state;
  }

  private emit(runId: string): void {
    const state = this.state(runId);
    if (state) this.deps.changed(state);
  }

  /** Runs `work` after the run's earlier calls. */
  private serial<T>(runId: string, work: () => Promise<T>): Promise<T> {
    const before = this.chains.get(runId) ?? Promise.resolve();
    const next = before.then(work, work);
    const settled = next.catch(() => {});
    this.chains.set(runId, settled);
    void settled.then(() => {
      if (this.chains.get(runId) === settled) this.chains.delete(runId);
    });
    return next;
  }

  /**
   * Starts a run: from a session (it is the parent), or from New session with a task (a run row is the parent). Its
   * folder is made now; the first step starts (or waits) right after.
   */
  async start(input: { pipelineId: string; parentSessionId?: string | null; task?: string | null; attachments?: ImageAttachment[]; projectRoot?: string; profileId?: string | null; choices?: RunChoices | null }): Promise<PipelineRunState> {
    const saved = this.deps.pipeline(input.pipelineId);
    if (!saved) throw new Error('That pipeline was deleted.');
    // The run keeps its own copy: New session's choices go into what each step leaves open.
    const pipeline = withRunChoices(saved, input.choices ?? null);
    const parent = input.parentSessionId ? this.deps.session(input.parentSessionId) : null;
    if (input.parentSessionId && !parent) throw new Error('That session is gone.');
    const task = input.task?.trim() || null;
    if (!parent && !task) throw new Error('Write the task first.');
    const projectRoot = parent?.projectRoot ?? input.projectRoot;
    if (!projectRoot) throw new Error('Pick a project first.');
    const title = parent?.title || linkLabel(task ?? pipeline.name);
    const from = parent?.cwd ?? projectRoot;
    const cwd = await this.deps.workspace({ from, projectRoot, parentSessionId: parent?.id ?? null, name: title });
    const run = this.deps.runs.create({ pipeline, parentSessionId: parent?.id ?? null, task, title, projectRoot, cwd, profileId: parent?.profileId ?? input.profileId ?? null, attachments: input.attachments });
    this.deps.log('info', `Pipelines: started “${pipeline.name}” for “${title}” in ${cwd}`);
    await this.serial(run.id, () => this.apply(run.id, enterStep(pipeline.steps, 0, pipeline.autoPush)));
    return this.state(run.id)!;
  }

  // --- What the engine tells it ---------------------------------------------------------------------------------------

  /** The runs that listen to a session now: the one whose current step (or the step its changes went to) it is. */
  private waitingOn(sessionId: string): PipelineRun[] {
    return this.deps.runs.list().filter((run) => (run.status === 'running' || (run.status === 'waiting' && run.waitingFor === 'you')) && this.waitedSession(run) === sessionId);
  }

  /** The session a run waits on: the current step's latest round, or the step a verdict's changes went to. */
  private waitedSession(run: PipelineRun): string | null {
    const index = run.sentBackTo ?? run.step;
    const steps = this.deps.runs.steps(run.id).filter((s) => s.index === index);
    const row = run.sentBackTo === null ? (steps.find((s) => s.round === run.round) ?? null) : (steps.at(-1) ?? null);
    return row?.sessionId ?? null;
  }

  /** A session's turn ended, with its catch-up (null when there is none). */
  turnEnded(sessionId: string, outcome: SessionOutcome, catchUp: CatchUp | null): Promise<void> {
    this.lastTurns.set(sessionId, { outcome, catchUp });
    // Quitting ends every turn: the run pauses instead (`pauseAll`).
    if (outcome === 'quit' || this.closed) return Promise.resolve();
    return Promise.all(this.waitingOn(sessionId).map((run) => this.serial(run.id, () => this.afterTurn(run.id, sessionId)))).then(() => {});
  }

  /** A session asks for a permission or an answer: a run that waits on it stops for you, with what it asks. */
  needsYou(sessionId: string, toolName: string): void {
    for (const run of this.waitingOn(sessionId)) {
      if (run.status !== 'running') continue;
      const name = run.pipeline.steps[run.sentBackTo ?? run.step]?.name ?? 'The step';
      const reason = askReason(name, toolName);
      this.deps.runs.update(run.id, { status: 'waiting', waitingFor: 'you', reason });
      // The session's own Needs you notification says so: no second one.
      this.markRow(run, { status: 'waiting', reason });
      this.emit(run.id);
    }
  }

  /**
   * A session this app runs changed state. One closed in the middle of a turn ends without a `result`: for the run
   * that is a stop, as for the queue.
   */
  onHost(info: Pick<SessionHostInfo, 'sessionId' | 'state'>): void {
    const before = this.hostStates.get(info.sessionId);
    this.hostStates.set(info.sessionId, info.state);
    if (info.state === 'closed' || info.state === 'error') this.hostStates.delete(info.sessionId);
    const wasBusy = before === 'starting' || before === 'running' || before === 'needs-you';
    if (wasBusy && info.state === 'closed' && !this.closed) void this.turnEnded(info.sessionId, 'stopped', null);
    // The step works again (you replied after it stopped for you, or sent a message instead of answering): so does the run.
    if (info.state === 'running' && before !== 'running') this.answered(info.sessionId);
  }

  /**
   * You answered: the step works again. Asked right when the answer settles, while the session still says it needs
   * you, so only another question or permission that still waits keeps the run waiting.
   */
  answered(sessionId: string): void {
    for (const run of this.waitingOn(sessionId)) {
      if (run.status !== 'waiting' || this.deps.asks(sessionId)) continue;
      this.deps.runs.update(run.id, { status: 'running', waitingFor: null, reason: null });
      this.markRow(run, { status: 'working', reason: null });
      this.emit(run.id);
    }
  }

  /** Changes the row of the session a run waits on. */
  private markRow(run: PipelineRun, change: Partial<PipelineRunStep>): void {
    const index = run.sentBackTo ?? run.step;
    const row = run.sentBackTo === null ? this.deps.runs.steps(run.id).find((s) => s.index === index && s.round === run.round) : this.deps.runs.latest(run.id, index);
    if (row) this.deps.runs.updateStep(run.id, row.index, row.round, change);
  }

  /**
   * You approved a plan in a session. A step in plan mode keeps it (a brief's `plan`) and is told not to build it,
   * since the next step does: the answer Claude Code gets instead of the plain approval. Null for any other session.
   */
  planApproved(sessionId: string, plan: string): string | null {
    const row = this.deps.runs.stepOf(sessionId);
    if (!row) return null;
    const run = this.deps.runs.get(row.runId);
    const step = run?.pipeline.steps[row.index];
    if (!run || step?.kind !== 'claude' || step.permissionMode !== 'plan') return null;
    this.deps.runs.updateStep(run.id, row.index, row.round, { plan: plan.slice(0, 20_000), reason: 'plan approved' });
    this.emit(run.id);
    // Only while the run still goes on: after a stop, approving builds it in this session, as anywhere else.
    return run.status === 'stopped' || run.status === 'done' ? null : PLAN_APPROVED_MESSAGE;
  }

  /** Whether a sub-session is a read-only step: its resumes keep the read-only hook. */
  isReadOnly(sessionId: string): boolean {
    const row = this.deps.runs.stepOf(sessionId);
    if (!row) return false;
    const step = this.deps.runs.get(row.runId)?.pipeline.steps[row.index];
    return step?.kind === 'claude' && step.readOnly;
  }

  /** The run started from a session (the newest one), for the parent's view and its brief. */
  runOf(parentSessionId: string): PipelineRunState | null {
    const run = this.deps.runs
      .list()
      .filter((r) => r.parentSessionId === parentSessionId)
      .at(-1);
    return run ? this.state(run.id) : null;
  }

  private async afterTurn(runId: string, sessionId: string): Promise<void> {
    const run = this.deps.runs.get(runId);
    const turn = this.lastTurns.get(sessionId);
    if (!run || !turn || this.waitedSession(run) !== sessionId) return;
    if (!(run.status === 'running' || (run.status === 'waiting' && run.waitingFor === 'you'))) return;
    const steps = run.pipeline.steps;
    const step = steps[run.step];
    const verdictStep = step?.kind === 'claude' && step.verdict !== null && run.sentBackTo === null;
    const verdict = verdictStep && turn.outcome === 'clean' ? readVerdict(await this.deps.lastReply(sessionId).catch(() => null)) : null;
    const next = nextStep({ ...run, autoPush: run.pipeline.autoPush }, steps, { outcome: turn.outcome, waitsForYou: waitsForYou(turn.catchUp), verdict });
    if (run.sentBackTo !== null) {
      // The step the changes went to: its row stays as it is, only its reason says how the round went.
      const row = this.deps.runs.latest(run.id, run.sentBackTo);
      if (row) this.deps.runs.updateStep(run.id, row.index, row.round, { status: next.kind === 'stop' ? (turn.outcome === 'error' ? 'failed' : 'waiting') : 'done', outcome: turn.outcome, endedAt: this.now() });
    } else {
      const stopped = next.kind === 'stop';
      this.markRow(run, {
        status: stopped ? (turn.outcome === 'error' ? 'failed' : turn.outcome === 'stopped' ? 'stopped' : 'waiting') : 'done',
        outcome: turn.outcome,
        ...(verdictStep ? { verdict } : {}),
        ...(stopped ? { reason: next.reason } : {}),
        endedAt: this.now(),
      });
    }
    if (next.kind === 'stop' && (turn.outcome === 'error' || turn.outcome === 'stopped')) await this.stopFor(run.id, next.reason, false);
    else await this.apply(run.id, next);
  }

  // --- Going on ------------------------------------------------------------------------------------------------------

  private async apply(runId: string, next: NextStep): Promise<void> {
    const run = this.deps.runs.get(runId);
    if (!run || run.status === 'stopped') return;
    const steps = run.pipeline.steps;
    switch (next.kind) {
      case 'start':
        await this.startStep(run, next.index, next.round);
        break;
      case 'sendBack': {
        const from = steps[next.from] as PipelineClaudeStep;
        const fromRow = this.deps.runs.steps(run.id).find((s) => s.index === next.from && s.round === run.round);
        const to = this.deps.runs.latest(run.id, next.to);
        if (!fromRow?.sessionId || !to?.sessionId || !fromRow.verdict) {
          await this.apply(runId, { kind: 'stop', reason: `${from.name} has changes for ${steps[next.to]?.name ?? 'a step'}, and its session is gone.` });
          return;
        }
        this.deps.runs.updateStep(run.id, fromRow.index, fromRow.round, { reason: `Changes needed: sent to ${steps[next.to]!.name}.` });
        this.deps.runs.update(run.id, { sentBackTo: next.to, round: next.round, status: 'running', waitingFor: null, reason: null });
        this.deps.runs.updateStep(run.id, to.index, to.round, { status: 'working', reason: `Round ${next.round}: changes from ${from.name}.`, endedAt: null });
        this.emit(run.id);
        try {
          await this.deps.send(to.sessionId, changesMessage({ name: from.name, sessionId: fromRow.sessionId }, fromRow.verdict, run.round, from.verdict?.rounds ?? next.round));
        } catch (error) {
          await this.stopFor(runId, `${steps[next.to]!.name} could not get the changes: ${message(error)}`);
        }
        break;
      }
      case 'confirm': {
        this.deps.runs.update(run.id, { step: next.index, round: 1, sentBackTo: null, status: 'waiting', waitingFor: next.wait, reason: next.reason });
        this.deps.notify({ kind: 'needsYou', runId, sessionId: run.parentSessionId, title: run.title, body: next.reason });
        this.emit(run.id);
        // Haiku writes Push's message now, so it is there when you look.
        if (next.wait === 'push') void this.pushPreview(runId).catch(() => {});
        break;
      }
      case 'push':
        this.deps.runs.update(run.id, { step: next.index, round: 1, sentBackTo: null, status: 'running', waitingFor: null, reason: null });
        await this.doPush(runId, null);
        break;
      case 'stop':
        await this.stopFor(runId, next.reason);
        break;
      case 'done': {
        this.holds.delete(runId);
        this.deps.runs.update(run.id, { step: steps.length, sentBackTo: null, status: 'done', waitingFor: null, reason: null });
        const done = this.deps.runs.get(runId)!;
        this.deps.log('info', `Pipelines: “${run.pipeline.name}” for “${run.title}” is done`);
        this.deps.notify({ kind: 'done', runId, sessionId: run.parentSessionId, title: run.title, body: done.pr ? `Done. Pull request #${done.pr.number} is open.` : `${run.pipeline.name} is done.` });
        this.emit(run.id);
        break;
      }
    }
  }

  /**
   * Stops for you, with the reason. `notify` is off when the session already said so (a turn that failed or was
   * stopped has its own notification).
   */
  private async stopFor(runId: string, reason: string, notify = true): Promise<void> {
    const run = this.deps.runs.get(runId);
    if (!run) return;
    this.holds.delete(runId);
    this.deps.runs.update(runId, { status: 'waiting', waitingFor: 'you', reason });
    if (notify) this.deps.notify({ kind: 'stopped', runId, sessionId: this.waitedSession(run) ?? run.parentSessionId, title: run.title, body: reason });
    this.emit(runId);
  }

  /** The latest sub-session of each step before `index`, by name. */
  private earlierSessions(run: PipelineRun, index: number): Record<string, string> {
    const out: Record<string, string> = {};
    for (const row of this.deps.runs.steps(run.id)) if (row.index < index && row.sessionId) out[row.step] = row.sessionId;
    return out;
  }

  private async startStep(run: PipelineRun, index: number, round: number): Promise<void> {
    const step = run.pipeline.steps[index];
    if (!step) return this.apply(run.id, { kind: 'done' });
    if (step.kind === 'push') return this.apply(run.id, enterStep(run.pipeline.steps, index, run.pipeline.autoPush));
    this.deps.runs.update(run.id, { step: index, round, sentBackTo: null, status: 'running', waitingFor: null, reason: null });
    const current = this.deps.runs.get(run.id)!;
    const hold = this.deps.hold(current);
    if (hold) {
      this.holds.set(run.id, hold);
      this.scheduleReset();
      this.emit(run.id);
      return;
    }
    this.holds.delete(run.id);
    this.deps.runs.startStep(run.id, index, round, step.name);
    this.emit(run.id);
    try {
      const actions = step.actionsFirst.length ? await this.deps.runActions(current, step.actionsFirst) : [];
      if (actions.length) this.deps.runs.updateStep(run.id, index, round, { actions });
      // Stopped or skipped while the actions ran.
      const now = this.deps.runs.get(run.id);
      if (!now || now.status === 'stopped' || now.step !== index || now.round !== round) return;
      const sessions = this.earlierSessions(run, index);
      const parent = run.parentSessionId ? this.deps.session(run.parentSessionId) : null;
      const label = linkLabel(run.title);
      const filled = fillStepPrompt(step, {
        task: run.task ?? (parent?.firstPrompt ? withoutBriefs(parent.firstPrompt) : null),
        parent: run.parentSessionId ? { kind: 'session', sessionId: run.parentSessionId, label } : { kind: 'task', label, text: run.task ?? run.title },
        steps: sessions,
        actions,
      });
      const settings: StepSettings = { model: step.model, effort: step.effort, permissionMode: step.permissionMode ?? 'default', readOnly: step.readOnly };
      let sessionId: string;
      if (typeof step.start === 'object') {
        const from = sessions[step.start.fork];
        if (!from) throw new Error(`${step.start.fork} has no session to fork.`);
        sessionId = await this.deps.fork({ ...settings, from, prompt: filled.text });
      } else sessionId = await this.deps.create({ ...settings, cwd: run.cwd, prompt: filled.text, attachments: this.deps.runs.attachments(run.id), profileId: run.profileId });
      this.deps.runs.updateStep(run.id, index, round, { sessionId });
      this.deps.runs.setParent(sessionId, run.parentSessionId ?? run.id, run.id);
      this.deps.reparented(sessionId);
      this.deps.title(sessionId, stepTitle(step.name, round));
      this.emit(run.id);
      // Its turn may have ended before its id came back.
      if (this.lastTurns.has(sessionId) && this.deps.busy(sessionId) === null) {
        const turn = this.lastTurns.get(sessionId)!;
        if (turn.outcome !== 'quit') await this.afterTurn(run.id, sessionId);
      }
    } catch (error) {
      this.deps.runs.updateStep(run.id, index, round, { status: 'failed', reason: message(error), endedAt: this.now() });
      await this.stopFor(run.id, `${step.name} could not start: ${message(error)}`);
    }
  }

  // --- What you do -----------------------------------------------------------------------------------------------------

  private need(runId: string): PipelineRun {
    const run = this.deps.runs.get(runId);
    if (!run) throw new Error('That run is gone.');
    return run;
  }

  /**
   * Continue: start the step that waits for you (Wait for me, or Push), or after a stop go on to the next step as if
   * this one were done. A paused run goes on.
   */
  continue(runId: string, commitMessage?: string): Promise<PipelineRunState> {
    return this.serial(runId, async () => {
      const run = this.need(runId);
      if (run.status === 'paused') await this.resumeRun(run);
      else if (run.status === 'waiting' && run.waitingFor === 'confirm') await this.startStep(run, run.step, 1);
      else if (run.status === 'waiting' && run.waitingFor === 'push') {
        this.deps.runs.update(runId, { status: 'running', waitingFor: null, reason: null });
        await this.doPush(runId, commitMessage ?? null);
      } else if (run.status === 'waiting' && run.sentBackTo !== null) {
        // It stopped while the changes were with an earlier step: that step counts as done, and the step that sent
        // them checks again (a new round), never the step after it.
        this.closeSentBack(run, 'done');
        await this.startStep({ ...run, sentBackTo: null }, run.step, run.round);
      } else if (run.status === 'waiting') {
        const index = run.step;
        // The step that stopped counts as done; the run goes on after the current step.
        const row = this.deps.runs.latest(runId, index);
        if (row && row.status !== 'done') this.deps.runs.updateStep(runId, row.index, row.round, { status: 'done', endedAt: row.endedAt ?? this.now() });
        this.deps.runs.update(runId, { sentBackTo: null, status: 'running', waitingFor: null, reason: null });
        await this.apply(runId, enterStep(run.pipeline.steps, run.step + 1, run.pipeline.autoPush));
      }
      return this.state(runId)!;
    });
  }

  /** Run this step again: a new round of the current step, in a new sub-session. */
  retryStep(runId: string): Promise<PipelineRunState> {
    return this.serial(runId, async () => {
      const run = this.need(runId);
      if (run.status === 'done') throw new Error('This run is done.');
      await this.stopWorking(run);
      this.closeSentBack(run, 'stopped');
      const rounds = this.deps.runs.steps(runId).filter((s) => s.index === run.step);
      const round = Math.max(0, ...rounds.map((s) => s.round)) + 1;
      for (const row of rounds) if (row.status === 'working' || row.status === 'waiting') this.deps.runs.updateStep(runId, row.index, row.round, { status: 'stopped', reason: 'Ran again.', endedAt: this.now() });
      if (run.pipeline.steps[run.step]?.kind === 'push') {
        this.deps.runs.update(runId, { status: 'running', waitingFor: null, reason: null });
        await this.doPush(runId, null);
      } else await this.startStep({ ...run, status: 'running' }, run.step, round);
      return this.state(runId)!;
    });
  }

  /** Skip this step: it counts as skipped, and the next one starts (or waits). */
  skipStep(runId: string): Promise<PipelineRunState> {
    return this.serial(runId, async () => {
      const run = this.need(runId);
      if (run.status === 'done' || run.status === 'stopped') throw new Error('This run has ended.');
      await this.stopWorking(run);
      this.closeSentBack(run, 'stopped');
      const row = this.deps.runs.steps(runId).find((s) => s.index === run.step && s.round === run.round);
      const step = run.pipeline.steps[run.step];
      if (row) this.deps.runs.updateStep(runId, row.index, row.round, { status: 'skipped', endedAt: this.now() });
      else if (step) this.deps.runs.startStep(runId, run.step, run.round, step.name, { status: 'skipped', endedAt: this.now() });
      this.holds.delete(runId);
      this.deps.runs.update(runId, { sentBackTo: null, status: 'running', waitingFor: null, reason: null });
      await this.apply(runId, enterStep(run.pipeline.steps, run.step + 1, run.pipeline.autoPush));
      return this.state(runId)!;
    });
  }

  /** Stop the run: the step that works stops too, and nothing starts after it. */
  stop(runId: string): Promise<PipelineRunState> {
    return this.serial(runId, async () => {
      const run = this.need(runId);
      if (run.status === 'done' || run.status === 'stopped') return this.state(runId)!;
      this.holds.delete(runId);
      this.deps.runs.update(runId, { status: 'stopped', waitingFor: null, reason: 'You stopped the run.' });
      await this.stopWorking(run);
      for (const row of this.deps.runs.steps(runId)) if (row.status === 'working' || row.status === 'waiting') this.deps.runs.updateStep(runId, row.index, row.round, { status: 'stopped', endedAt: this.now() });
      this.emit(runId);
      return this.state(runId)!;
    });
  }

  /**
   * The step changes were sent back to, when the run leaves that send-back (Continue, Run this step again, Skip this
   * step): its row ends, so it doesn't stay working in the tree, and the run no longer waits on its session.
   */
  private closeSentBack(run: PipelineRun, status: 'done' | 'stopped'): void {
    if (run.sentBackTo === null) return;
    const row = this.deps.runs.latest(run.id, run.sentBackTo);
    // Continue counts it as done, as it does a stopped step; leaving it stops it only if it still works or waits.
    if (row && (status === 'done' ? row.status !== 'done' : row.status === 'working' || row.status === 'waiting')) {
      this.deps.runs.updateStep(run.id, row.index, row.round, { status, ...(status === 'stopped' ? { reason: 'Left by you.' } : {}), endedAt: row.endedAt ?? this.now() });
    }
    this.deps.runs.update(run.id, { sentBackTo: null });
  }

  /** Stops the turn of the session the run waits on, if it works. */
  private async stopWorking(run: PipelineRun): Promise<void> {
    const sessionId = this.waitedSession(run);
    if (sessionId && this.deps.busy(sessionId)) await this.deps.interrupt(sessionId).catch(() => {});
  }

  // --- Push ----------------------------------------------------------------------------------------------------------

  /** Push's commit message (Haiku, from the diff) and what it pushes; written once per run. */
  pushPreview(runId: string, fresh = false): Promise<PushPreview> {
    let preview = fresh ? undefined : this.previews.get(runId);
    if (!preview) {
      preview = this.deps.pushPreview(this.need(runId));
      this.previews.set(runId, preview);
      preview.catch(() => this.previews.delete(runId));
    }
    return preview;
  }

  /** The pull request's title and description: the task, the plan and the last verdict. */
  pullRequestText(runId: string): { title: string; body: string } {
    const state = this.deps.runs.state(runId)!;
    const { run } = state;
    const parent = run.parentSessionId ? this.deps.session(run.parentSessionId) : null;
    const task = run.task ?? (parent?.firstPrompt ? withoutBriefs(parent.firstPrompt) : null);
    const plan = state.steps.filter((s) => s.plan).at(-1)?.plan ?? null;
    const verdict = state.steps.filter((s) => s.verdict).at(-1);
    const parts: string[] = [];
    if (task) parts.push(task.trim());
    if (plan) parts.push(`## Plan\n\n${plan.trim()}`);
    if (verdict?.verdict) parts.push(`## ${verdict.step}\n\nVerdict: ${verdict.verdict.kind === 'pass' ? 'pass' : 'changes needed'}${verdict.round > 1 ? ` (round ${verdict.round})` : ''}`);
    parts.push(`Made with the Switchboard pipeline “${run.pipeline.name}”.`);
    return { title: linkLabel(run.title), body: parts.join('\n\n').slice(0, 60_000) };
  }

  private async doPush(runId: string, commitMessage: string | null): Promise<void> {
    const run = this.need(runId);
    const step = run.pipeline.steps[run.step];
    if (step?.kind !== 'push') return;
    const rounds = this.deps.runs.steps(runId).filter((s) => s.index === run.step);
    const round = Math.max(0, ...rounds.map((s) => s.round)) + 1;
    this.deps.runs.startStep(runId, run.step, round, step.name);
    this.emit(runId);
    try {
      const text = commitMessage?.trim() || (await this.pushPreview(runId)).message;
      const { title, body } = this.pullRequestText(runId);
      const pr = await this.deps.push(this.deps.runs.get(runId)!, { message: text, title, body, draft: step.draft });
      this.deps.runs.updateStep(runId, run.step, round, { status: 'done', outcome: 'clean', reason: pr ? `Pull request #${pr.number} opened.` : 'Pushed.', endedAt: this.now() });
      if (pr) this.deps.runs.update(runId, { pr });
      this.previews.delete(runId);
      await this.apply(runId, enterStep(run.pipeline.steps, run.step + 1, run.pipeline.autoPush));
    } catch (error) {
      this.deps.runs.updateStep(runId, run.step, round, { status: 'failed', reason: message(error), endedAt: this.now() });
      this.deps.runs.update(runId, { status: 'waiting', waitingFor: 'push', reason: `${step.name} failed: ${message(error)}` });
      this.deps.notify({ kind: 'stopped', runId, sessionId: run.parentSessionId, title: run.title, body: `${step.name} failed: ${message(error)}` });
      this.emit(runId);
    }
  }

  // --- Holds, quitting and starting again -----------------------------------------------------------------------------

  /** Looks at held runs again: call it when the focus count or a usage limit changes. */
  check(): void {
    if (this.closed) return;
    for (const runId of [...this.holds.keys()]) {
      void this.serial(runId, async () => {
        const run = this.deps.runs.get(runId);
        if (!run || run.status !== 'running' || !this.holds.has(runId)) return;
        if (this.deps.hold(run)) return;
        this.holds.delete(runId);
        await this.startStep(run, run.step, run.round);
      });
    }
  }

  private scheduleReset(): void {
    clearTimeout(this.limitTimer);
    const resets = [...this.holds.values()].flatMap((h) => (h.kind === 'limit' && h.resetsAt !== null ? [h.resetsAt] : []));
    if (!resets.length || this.closed) return;
    this.limitTimer = setTimeout(() => this.check(), Math.max(1_000, Math.min(...resets) - this.now() + 1_000));
    this.limitTimer.unref?.();
  }

  /** Switchboard quits: every run that goes on pauses, to go on at the next start. */
  pauseAll(): void {
    this.closed = true;
    clearTimeout(this.limitTimer);
    for (const run of this.deps.runs.list()) {
      if (run.status !== 'running') continue;
      this.deps.runs.update(run.id, { status: 'paused', reason: PAUSED_REASON });
    }
  }

  /**
   * At start: runs that were paused (or still running, after a crash) go on. A step that was working gets a message to
   * go on, so it never picks up in the middle of a turn; one that hadn't started starts.
   */
  async resumeAll(): Promise<void> {
    if (this.closed) return;
    for (const run of this.deps.runs.list()) {
      if (run.status !== 'paused' && run.status !== 'running') continue;
      await this.serial(run.id, () => this.resumeRun(run)).catch((error: unknown) => this.deps.log('warn', `Pipelines: could not resume ${run.id}: ${message(error)}`));
    }
  }

  private async resumeRun(run: PipelineRun): Promise<void> {
    this.deps.runs.update(run.id, { status: 'running', waitingFor: null, reason: null });
    const sessionId = this.waitedSession(run);
    if (!sessionId) {
      await this.startStep({ ...run, status: 'running' }, run.step, run.round);
      return;
    }
    this.markRow(run, { status: 'working', reason: null, endedAt: null });
    this.emit(run.id);
    if (this.deps.busy(sessionId)) return;
    try {
      await this.deps.send(sessionId, RESUME_STEP_PROMPT);
    } catch (error) {
      await this.stopFor(run.id, `${run.pipeline.steps[run.sentBackTo ?? run.step]?.name ?? 'The step'} could not go on: ${message(error)}`);
    }
  }

  /** A run row got a session of its own (you wrote in it): its sub-sessions go under that session. */
  adopt(runId: string, sessionId: string): void {
    const children = this.deps.runs.childrenOf(runId);
    this.deps.runs.update(runId, { parentSessionId: sessionId });
    for (const child of children) this.deps.reparented(child);
    this.emit(runId);
  }

  /**
   * A run's tree, as the sidebar shows it: its parent (a session, or the run row), every run started from that parent,
   * and every sub-session under it.
   */
  tree(runId: string): { parentSessionId: string | null; runs: PipelineRun[]; children: string[] } {
    const run = this.need(runId);
    const runs = run.parentSessionId ? this.deps.runs.list().filter((r) => r.parentSessionId === run.parentSessionId) : [run];
    return { parentSessionId: run.parentSessionId, runs, children: this.deps.runs.childrenOf(run.parentSessionId ?? run.id) };
  }

  /**
   * Archives (or unarchives) a run's tree in one go: the parent session or the run row, and every sub-session under it.
   * A run that goes on is never archived: stop it first.
   */
  archive(runId: string, archived: boolean): PipelineRunState[] {
    const tree = this.tree(runId);
    if (archived && tree.runs.some(goesOn)) throw new Error('The run is still going. Stop it first.');
    this.deps.archiveSessions([...(tree.parentSessionId ? [tree.parentSessionId] : []), ...tree.children], archived);
    if (!tree.parentSessionId) this.deps.runs.setArchived(runId, archived);
    for (const run of tree.runs) this.emit(run.id);
    return tree.runs.map((run) => this.state(run.id)!);
  }

  /**
   * Deletes a run's tree: its runs (stopped first, if they go on) and, unless `keepSubSessions`, its sub-sessions. A
   * parent session goes too. Sessions only leave Switchboard: their transcripts stay. Kept sub-sessions show on their own.
   */
  async delete(runId: string, keepSubSessions: boolean): Promise<void> {
    const tree = this.tree(runId);
    for (const run of tree.runs) if (goesOn(run)) await this.stop(run.id);
    const hidden = [...(tree.parentSessionId ? [tree.parentSessionId] : []), ...(keepSubSessions ? [] : tree.children)];
    for (const run of tree.runs) {
      this.holds.delete(run.id);
      this.previews.delete(run.id);
      this.deps.runs.remove(run.id);
      this.deps.removed(run.id);
      this.deps.log('info', `Pipelines: deleted the run ${run.id}${keepSubSessions ? ', its sub-sessions kept' : ''}`);
    }
    if (hidden.length) this.deps.hideSessions(hidden);
    if (keepSubSessions && tree.children.length) this.deps.republishSessions(tree.children);
  }

  /** Forgets runs (a deleted parent): their sub-sessions stay, on their own. */
  remove(runId: string): void {
    const children = this.deps.runs.childrenOf(runId);
    const run = this.deps.runs.get(runId);
    const under = run?.parentSessionId ? this.deps.runs.childrenOf(run.parentSessionId) : [];
    this.holds.delete(runId);
    this.previews.delete(runId);
    this.deps.runs.remove(runId);
    for (const child of [...children, ...under]) this.deps.reparented(child);
  }

  close(): void {
    this.pauseAll();
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A run that goes on by itself (or at the next start): archiving it would hide work still being done. */
const goesOn = (run: PipelineRun) => run.status === 'running' || run.status === 'waiting' || run.status === 'paused';
