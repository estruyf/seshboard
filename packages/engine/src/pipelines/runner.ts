import {
  briefTargets,
  fillStepPrompt,
  forkSource,
  heldByLabel,
  latestRow,
  nextRound,
  nextStep,
  pipelineHash,
  prBodyFrom,
  prTitleFrom,
  randomWorktreeName,
  replyOf,
  RpcError,
  rowsOf,
  runRowId,
  stateFor,
  writeRunBrief,
  writeStub,
  ACTION_OUTPUT_LINES,
  type ActionResult,
  type CatchUpNeedKind,
  type Effort,
  type HeldBy,
  type LogLevel,
  type PermissionMode,
  type Pipeline,
  type PipelineNeedsYou,
  type PipelinePushDraft,
  type PipelinePushProgress,
  type PipelineRun,
  type PipelineRunState,
  type PipelineRunStep,
  type SessionHostInfo,
  type StepEnd,
  type StepEndKind,
} from '@switchboard/protocol';
import { outputTail, plainText } from '../terminals/outputMessage.ts';
import type { PushPlan, PushResult } from './push.ts';
import { ACTIVE_STATES, type PipelineRunStore } from './runStore.ts';

/** How a project action went (`runAction`). */
export type ActionRun = { status: 'ran'; exitCode: number; output: string } | { status: 'missing' } | { status: 'skipped'; note: string };

/** What the runner needs from the rest of the engine; faked in tests. */
export interface RunnerDeps {
  store: PipelineRunStore;
  /** Starts a session with this prompt in `cwd` (never a worktree of its own: the run made one) and returns its id. */
  createSession(params: { cwd: string; prompt: string; model: string | null; effort: Effort | null; permissionMode: PermissionMode; readOnly: boolean; profileId: string | null }): Promise<string>;
  /** Forks a step's session at its last message and sends the prompt on the step's own choices; returns the fork's id. */
  forkAndSend(params: { sessionId: string; text: string; model: string | null; effort: Effort | null; permissionMode: PermissionMode; readOnly: boolean }): Promise<string>;
  /** Sends a message to a session, held in its queue while it works. */
  send(sessionId: string, text: string): Promise<void>;
  /** Stops a session's turn. */
  interrupt(sessionId: string): Promise<void>;
  /** The session's last turn: Claude's last reply, and the plan if the turn proposed one. Null before it answered. */
  lastTurn(sessionId: string): Promise<{ reply: string | null; plan: string | null } | null>;
  /** What the session's last turn leaves for you, without a model (the catch-up's rules). */
  needOf(sessionId: string): Promise<CatchUpNeedKind>;
  /** Whether the session works in a Claude Code process now. */
  busy(sessionId: string): boolean;
  /** Runs a project's shell action in `cwd`, waits for it and returns how it went. */
  runAction(params: { root: string; cwd: string; name: string; sessionId: string | null }): Promise<ActionRun>;
  /** Makes the run's worktree (`<root>/.claude/worktrees/<name>`, a branch of its own) from `fromCwd`'s HEAD and returns its path. */
  makeWorktree(params: { root: string; name: string; fromCwd: string }): Promise<string>;
  /** How many sessions count toward the focus limit, and the limit (null: off). */
  focus(): { limit: number | null; count: number };
  /** The usage limit the run's profile is at, or null. */
  limitHeld(profileId: string | null, cwd: string): { resetsAt: number | null } | null;
  sessionExists(sessionId: string): boolean;
  folderExists(path: string): boolean;
  /** A sub-session got its parent: the session index should send it again. */
  linked(sessionId: string): void;
  /** A run or its steps changed. */
  changed(state: PipelineRunState): void;
  /** A run needs you. */
  notify(event: PipelineNeedsYou): void;
  /** The commit message, pull request title and body the Push card starts with. */
  pushDraft(run: PipelineRun, steps: readonly PipelineRunStep[]): Promise<PipelinePushDraft>;
  /** Commits, pushes and opens the pull request. */
  push(run: PipelineRun, plan: PushPlan, onStep: (step: 'commit' | 'push' | 'create') => void): Promise<PushResult>;
  /** A push is under way or ended. */
  pushProgress(progress: PipelinePushProgress): void;
  now?(): number;
  log(level: LogLevel, message: string): void;
}

/** What you can change on the Push card. */
export interface PushEdits {
  commitMessage: string | null;
  prTitle: string | null;
  prBody: string | null;
}

const lastLine = (text: string) => text.split('\n').find((l) => l.trim())?.trim() ?? '';
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A step that couldn't start: why, and what the run does about it. */
class StepFailure extends Error {
  constructor(
    message: string,
    readonly heldBy: HeldBy = 'error',
  ) {
    super(message);
  }
}

/**
 * Runs pipelines (#179): the engine decides, so a run goes on once, with or without a window. One sub-session per step
 * (and round) under the parent, all in the run's folder, started through the holds the queue has (the focus limit, a
 * usage limit). The rules (when a step is done, what comes next, the verdict, the prompts) are in
 * `@switchboard/protocol` `pipelines.ts`; this class is the state around them:
 *
 * - It listens to every sub-session of a run that is not over, not only the current one: a reply in a sub-session that
 *   stopped carries the run on once its turn ends clean.
 * - It never pushes by itself (a push step stops the run), unless the own pipeline says `autoPush`.
 * - Everything for one run happens one thing after another, so a turn that ends while a step is still starting waits.
 * - A run keeps a snapshot of its pipeline, so editing the pipeline never changes it.
 */
