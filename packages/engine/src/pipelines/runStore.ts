import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ImageAttachment, Pipeline, StepActionResult, StepVerdict, type PipelineRun, type PipelineRunState, type PipelineRunStatus, type PipelineRunStep, type PipelineStepStatus, type PipelineWait, type SessionOutcome } from '@seshboard/protocol';
import { z } from 'zod';

interface RunRow {
  id: string;
  pipeline_id: string;
  pipeline_json: string;
  parent_session_id: string | null;
  task: string | null;
  title: string;
  project_root: string;
  cwd: string;
  profile_id: string | null;
  status: string;
  reason: string | null;
  waiting_for: string | null;
  step: number;
  round: number;
  sent_back_to: number | null;
  pr_json: string | null;
  created_at: number;
  updated_at: number;
  ended_at: number | null;
  archived_at: number | null;
  restored_at: number | null;
  unattended: number;
}

interface StepRow {
  run_id: string;
  idx: number;
  round: number;
  step: string;
  session_id: string | null;
  status: string;
  outcome: string | null;
  verdict_json: string | null;
  reason: string | null;
  plan: string | null;
  actions_json: string | null;
  started_at: number;
  ended_at: number | null;
}

/** The prefix of a run's id: a run row's sub-sessions have it as their parent, which tells it apart from a session. */
export const RUN_ID_PREFIX = 'run-';
export const isRunId = (id: string | null | undefined): id is string => !!id?.startsWith(RUN_ID_PREFIX);

/** What a new run starts with. `context`: a triggered run's event text, for its first step (`context`). */
export type NewRun = Pick<PipelineRun, 'pipeline' | 'parentSessionId' | 'task' | 'title' | 'projectRoot' | 'cwd' | 'profileId'> & { attachments?: ImageAttachment[]; context?: string | null; unattended?: boolean };

const json = <T>(text: string | null, schema: z.ZodType<T>, fallback: T): T => {
  if (!text) return fallback;
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
};

const Pr = z.object({ number: z.number().int(), url: z.string() }).nullable();
const Actions = z.array(StepActionResult);

/**
 * Pipeline runs (#179): `pipeline_runs`, a row per round of a step in `pipeline_run_steps`, and the parent of each
 * sub-session in `session_parents`. User data like the pipelines: a run must outlive a cache rebuild and a restart, so
 * it can go on where it stopped.
 */
export class RunStore {
  private readonly statements;
  /** Each sub-session's parent, read once: the session index asks for every session it sends. */
  private parents: Map<string, string> | null = null;