export class PipelineRunner {
  /** The work queued for each run, so its events are handled one at a time. */
  private readonly chains = new Map<string, Promise<unknown>>();
  /** Turn ends of sessions no run knows yet (a step is still creating its session). */
  private readonly early = new Map<string, StepEndKind>();
  private starting = 0;
  /** Pushes that are running. */
  private readonly pushing = new Set<string>();
  private checking: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(private readonly deps: RunnerDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  // --- Reading -----------------------------------------------------------------------------------------------------

  /** Every run with its steps. */
  runs(): PipelineRunState[] {
    const steps = this.deps.store.allSteps();
    return this.deps.store.list().map((run) => ({ run, steps: steps.get(run.id) ?? [] }));
  }

  get(runId: string): PipelineRunState | null {
    const run = this.deps.store.get(runId);
    return run ? { run, steps: this.deps.store.steps(run.id) } : null;
  }

  private require(runId: string): PipelineRun {
    const run = this.deps.store.get(runId);
    if (!run) throw new RpcError('NOT_FOUND', 'That run is gone.');
    return run;
  }

  private emit(runId: string): void {
    const state = this.get(runId);
    if (state) this.deps.changed(state);
  }

  // --- Starting ----------------------------------------------------------------------------------------------------

  /**
   * Starts a run of `pipeline` for `task`. The run's worktree is made first (so its folder is known from the start), and
   * the first step starts unless the pipeline is shared and not yet trusted, or another run holds the folder.
   */
  async start(input: { pipeline: Pipeline; parentSessionId: string | null; root: string; cwd: string; task: string; blanks?: Record<string, string>; profileId: string | null }): Promise<PipelineRun> {
    const { pipeline } = input;
    const shared = pipeline.scope.kind === 'shared';
    const needsTrust = shared && !this.deps.store.isTrusted(input.root, pipeline.id, pipelineHash(pipeline));
    let cwd = input.cwd;
    // A shared pipeline you haven't looked at yet makes nothing: the worktree comes when you start it.
    if (pipeline.workspace === 'worktree' && !needsTrust) cwd = await this.makeWorktree(input.root, input.cwd);
    const run = this.deps.store.create({
      pipeline,
      parentSessionId: input.parentSessionId,
      root: input.root,
      cwd,
      task: input.task.trim(),
      blanks: input.blanks ?? {},
      profileId: input.profileId,
      state: needsTrust ? 'needs-you' : 'running',
      heldBy: needsTrust ? 'trust' : null,
      note: needsTrust ? heldByLabel('trust', pipeline.steps[0]!.name) : null,
    });
    this.emit(run.id);
    if (needsTrust) {
      this.notifyNeedsYou(run);
      return run;
    }
    await this.locked(run.id, () => this.beginStep(run.id, 0, {}));
    return this.require(run.id);
  }

  private async makeWorktree(root: string, fromCwd: string): Promise<string> {
    try {
      return await this.deps.makeWorktree({ root, name: randomWorktreeName(), fromCwd });
    } catch (error) {
      if (error instanceof RpcError) throw error;
      throw new RpcError('GIT_FAILED', `Couldn’t make the run’s worktree. ${messageOf(error)}`);
    }
  }

  /** Whether the run's folder is made (a shared pipeline's worktree waits for your trust). */
  private workspaceReady(run: PipelineRun): boolean {
    return run.pipeline.workspace === 'current' || run.cwd !== run.root;
  }

  /** You looked at a shared pipeline and start it: remembered until the file changes it. */
  async trust(runId: string): Promise<PipelineRun> {
    await this.locked(runId, async () => {
      const run = this.require(runId);
      if (run.heldBy !== 'trust') throw new RpcError('INVALID', 'This run doesn’t wait for you to check it.');
      this.deps.store.trust(run.root, run.pipelineId, pipelineHash(run.pipeline));
      if (!this.workspaceReady(run)) {
        try {
          const cwd = await this.makeWorktree(run.root, run.cwd);
          this.deps.store.update(run.id, { cwd });
        } catch (error) {
          this.stopRun(this.require(runId), 'worktree', messageOf(error));
          return;
        }
      }
      this.deps.store.update(run.id, { state: 'running', heldBy: null, note: null });
      await this.beginStep(runId, 0, {});
    });
    return this.require(runId);
  }

  // --- Starting a step ---------------------------------------------------------------------------------------------

  /** Why the next step can't start now: the folder is gone, another run uses it, the focus limit, a usage limit. */
  private holdFor(run: PipelineRun, index: number): { heldBy: HeldBy; note: string; resetsAt?: number | null } | null {
    if (!this.deps.folderExists(run.cwd)) return { heldBy: 'worktree', note: heldByLabel('worktree', '') };
    if (index === 0 && run.pipeline.workspace === 'current' && this.folderBusy(run)) return { heldBy: 'folder', note: heldByLabel('folder', '') };
    const focus = this.deps.focus();
    if (focus.limit !== null && focus.count >= focus.limit) return { heldBy: 'focus', note: `You’re at your focus limit (${focus.count} of ${focus.limit}). It starts when a slot frees.` };
    const limit = this.deps.limitHeld(run.profileId, run.cwd);
    if (limit) return { heldBy: 'limit', note: limit.resetsAt ? `The usage limit resets at ${new Date(limit.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. It starts then.` : 'It starts when the usage limit resets.', resetsAt: limit.resetsAt };
    return null;
  }

  /** Another run that works in this folder started before this one and is not over. */
  private folderBusy(run: PipelineRun): boolean {
    const before = (other: PipelineRun) => other.createdAt < run.createdAt || (other.createdAt === run.createdAt && other.id < run.id);
    return this.deps.store.active().some((other) => other.id !== run.id && other.cwd === run.cwd && other.pipeline.workspace === 'current' && before(other));
  }

  /**
   * Starts step `index` (or waits: for you, for a slot, for a reset). `confirmed`: the person already said go (Continue),
   * or it is a verdict step that runs again, so `confirmBefore` doesn't ask twice.
   */
  private async beginStep(runId: string, index: number, options: { confirmed?: boolean }): Promise<void> {
    const run = this.deps.store.get(runId);
    if (!run || !ACTIVE_STATES.includes(run.state) || this.closed) return;
    const step = run.pipeline.steps[index];
    if (!step) {
      this.finishRun(run);
      return;
    }
    if (step.kind === 'push') {
      if (this.canAutoPush(run)) await this.pushStep(run.id, index, null, true);
      else this.holdRun(run, 'push', index, heldByLabel('push', step.name));
      return;
    }
    if (!options.confirmed && run.pipeline.confirmBefore.includes(step.name)) {
      this.holdRun(run, 'confirm', index, heldByLabel('confirm', step.name));
      return;
    }
    const hold = this.holdFor(run, index);
    if (hold) {
      this.holdRun(run, hold.heldBy, index, hold.note);
      if (hold.heldBy === 'limit' && hold.resetsAt) this.armTimer(hold.resetsAt);
      return;
    }
    await this.runStep(run, index);
  }

  /** Records that the run waits at `index` and why; says nothing when it already did. */
  private holdRun(run: PipelineRun, heldBy: HeldBy, index: number, note: string): void {
    const state = stateFor(heldBy);
    if (run.state === state && run.heldBy === heldBy && run.stepIndex === index && run.note === note) return;
    this.deps.store.update(run.id, { state, heldBy, stepIndex: index, note });
    this.emit(run.id);
    if (state === 'needs-you') this.notifyNeedsYou(this.require(run.id));
  }

  private stopRun(run: PipelineRun, heldBy: HeldBy, note: string): void {
    this.holdRun(run, heldBy, run.stepIndex, note);
  }

  private finishRun(run: PipelineRun): void {
    this.deps.store.update(run.id, { state: 'done', heldBy: null, loopTo: null, note: null });
    this.emit(run.id);
  }

  /** Runs a Claude step: the actions first, then a fresh session or a fork with the filled prompt. */
  private async runStep(run: PipelineRun, index: number): Promise<void> {
    const step = run.pipeline.steps[index];
    if (!step || step.kind !== 'claude') return;
    const rows = this.deps.store.steps(run.id);
    const row = this.deps.store.addStep({ runId: run.id, stepIndex: index, stepName: step.name, round: nextRound(rows, index), state: 'running', startedAt: this.now() });
    this.deps.store.update(run.id, { state: 'running', heldBy: null, stepIndex: index, loopTo: run.loopTo === index ? null : run.loopTo, note: null });
    this.emit(run.id);
    this.starting++;
    try {
      const actions: ActionResult[] = [];
      for (const name of step.actionsFirst ?? []) actions.push(await this.runAction(run, name));
      // You may have stopped the run while the actions ran.
      if (this.deps.store.get(run.id)?.state !== 'running' || this.deps.store.step(row.id)?.state !== 'running') return;
      const prompt = this.promptFor(run, index, rows, actions);
      let sessionId: string;
      if (step.start.kind === 'fork') {
        const source = forkSource(run.pipeline, index, rows);
        if (!source?.sessionId || !this.deps.sessionExists(source.sessionId)) throw new StepFailure(`The ${step.start.step} session is gone, so ${step.name} can’t fork it.`, 'closed');
        sessionId = await this.deps.forkAndSend({
          sessionId: source.sessionId,
          text: prompt,
          model: step.model,
          effort: step.effort,
          permissionMode: step.permissionMode ?? 'default',
          readOnly: step.readOnly === true,
        });
      } else {
        sessionId = await this.deps.createSession({ cwd: run.cwd, prompt, model: step.model, effort: step.effort, permissionMode: step.permissionMode ?? 'default', readOnly: step.readOnly === true, profileId: run.profileId });
      }
      this.deps.store.updateStep(row.id, { sessionId });
      this.deps.store.link(sessionId, run.parentSessionId ?? runRowId(run.id), run.id);
      this.deps.linked(sessionId);
      this.emit(run.id);
      const early = this.early.get(sessionId);
      if (early) {
        this.early.delete(sessionId);
        void this.locked(run.id, () => this.handleEnd(sessionId, { kind: early }));
      }
    } catch (error) {
      const failure = error instanceof StepFailure ? error : new StepFailure(`${step.name} didn’t start. ${messageOf(error)}`);
      this.deps.log('warn', `Pipelines: ${failure.message}`);
      this.deps.store.updateStep(row.id, { state: 'failed', endedAt: this.now(), note: failure.message });
      const fresh = this.deps.store.get(run.id);
      if (fresh && ACTIVE_STATES.includes(fresh.state)) this.stopRun(fresh, failure.heldBy, failure.message);
    } finally {
      this.starting--;
      if (this.starting === 0) this.early.clear();
    }
  }

  /** One of a step's actions: run it, or say why it didn't. */
  private async runAction(run: PipelineRun, name: string): Promise<ActionResult> {
    try {
      const sessionId = run.parentSessionId && this.deps.sessionExists(run.parentSessionId) ? run.parentSessionId : null;
      const result = await this.deps.runAction({ root: run.root, cwd: run.cwd, name, sessionId });
      if (result.status === 'missing') return { name, status: 'missing' };
      if (result.status === 'skipped') return { name, status: 'skipped', note: result.note };
      return { name, status: 'ran', exitCode: result.exitCode, tail: outputTail(plainText(result.output), ACTION_OUTPUT_LINES).text };
    } catch (error) {
      return { name, status: 'skipped', note: messageOf(error) };
    }
  }

  /** The prompt a step starts with: its text filled in, then a stub for each brief of an earlier step (or the parent). */
  private promptFor(run: PipelineRun, index: number, rows: readonly PipelineRunStep[], actions: readonly ActionResult[]): string {
    const step = run.pipeline.steps[index];
    if (!step || step.kind !== 'claude') return '';
    const done = rows.filter((r) => r.state === 'done' && r.stepIndex < index);
    const previous = done.sort((a, b) => b.stepIndex - a.stepIndex || b.round - a.round)[0];
    const replies: Record<string, string> = {};
    for (const r of rows.filter((x) => x.state === 'done')) replies[r.stepName] = replyOf(r);
    const text = fillStepPrompt(step, {
      task: run.task,
      blanks: run.blanks,
      previous: previous ? { name: previous.stepName, reply: replyOf(previous) } : null,
      replies,
      actions,
    });
    const stubs = briefTargets({ pipeline: run.pipeline, index, rows, parentSessionId: run.parentSessionId }).map((target) => writeStub(target.label, target.sessionId));
    return [text, ...stubs].join('\n\n');
  }

  // --- When a turn ends --------------------------------------------------------------------------------------------

  /** A turn of a session this app runs ended (`hosts.onTurnEnd`). */
  turnEnded(sessionId: string, outcome: { ok: boolean; error?: string | null; stopped?: boolean; superseded?: boolean }): void {
    if (this.closed || outcome.superseded) return;
    const kind: StepEndKind = outcome.stopped ? 'stopped' : outcome.ok ? 'clean' : 'error';
    this.dispatchEnd(sessionId, kind, outcome.error ?? null);
  }

  /** A session this app runs changed state: one that crashed or was closed mid-turn ends its step. */
  onHost(info: SessionHostInfo): void {
    if (this.closed) return;
    if (info.state === 'closed') this.dispatchEnd(info.sessionId, 'closed', null);
    else if (info.state === 'error') this.dispatchEnd(info.sessionId, 'error', info.error);
    // A session that is free again, or a limit that ended, may let a held run start.
    this.poke();
  }

  private dispatchEnd(sessionId: string, kind: StepEndKind, error: string | null): void {
    const row = this.deps.store.stepOfSession(sessionId);
    if (!row) {
      // A step that is starting hasn't written its session id yet: remember the end until it has.
      if (this.starting > 0) this.early.set(sessionId, kind);
      return;
    }
    void this.locked(row.runId, () => this.handleEnd(sessionId, { kind, error }));
  }

  private async handleEnd(sessionId: string, ended: { kind: StepEndKind; error?: string | null }): Promise<void> {
    const found = this.deps.store.stepOfSession(sessionId);
    if (!found) return;
    const current = () => {
      const run = this.deps.store.get(found.runId);
      const row = this.deps.store.step(found.id);
      // Only the run's current step goes on; one that was answered again after the run moved on changes nothing.
      return run && row && ACTIVE_STATES.includes(run.state) && row.stepIndex === run.stepIndex ? { run, row } : null;
    };
    const before = current();
    if (!before) return;
    // A step that stopped for you only goes on when you answered it and the turn ended clean; errors and closes are told once.
    if (before.row.state !== 'running' && ended.kind !== 'clean') return;
    if (before.row.state === 'done' || before.row.state === 'skipped') return;
    let reply: string | null = null;
    let plan: string | null = null;
    let need: CatchUpNeedKind = 'none';
    if (ended.kind === 'clean') {
      const turn = await this.deps.lastTurn(sessionId).catch(() => null);
      reply = turn?.reply ?? null;
      plan = turn?.plan ?? null;
      need = await this.deps.needOf(sessionId).catch(() => 'none' as const);
    }
    const now = current();
    if (!now) return;
    await this.finishStep(now.run, now.row, { kind: ended.kind, error: ended.error ?? null, need, reply }, plan);
  }

  /** A step ended: records it, then starts what comes next, waits for you, sends changes back, stops or finishes. */
  private async finishStep(run: PipelineRun, row: PipelineRunStep, end: StepEnd, turnPlan: string | null): Promise<void> {
    const rows = this.deps.store.steps(run.id);
    const plan = nextStep({ pipeline: run.pipeline, autoPush: this.canAutoPush(run), loopTo: run.loopTo, rows, ended: { index: row.stepIndex, round: row.round, end } });
    // A fork keeps the plan of the step it forked in its transcript: only a plan this step proposed is its own.
    const step = run.pipeline.steps[row.stepIndex];
    const source = step?.kind === 'claude' && step.start.kind === 'fork' ? forkSource(run.pipeline, row.stepIndex, rows) : null;
    const ownPlan = turnPlan !== null && turnPlan !== source?.plan ? turnPlan : null;
    this.deps.store.updateStep(row.id, {
      ...plan.row,
      ...(end.reply !== null ? { reply: end.reply } : {}),
      ...(ownPlan !== null ? { plan: ownPlan } : {}),
      endedAt: this.now(),
    });
    const then = plan.then;
    switch (then.kind) {
      case 'start':
        await this.beginStep(run.id, then.index, { confirmed: run.loopTo !== null });
        break;
      case 'hold':
        this.deps.store.update(run.id, { loopTo: null });
        this.holdRun(this.require(run.id), then.heldBy, then.index, heldByLabel(then.heldBy, run.pipeline.steps[then.index]?.name ?? ''));
        break;
      case 'feedback':
        await this.sendBack(run, then);
        break;
      case 'stop':
        this.stopRun(this.require(run.id), then.heldBy, then.note);
        break;
      case 'done':
        this.finishRun(run);
        break;
    }
    this.emit(run.id);
  }

  /** A verdict step wants changes: its list goes to the sub-session it names, and the verdict step runs again when that ends. */
  private async sendBack(run: PipelineRun, then: { verdictIndex: number; sendToIndex: number; list: string }): Promise<void> {
    const target = latestRow(this.deps.store.steps(run.id), then.sendToIndex);
    const verdictName = run.pipeline.steps[then.verdictIndex]!.name;
    const targetName = run.pipeline.steps[then.sendToIndex]!.name;
    if (!target?.sessionId || !this.deps.sessionExists(target.sessionId)) {
      this.stopRun(this.require(run.id), 'closed', `The ${targetName} session is gone, so ${verdictName}’s changes have nowhere to go.`);
      return;
    }
    this.deps.store.updateStep(target.id, { state: 'running', endedAt: null, note: `Changes from ${verdictName}` });
    this.deps.store.update(run.id, { state: 'running', heldBy: null, stepIndex: then.sendToIndex, loopTo: then.verdictIndex, note: null });
    this.emit(run.id);
    try {
      await this.deps.send(target.sessionId, `${verdictName} asked for changes:\n\n${then.list}`);
    } catch (error) {
      this.deps.store.updateStep(target.id, { state: 'failed', endedAt: this.now(), note: messageOf(error) });
      this.stopRun(this.require(run.id), 'error', `${targetName} couldn’t get ${verdictName}’s changes. ${messageOf(error)}`);
    }
  }

  /** Only your own pipelines push by themselves: a shared one never does, whatever the file says. */
  private canAutoPush(run: PipelineRun): boolean {
    return run.pipeline.autoPush === true && (run.pipeline.scope.kind === 'global' || run.pipeline.scope.kind === 'project');
  }

  // --- What the person does ----------------------------------------------------------------------------------------

  /** Continue: start the step that waits for confirmation, go on past a step that stopped for you, or check a step that stopped on an error. */
  async continue(runId: string): Promise<PipelineRun> {
    await this.locked(runId, async () => {
      const run = this.require(runId);
      if (!ACTIVE_STATES.includes(run.state)) throw new RpcError('INVALID', 'This run is over.');
      const rows = this.deps.store.steps(run.id);
      const row = latestRow(rows, run.stepIndex);
      switch (run.heldBy) {
        case 'confirm':
        case 'focus':
        case 'limit':
        case 'folder':
          this.deps.store.update(run.id, { state: 'running', heldBy: null, note: null });
          await this.beginStep(run.id, run.stepIndex, { confirmed: true });
          return;
        case 'trust':
          throw new RpcError('INVALID', 'Look at the pipeline’s steps, then start it.');
        case 'push':
          throw new RpcError('INVALID', 'Use Push to commit and push the run’s changes.');
        case 'reply':
        case 'verdict':
          if (!row) throw new RpcError('INVALID', 'There is nothing to go on from.');
          await this.finishStep(run, row, { kind: 'accepted', need: 'none', reply: row.reply }, null);
          return;
        case 'worktree':
          if (!this.deps.folderExists(run.cwd)) throw new RpcError('INVALID', 'The run’s folder is still gone.');
          this.deps.store.update(run.id, { state: 'running', heldBy: null, note: null });
          await this.beginStep(run.id, run.stepIndex, { confirmed: true });
          return;
        case 'error':
        case 'closed': {
          // Look at the step's last turn again: if it finished clean, the run goes on from it.
          if (!row?.sessionId || !this.deps.sessionExists(row.sessionId)) {
            this.deps.store.update(run.id, { state: 'running', heldBy: null, note: null });
            await this.runStep(this.require(run.id), run.stepIndex);
            return;
          }
          if (this.deps.busy(row.sessionId)) throw new RpcError('INVALID', `${row.stepName} is still working. Wait for it to finish.`);
          const turn = await this.deps.lastTurn(row.sessionId).catch(() => null);
          if (!turn) throw new RpcError('INVALID', `${row.stepName} hasn’t answered yet. Run it again, or skip it.`);
          const need = await this.deps.needOf(row.sessionId).catch(() => 'none' as const);
          await this.finishStep(this.require(run.id), row, { kind: 'clean', need, reply: turn.reply }, turn.plan);
          return;
        }
        default:
          throw new RpcError('INVALID', 'Nothing is waiting for you in this run.');
      }
    });
    return this.require(runId);
  }

  /** Run this step again: a new sub-session for the step the run is at. */
  async retry(runId: string): Promise<PipelineRun> {
    await this.locked(runId, async () => {
      const run = this.require(runId);
      if (!ACTIVE_STATES.includes(run.state)) throw new RpcError('INVALID', 'This run is over.');
      const step = run.pipeline.steps[run.stepIndex];
      if (!step || step.kind !== 'claude') throw new RpcError('INVALID', 'Only a step with a session can run again.');
      // What is still working in the old sub-session stops. A step that failed keeps saying so.
      for (const row of rowsOf(this.deps.store.steps(run.id), run.stepIndex)) {
        if (row.sessionId && this.deps.busy(row.sessionId)) await this.deps.interrupt(row.sessionId).catch(() => {});
        if (row.state === 'running' || row.state === 'needs-you') this.deps.store.updateStep(row.id, { state: 'stopped', endedAt: this.now(), note: 'Run again' });
      }
      this.deps.store.update(run.id, { state: 'running', heldBy: null, note: null });
      await this.beginStep(run.id, run.stepIndex, { confirmed: true });
    });
    return this.require(runId);
  }

  /** Skip this step: the run goes on as if it were done, with nothing from it. */
  async skip(runId: string): Promise<PipelineRun> {
    await this.locked(runId, async () => {
      const run = this.require(runId);
      if (!ACTIVE_STATES.includes(run.state)) throw new RpcError('INVALID', 'This run is over.');
      const step = run.pipeline.steps[run.stepIndex];
      if (!step) throw new RpcError('INVALID', 'There is no step to skip.');
      const rows = this.deps.store.steps(run.id);
      let row = latestRow(rows, run.stepIndex);
      if (!row || row.state === 'done' || row.state === 'skipped') row = this.deps.store.addStep({ runId: run.id, stepIndex: run.stepIndex, stepName: step.name, round: nextRound(rows, run.stepIndex), state: 'needs-you', startedAt: null });
      if (row.sessionId && this.deps.busy(row.sessionId)) await this.deps.interrupt(row.sessionId).catch(() => {});
      await this.finishStep(this.require(run.id), row, { kind: 'skipped', need: 'none', reply: null }, null);
    });
    return this.require(runId);
  }

  /** Stop the run: its working step is stopped, and nothing starts after it. Its sub-sessions stay. */
  async stop(runId: string): Promise<PipelineRun> {
    const run = this.require(runId);
    if (!ACTIVE_STATES.includes(run.state)) return run;
    // Not queued behind the run's work: a step that is still running its actions sees the run stopped when they end.
    this.deps.store.update(run.id, { state: 'stopped', heldBy: null, loopTo: null, note: 'You stopped the run' });
    for (const row of this.deps.store.steps(run.id)) {
      if (row.state !== 'running' && row.state !== 'needs-you') continue;
      this.deps.store.updateStep(row.id, { state: 'stopped', endedAt: this.now() });
      if (row.sessionId && this.deps.busy(row.sessionId)) await this.deps.interrupt(row.sessionId).catch(() => {});
    }
    this.emit(run.id);
    return this.require(runId);
  }

  // --- Push --------------------------------------------------------------------------------------------------------

  /** The Push card's first text: the commit message, and the pull request's title and body. */
  async pushDraft(runId: string): Promise<PipelinePushDraft> {
    const run = this.require(runId);
    return this.deps.pushDraft(run, this.deps.store.steps(run.id));
  }

  /**
   * Commits, pushes and opens the pull request with what the Push card says (`edits`), without waiting: progress
   * comes through `pushProgress` and the run changes when it is done. A failure leaves the run waiting to push.
   */
  async push(runId: string, edits: PushEdits): Promise<void> {
    const run = this.require(runId);
    const step = run.pipeline.steps[run.stepIndex];
    if (run.heldBy !== 'push' || step?.kind !== 'push') throw new RpcError('INVALID', 'This run isn’t waiting to push.');
    if (this.pushing.has(runId)) throw new RpcError('BUSY', 'This run is being pushed already.');
    this.pushing.add(runId);
    void this.pushStep(runId, run.stepIndex, edits, false).finally(() => this.pushing.delete(runId));
  }

  /** Runs the push step: `edits` null takes the draft as it is (`autoPush`). */
  private async pushStep(runId: string, index: number, edits: PushEdits | null, inLock: boolean): Promise<void> {
    const run = this.require(runId);
    const step = run.pipeline.steps[index];
    if (step?.kind !== 'push') return;
    const rows = this.deps.store.steps(run.id);
    const row = this.deps.store.addStep({ runId: run.id, stepIndex: index, stepName: step.name, round: nextRound(rows, index), state: 'running', startedAt: this.now() });
    this.deps.store.update(run.id, { stepIndex: index });
    const progress = (p: Omit<PipelinePushProgress, 'runId'>) => this.deps.pushProgress({ runId, ...p });
    try {
      // The Push card's own text when you pressed Push; the draft as it is for a pipeline that pushes by itself.
      const draft = edits ? null : await this.deps.pushDraft(run, rows);
      const plan: PushPlan = {
        commit: step.commit,
        message: (edits ? edits.commitMessage : draft?.commitMessage)?.trim() || null,
        pullRequest: step.pullRequest
          ? {
              title: (edits ? edits.prTitle : draft?.prTitle)?.trim() || prTitleFrom(run.task),
              body: (edits ? edits.prBody : draft?.prBody) ?? prBodyFrom({ task: run.task, steps: rows }),
              base: step.pullRequest.base ?? draft?.base ?? null,
              draft: step.pullRequest.draft,
            }
          : null,
      };
      const result = await this.deps.push(run, plan, (s) => progress({ step: s, pr: null, compareUrl: null, error: null }));
      this.deps.store.updateStep(row.id, { state: 'done', endedAt: this.now(), note: result.note, reply: result.pr?.url ?? result.compareUrl ?? null });
      progress({ step: 'done', pr: result.pr, compareUrl: result.compareUrl, error: null });
      // The step after it: another push waits for you again, a Claude step starts, and the last step ends the run.
      const after = async () => {
        const fresh = this.require(runId);
        const next = nextStep({ pipeline: fresh.pipeline, autoPush: this.canAutoPush(fresh), loopTo: null, rows: this.deps.store.steps(runId), ended: { index: row.stepIndex, round: row.round, end: { kind: 'clean', need: 'none', reply: null } } });
        this.deps.store.update(runId, { state: 'running', heldBy: null, note: null });
        if (next.then.kind === 'start') await this.beginStep(runId, next.then.index, {});
        else if (next.then.kind === 'hold') this.holdRun(this.require(runId), next.then.heldBy, next.then.index, heldByLabel(next.then.heldBy, fresh.pipeline.steps[next.then.index]?.name ?? ''));
        else this.finishRun(this.require(runId));
        this.emit(runId);
      };
      await (inLock ? after() : this.locked(runId, after));
    } catch (error) {
      const message = messageOf(error);
      this.deps.store.updateStep(row.id, { state: 'failed', endedAt: this.now(), note: message });
      progress({ step: 'failed', pr: null, compareUrl: null, error: message });
      // It still waits to push: fix what is wrong and press Push again.
      this.deps.store.update(runId, { state: 'needs-you', heldBy: 'push', stepIndex: index, note: message });
      this.emit(runId);
    }
  }

  // --- The parent --------------------------------------------------------------------------------------------------

  /**
   * The brief of a run for the message a parent session is about to send, when steps of its run ended since the parent
   * last had one. Marks the run as told, so the next message doesn't repeat it.
   */
  briefFor(sessionId: string): string | null {
    for (const run of this.deps.store.ofParent(sessionId)) {
      const steps = this.deps.store.steps(run.id);
      const since = run.briefSentAt ?? 0;
      if (!steps.some((s) => s.endedAt !== null && s.endedAt > since)) continue;
      this.deps.store.update(run.id, { briefSentAt: this.now() });
      return writeRunBrief(run, steps);
    }
    return null;
  }

  /** A run row got the session you wrote in it: that session is the run's parent now, and the sub-sessions move under it. */
  adoptParent(runId: string, sessionId: string): void {
    const run = this.require(runId);
    this.deps.store.update(run.id, { parentSessionId: sessionId, briefSentAt: this.now() });
    for (const id of this.deps.store.repoint(run.id, runRowId(run.id), sessionId)) this.deps.linked(id);
    this.emit(run.id);
  }

  /** The brief for the first message of a run row's session. */
  briefOfRun(runId: string): string {
    const run = this.require(runId);
    return writeRunBrief(run, this.deps.store.steps(run.id));
  }

  // --- Sessions that go away, holds and the app starting -----------------------------------------------------------

  /** Sessions were deleted: a run stops at a step whose session is gone, and when its parent is. */
  sessionsRemoved(ids: readonly string[]): void {
    if (this.closed) return;
    for (const id of ids) {
      const row = this.deps.store.stepOfSession(id);
      if (row) {
        void this.locked(row.runId, async () => {
          const run = this.deps.store.get(row.runId);
          const current = this.deps.store.step(row.id);
          if (!run || !current || !ACTIVE_STATES.includes(run.state)) return;
          if (current.state === 'running' || current.state === 'needs-you') {
            this.deps.store.updateStep(current.id, { state: 'stopped', endedAt: this.now(), note: 'The session was deleted' });
            if (current.stepIndex === run.stepIndex) this.stopRun(run, 'closed', `The ${current.stepName} session was deleted`);
          }
        });
      }
      for (const run of this.deps.store.ofParent(id)) {
        if (!ACTIVE_STATES.includes(run.state)) continue;
        void this.locked(run.id, async () => {
          const fresh = this.deps.store.get(run.id);
          if (!fresh || !ACTIVE_STATES.includes(fresh.state)) return;
          for (const step of this.deps.store.steps(run.id)) {
            if (step.state !== 'running') continue;
            if (step.sessionId && this.deps.busy(step.sessionId)) await this.deps.interrupt(step.sessionId).catch(() => {});
            this.deps.store.updateStep(step.id, { state: 'stopped', endedAt: this.now() });
          }
          this.deps.store.update(run.id, { state: 'stopped', heldBy: null, note: 'The session the run started from was deleted' });
          this.emit(run.id);
        });
      }
    }
  }

  /**
   * Looks at the runs that wait for a slot, a reset or a folder and starts what may start. Call it whenever a session's
   * state, a usage limit or the focus limit changes. Calls made while it runs fold into one more run.
   */
  check(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.checking) {
      this.again = true;
      return this.checking;
    }
    this.checking = (async () => {
      try {
        do {
          this.again = false;
          await this.pass();
        } while (this.again && !this.closed);
      } finally {
        this.checking = null;
      }
    })();
    return this.checking;
  }

  /** Same as `check`, for callers that don't wait. */
  poke(): void {
    void this.check();
  }

  private async pass(): Promise<void> {
    // This runs on every change of every session: most of the time nothing waits.
    if (!this.deps.store.hasWaiting()) return;
    for (const run of this.deps.store.active()) {
      // A folder that went away while the run waited stops it, like a schedule whose folder is gone.
      const waiting = run.state === 'held' || (run.state === 'needs-you' && (run.heldBy === 'confirm' || run.heldBy === 'push'));
      if (waiting && this.workspaceReady(run) && !this.deps.folderExists(run.cwd)) {
        await this.locked(run.id, async () => {
          const fresh = this.deps.store.get(run.id);
          if (fresh && ACTIVE_STATES.includes(fresh.state)) this.stopRun(fresh, 'worktree', heldByLabel('worktree', ''));
        });
        continue;
      }
      if (run.state !== 'held') continue;
      await this.locked(run.id, async () => {
        const fresh = this.deps.store.get(run.id);
        if (fresh?.state !== 'held') return;
        await this.beginStep(run.id, fresh.stepIndex, { confirmed: true });
      });
    }
  }

  private armTimer(resetsAt: number): void {
    clearTimeout(this.timer);
    if (this.closed) return;
    // A reset days away is looked at again then; setTimeout can not wait longer than about 24 days.
    this.timer = setTimeout(() => this.poke(), Math.min(2_000_000_000, Math.max(1_000, resetsAt - this.now() + 1_000)));
    this.timer.unref?.();
  }