  constructor(
    db: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {
    this.statements = {
      runs: db.prepare('SELECT * FROM pipeline_runs ORDER BY created_at, rowid'),
      run: db.prepare('SELECT * FROM pipeline_runs WHERE id = ?'),
      insertRun: db.prepare(`
        INSERT INTO pipeline_runs (id, pipeline_id, pipeline_json, parent_session_id, task, title, project_root, cwd, profile_id, status, reason, waiting_for, step, round, sent_back_to, pr_json, created_at, updated_at, ended_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', NULL, NULL, 0, 1, NULL, NULL, ?, ?, NULL)`),
      updateRun: db.prepare(`
        UPDATE pipeline_runs SET parent_session_id = ?, cwd = ?, status = ?, reason = ?, waiting_for = ?, step = ?, round = ?, sent_back_to = ?, pr_json = ?, updated_at = ?, ended_at = ? WHERE id = ?`),
      restoreRun: db.prepare(`
        INSERT OR REPLACE INTO pipeline_runs (id, pipeline_id, pipeline_json, parent_session_id, task, title, project_root, cwd, profile_id, status, reason, waiting_for, step, round, sent_back_to, pr_json, created_at, updated_at, ended_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      removeRun: db.prepare('DELETE FROM pipeline_runs WHERE id = ?'),
      setAttachments: db.prepare('UPDATE pipeline_runs SET attachments_json = ? WHERE id = ?'),
      attachments: db.prepare('SELECT attachments_json FROM pipeline_runs WHERE id = ?'),
      setContext: db.prepare('UPDATE pipeline_runs SET context = ? WHERE id = ?'),
      setUnattended: db.prepare('UPDATE pipeline_runs SET unattended = ? WHERE id = ?'),
      context: db.prepare('SELECT context FROM pipeline_runs WHERE id = ?'),
      archiveRun: db.prepare('UPDATE pipeline_runs SET archived_at = ?, restored_at = ? WHERE id = ?'),
      steps: db.prepare('SELECT * FROM pipeline_run_steps WHERE run_id = ? ORDER BY idx, round'),
      stepBySession: db.prepare('SELECT * FROM pipeline_run_steps WHERE session_id = ? ORDER BY started_at DESC LIMIT 1'),
      upsertStep: db.prepare(`
        INSERT INTO pipeline_run_steps (run_id, idx, round, step, session_id, status, outcome, verdict_json, reason, plan, actions_json, started_at, ended_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (run_id, idx, round) DO UPDATE SET step = excluded.step, session_id = excluded.session_id, status = excluded.status,
          outcome = excluded.outcome, verdict_json = excluded.verdict_json, reason = excluded.reason, plan = excluded.plan,
          actions_json = excluded.actions_json, started_at = excluded.started_at, ended_at = excluded.ended_at`),
      removeSteps: db.prepare('DELETE FROM pipeline_run_steps WHERE run_id = ?'),
      parents: db.prepare('SELECT session_id, parent_id FROM session_parents'),
      setParent: db.prepare('INSERT INTO session_parents (session_id, parent_id, run_id) VALUES (?, ?, ?) ON CONFLICT (session_id) DO UPDATE SET parent_id = excluded.parent_id, run_id = excluded.run_id'),
      reparent: db.prepare('UPDATE session_parents SET parent_id = ? WHERE parent_id = ?'),
      removeParents: db.prepare('DELETE FROM session_parents WHERE run_id = ?'),
    };
  }

  create(input: NewRun): PipelineRun {
    const id = `${RUN_ID_PREFIX}${randomUUID()}`;
    const now = this.now();
    this.statements.insertRun.run(id, input.pipeline.id, JSON.stringify(input.pipeline), input.parentSessionId, input.task, input.title, input.projectRoot, input.cwd, input.profileId, now, now);
    if (input.attachments?.length) this.statements.setAttachments.run(JSON.stringify(input.attachments), id);
    if (input.context) this.statements.setContext.run(input.context, id);
    if (input.unattended) this.statements.setUnattended.run(1, id);
    return this.get(id)!;
  }

  /**
   * What a triggered run's first step reads about its event (an issue, a failed log), as a block that says it is
   * context, not instructions. Kept apart from the task, so later steps' briefs and the pull request don't carry it.
   */
  context(id: string): string | null {
    const row = this.statements.context.get(id) as unknown as { context: string | null } | undefined;
    return row?.context ?? null;
  }

  /** The images sent with the run's task (not part of the run's state: they are large). */
  attachments(id: string): ImageAttachment[] {
    const row = this.statements.attachments.get(id) as unknown as { attachments_json: string | null } | undefined;
    return json(row?.attachments_json ?? null, z.array(ImageAttachment), []);
  }

  get(id: string): PipelineRun | null {
    const row = this.statements.run.get(id) as unknown as RunRow | undefined;
    return row ? toRun(row) : null;
  }

  list(): PipelineRun[] {
    return (this.statements.runs.all() as unknown as RunRow[]).flatMap((row) => {
      const run = toRun(row);
      return run ? [run] : [];
    });
  }

  /** Every run with its steps, as the windows get them. */
  states(): PipelineRunState[] {
    return this.list().map((run) => ({ run, steps: this.steps(run.id) }));
  }

  state(id: string): PipelineRunState | null {
    const run = this.get(id);
    return run ? { run, steps: this.steps(id) } : null;
  }

  /** Changes a run. Ending it (`done` or `stopped`) sets when; going on clears that. */
  update(id: string, change: Partial<Pick<PipelineRun, 'parentSessionId' | 'cwd' | 'status' | 'reason' | 'waitingFor' | 'step' | 'round' | 'sentBackTo' | 'pr'>>): PipelineRun | null {
    const before = this.get(id);
    if (!before) return null;
    const next = { ...before, ...change };
    const ended = next.status === 'done' || next.status === 'stopped';
    const endedAt = ended ? (before.endedAt ?? this.now()) : null;
    this.statements.updateRun.run(next.parentSessionId, next.cwd, next.status, next.reason, next.waitingFor, next.step, next.round, next.sentBackTo, next.pr ? JSON.stringify(next.pr) : null, this.now(), endedAt, id);
    if (change.parentSessionId !== undefined && change.parentSessionId !== before.parentSessionId && change.parentSessionId) {
      // A run row got a session of its own: its sub-sessions go under that session.
      this.statements.reparent.run(change.parentSessionId, id);
      this.parents = null;
    }
    return this.get(id);
  }

  /**
   * Writes a run and its step rows as given, and puts each step's session under the run's parent: the screenshot
   * tour's demo runs (`DemoUsage.pipelinesFile`), which never ran here.
   */
  restore(state: PipelineRunState): PipelineRunState | null {
    const { run } = state;
    this.remove(run.id);
    this.statements.restoreRun.run(run.id, run.pipelineId, JSON.stringify(run.pipeline), run.parentSessionId, run.task, run.title, run.projectRoot, run.cwd, run.profileId, run.status, run.reason, run.waitingFor, run.step, run.round, run.sentBackTo, run.pr ? JSON.stringify(run.pr) : null, run.createdAt, run.updatedAt, run.endedAt);
    if (run.unattended) this.statements.setUnattended.run(1, run.id);
    for (const step of state.steps) {
      this.saveStep({ ...step, runId: run.id });
      if (step.sessionId) this.setParent(step.sessionId, run.parentSessionId ?? run.id, run.id);
    }
    return this.state(run.id);
  }

  /** Archives a run row by hand, or unarchives it (it then stays up until it has new activity). */
  setArchived(id: string, archived: boolean): PipelineRun | null {
    const now = this.now();
    this.statements.archiveRun.run(archived ? now : null, archived ? null : now, id);
    return this.get(id);
  }

  remove(id: string): void {
    this.statements.removeRun.run(id);
    this.statements.removeSteps.run(id);
    this.statements.removeParents.run(id);
    this.parents = null;
  }

  steps(runId: string): PipelineRunStep[] {
    return (this.statements.steps.all(runId) as unknown as StepRow[]).map(toStep);
  }

  /** The latest round of a step. */
  latest(runId: string, index: number): PipelineRunStep | null {
    return this.steps(runId).filter((s) => s.index === index).at(-1) ?? null;
  }

  /** The step a sub-session is, with its run. */
  stepOf(sessionId: string): PipelineRunStep | null {
    const row = this.statements.stepBySession.get(sessionId) as unknown as StepRow | undefined;
    return row ? toStep(row) : null;
  }

  /** Writes a round of a step, as a whole. */
  saveStep(step: PipelineRunStep): PipelineRunStep {
    this.statements.upsertStep.run(
      step.runId,
      step.index,
      step.round,
      step.step,
      step.sessionId,
      step.status,
      step.outcome,
      step.verdict ? JSON.stringify(step.verdict) : null,
      step.reason,
      step.plan,
      step.actions.length ? JSON.stringify(step.actions) : null,
      step.startedAt,
      step.endedAt,
    );
    return step;
  }

  /** Changes a round of a step that exists; null when it doesn't. */
  updateStep(runId: string, index: number, round: number, change: Partial<Omit<PipelineRunStep, 'runId' | 'index' | 'round'>>): PipelineRunStep | null {
    const before = this.steps(runId).find((s) => s.index === index && s.round === round);
    return before ? this.saveStep({ ...before, ...change }) : null;
  }

  /** Starts a round of a step: a new row, `working`. */
  startStep(runId: string, index: number, round: number, name: string, change: Partial<PipelineRunStep> = {}): PipelineRunStep {
    return this.saveStep({ runId, index, round, step: name, sessionId: null, status: 'working', outcome: null, verdict: null, reason: null, plan: null, actions: [], startedAt: this.now(), endedAt: null, ...change });
  }

  /** The approved plan of a session that was a step in plan mode (a brief's `plan`). */
  planOf(sessionId: string): string | null {
    return this.stepOf(sessionId)?.plan ?? null;
  }

  /** Puts a sub-session under its parent (a session, or a run row's id). */
  setParent(sessionId: string, parentId: string, runId: string | null): void {
    this.statements.setParent.run(sessionId, parentId, runId);
    this.parents = null;
  }

  parentOf(sessionId: string): string | null {
    return this.parentMap().get(sessionId) ?? null;
  }

  /** The sessions under a parent. */
  childrenOf(parentId: string): string[] {
    return [...this.parentMap()].filter(([, parent]) => parent === parentId).map(([id]) => id);
  }

  private parentMap(): Map<string, string> {
    this.parents ??= new Map((this.statements.parents.all() as Array<{ session_id: string; parent_id: string }>).map((r) => [r.session_id, r.parent_id]));
    return this.parents;
  }
}

const RUN_STATUSES: readonly PipelineRunStatus[] = ['running', 'waiting', 'stopped', 'paused', 'done'];
const WAITS: readonly PipelineWait[] = ['you', 'confirm', 'push'];
const STEP_STATUSES: readonly PipelineStepStatus[] = ['working', 'waiting', 'done', 'failed', 'skipped', 'stopped'];
const OUTCOMES: readonly SessionOutcome[] = ['clean', 'error', 'stopped', 'quit'];

function toRun(row: RunRow): PipelineRun | null {
  const pipeline = json(row.pipeline_json, Pipeline, null);
  if (!pipeline) return null;
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    pipeline,
    parentSessionId: row.parent_session_id,
    task: row.task,
    title: row.title,
    projectRoot: row.project_root,
    cwd: row.cwd,
    profileId: row.profile_id,
    status: RUN_STATUSES.includes(row.status as PipelineRunStatus) ? (row.status as PipelineRunStatus) : 'stopped',
    reason: row.reason,
    waitingFor: WAITS.includes(row.waiting_for as PipelineWait) ? (row.waiting_for as PipelineWait) : null,
    // Not kept: the runner works out holds again after a restart.
    hold: null,
    step: row.step,
    round: row.round,
    sentBackTo: row.sent_back_to,
    unattended: row.unattended === 1,
    pr: json(row.pr_json, Pr, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at,
    archivedAt: row.archived_at ?? null,
    restoredAt: row.restored_at ?? null,
  };
}

function toStep(row: StepRow): PipelineRunStep {
  return {
    runId: row.run_id,
    step: row.step,
    index: row.idx,
    round: row.round,
    sessionId: row.session_id,
    status: STEP_STATUSES.includes(row.status as PipelineStepStatus) ? (row.status as PipelineStepStatus) : 'stopped',
    outcome: OUTCOMES.includes(row.outcome as SessionOutcome) ? (row.outcome as SessionOutcome) : null,
    verdict: json(row.verdict_json, StepVerdict.nullable(), null),
    reason: row.reason,
    plan: row.plan,
    actions: json(row.actions_json, Actions, []),
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}