  /**
   * The engine started: a run whose step was working when the app quit goes to Needs you (its turn's end was not seen),
   * with Continue to look at that turn again. Runs that wait for a slot or a reset start looking again.
   */
  resume(): void {
    for (const run of this.deps.store.active()) {
      if (run.state !== 'running') continue;
      const row = latestRow(this.deps.store.steps(run.id), run.stepIndex);
      if (row && row.state === 'running') this.deps.store.updateStep(row.id, { state: 'stopped', endedAt: this.now(), note: 'Switchboard was closed during this step' });
      this.deps.store.update(run.id, { state: 'needs-you', heldBy: 'closed', note: 'Switchboard was closed during this step' });
      this.emit(run.id);
    }
    this.poke();
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
  }

  // --- Plumbing ----------------------------------------------------------------------------------------------------

  private notifyNeedsYou(run: PipelineRun): void {
    const step = run.pipeline.steps[run.stepIndex];
    this.deps.notify({
      runId: run.id,
      parentId: run.parentSessionId ?? runRowId(run.id),
      title: lastLine(run.task) || run.pipeline.name,
      step: step?.name ?? run.pipeline.name,
      reason: run.note ?? (run.heldBy ? heldByLabel(run.heldBy, step?.name ?? '') : 'Needs you'),
    });
  }

  /** Runs `work` after what is already queued for the run, so a run's events never overlap. */
  private locked<T>(runId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(runId) ?? Promise.resolve();
    const next = previous.then(work, work);
    const tail = next.catch(() => undefined);
    this.chains.set(runId, tail);
    void tail.then(() => {
      if (this.chains.get(runId) === tail) this.chains.delete(runId);
    });
    return next;
  }
}
