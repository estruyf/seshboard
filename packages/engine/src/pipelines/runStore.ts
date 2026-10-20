import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Pipeline, PipelineRun, PipelineRunStep, type HeldBy, type RunState, type StepState, type Verdict } from '@switchboard/protocol';

interface RunRow {
  id: string;
  pipeline_id: string;
  pipeline_json: string;
  parent_session_id: string | null;
  root: string;
  cwd: string;
  task: string;
  blanks_json: string;
  profile_id: string | null;
  state: string;
  held_by: string | null;
  step_index: number;
  loop_to: number | null;
  note: string | null;
  brief_sent_at: number | null;
  created_at: number;
  updated_at: number;
}

interface StepRow {
  id: string;
  run_id: string;
  step_index: number;
  step_name: string;
  round: number;
  session_id: string | null;
  state: string;
  verdict: string | null;
  verdict_text: string | null;
  reply: string | null;
  plan: string | null;
  started_at: number | null;
  ended_at: number | null;
  note: string | null;
}

/** What a new run starts with. */
export interface NewRun {
  pipeline: Pipeline;
  parentSessionId: string | null;
  root: string;
  cwd: string;
  task: string;
  blanks: Record<string, string>;
  profileId: string | null;
  state: RunState;
  heldBy: HeldBy | null;
  note?: string | null;
}

/** What `update` can change on a run. */
export interface RunPatch {
  state?: RunState;
  heldBy?: HeldBy | null;
  stepIndex?: number;
  loopTo?: number | null;
  note?: string | null;
  briefSentAt?: number | null;
  parentSessionId?: string | null;
  cwd?: string;
}

/** What `updateStep` can change on a step's row. */
export interface StepPatch {
  sessionId?: string | null;
  state?: StepState;
  verdict?: Verdict | null;
  verdictText?: string | null;
  reply?: string | null;
  plan?: string | null;
  startedAt?: number | null;
  endedAt?: number | null;
  note?: string | null;
}

const RUN_COLUMNS: Record<keyof RunPatch, string> = {
  state: 'state',
  heldBy: 'held_by',
  stepIndex: 'step_index',
  loopTo: 'loop_to',
  note: 'note',
  briefSentAt: 'brief_sent_at',
  parentSessionId: 'parent_session_id',
  cwd: 'cwd',
};

const STEP_COLUMNS: Record<keyof StepPatch, string> = {
  sessionId: 'session_id',
  state: 'state',
  verdict: 'verdict',
  verdictText: 'verdict_text',
  reply: 'reply',
  plan: 'plan',
  startedAt: 'started_at',
  endedAt: 'ended_at',
  note: 'note',
};

/** Runs that are not over: a pipeline is working, waiting for a slot or a reset, or waiting for you. */
export const ACTIVE_STATES: readonly RunState[] = ['running', 'held', 'needs-you'];

/** Runs that ended are kept this long, so the sidebar and the parents' transcripts can still show them. */
const KEEP_FINISHED_MS = 90 * 24 * 3_600_000;

/**
 * Pipeline runs (#179): the run with a snapshot of its pipeline, a row per step (and round), the tree of sub-sessions
 * (`session_parents`, kept apart from the sessions cache, which can be dropped) and which version of each shared
 * pipeline you trusted. Prepared statements in the constructor, like the other stores.
 */
export class PipelineRunStore {
  private readonly statements;
  /** `session_parents` in memory: the session index asks for a parent each time it sends a session. */
  private readonly parents = new Map<string, string>();

  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {
    this.statements = {
      insertRun: db.prepare(
        `INSERT INTO pipeline_runs (id, pipeline_id, pipeline_json, parent_session_id, root, cwd, task, blanks_json, profile_id, state, held_by, step_index, loop_to, note, brief_sent_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, NULL, ?, ?)`,
      ),
      getRun: db.prepare('SELECT * FROM pipeline_runs WHERE id = ?'),
      allRuns: db.prepare('SELECT * FROM pipeline_runs ORDER BY created_at, id'),
      removeRun: db.prepare('DELETE FROM pipeline_runs WHERE id = ?'),
      byParent: db.prepare('SELECT * FROM pipeline_runs WHERE parent_session_id = ? ORDER BY created_at DESC, id DESC'),
      waiting: db.prepare("SELECT COUNT(*) AS n FROM pipeline_runs WHERE state = 'held' OR (state = 'needs-you' AND held_by IN ('confirm', 'push'))"),
      insertStep: db.prepare(
        `INSERT INTO pipeline_run_steps (id, run_id, step_index, step_name, round, session_id, state, verdict, verdict_text, reply, plan, started_at, ended_at, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, NULL, ?)`,
      ),
      stepsOf: db.prepare('SELECT * FROM pipeline_run_steps WHERE run_id = ? ORDER BY step_index, round'),
      allSteps: db.prepare('SELECT * FROM pipeline_run_steps ORDER BY run_id, step_index, round'),
      getStep: db.prepare('SELECT * FROM pipeline_run_steps WHERE id = ?'),
      stepBySession: db.prepare('SELECT * FROM pipeline_run_steps WHERE session_id = ? ORDER BY started_at DESC LIMIT 1'),
      removeSteps: db.prepare('DELETE FROM pipeline_run_steps WHERE run_id = ?'),
      allParents: db.prepare('SELECT session_id, parent_id FROM session_parents'),
      linkParent: db.prepare('INSERT INTO session_parents (session_id, parent_id, run_id) VALUES (?, ?, ?) ON CONFLICT (session_id) DO UPDATE SET parent_id = excluded.parent_id, run_id = excluded.run_id'),
      unlinkParent: db.prepare('DELETE FROM session_parents WHERE session_id = ?'),
      childrenOfRun: db.prepare('SELECT session_id FROM session_parents WHERE run_id = ?'),
      repoint: db.prepare('UPDATE session_parents SET parent_id = ? WHERE run_id = ? AND parent_id = ?'),
      removeParents: db.prepare('DELETE FROM session_parents WHERE run_id = ?'),
      trusted: db.prepare('SELECT hash FROM shared_pipeline_trust WHERE root = ? AND name = ?'),
      trust: db.prepare('INSERT INTO shared_pipeline_trust (root, name, hash) VALUES (?, ?, ?) ON CONFLICT (root, name) DO UPDATE SET hash = excluded.hash'),
    };
    for (const row of this.statements.allParents.all() as Array<{ session_id: string; parent_id: string }>) this.parents.set(row.session_id, row.parent_id);
    this.prune();
  }

  // --- Runs --------------------------------------------------------------------------------------------------------

  create(input: NewRun): PipelineRun {
    const id = randomUUID();
    const at = this.now();
    this.statements.insertRun.run(
      id,
      input.pipeline.id,
      JSON.stringify(input.pipeline),
      input.parentSessionId,
      input.root,
      input.cwd,
      input.task,
      JSON.stringify(input.blanks),
      input.profileId,
      input.state,
      input.heldBy,
      input.note ?? null,
      at,
      at,
    );
    return this.get(id)!;
  }

  get(id: string): PipelineRun | null {
    const row = this.statements.getRun.get(id) as RunRow | undefined;
    return row ? this.toRun(row) : null;
  }

  /** Every run, oldest first. A run whose snapshot no longer reads is left out. */
  list(): PipelineRun[] {
    return (this.statements.allRuns.all() as unknown as RunRow[]).flatMap((row) => {
      const run = this.toRun(row);
      return run ? [run] : [];
    });
  }

  /** The runs that are not over. */
  active(): PipelineRun[] {
    return this.list().filter((run) => ACTIVE_STATES.includes(run.state));
  }

  /** Runs started from this session, newest first. */
  ofParent(sessionId: string): PipelineRun[] {
    return (this.statements.byParent.all(sessionId) as unknown as RunRow[]).flatMap((row) => {
      const run = this.toRun(row);
      return run ? [run] : [];
    });
  }

  /** Whether any run waits for a slot, a reset or a folder, or to be confirmed or pushed: the ones a look at the folder can change. */
  hasWaiting(): boolean {
    return ((this.statements.waiting.get() as { n: number }).n ?? 0) > 0;
  }

  update(id: string, patch: RunPatch): PipelineRun | null {
    const keys = (Object.keys(patch) as Array<keyof RunPatch>).filter((key) => patch[key] !== undefined);
    if (keys.length > 0) {
      const sets = keys.map((key) => `${RUN_COLUMNS[key]} = ?`);
      const values = keys.map((key) => patch[key] ?? null);
      this.db.prepare(`UPDATE pipeline_runs SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...(values as Array<string | number | null>), this.now(), id);
    }
    return this.get(id);
  }

  /** Takes a run, its steps and its tree links out. */
  remove(id: string): void {
    for (const row of this.statements.childrenOfRun.all(id) as Array<{ session_id: string }>) this.parents.delete(row.session_id);
    this.statements.removeParents.run(id);
    this.statements.removeSteps.run(id);
    this.statements.removeRun.run(id);
  }

  /** Forgets runs that ended long ago. */
  prune(): void {
    const cutoff = this.now() - KEEP_FINISHED_MS;
    for (const run of this.list()) if (!ACTIVE_STATES.includes(run.state) && run.updatedAt < cutoff) this.remove(run.id);
  }

  // --- Steps -------------------------------------------------------------------------------------------------------

  addStep(input: { runId: string; stepIndex: number; stepName: string; round: number; sessionId?: string | null; state: StepState; startedAt?: number | null; note?: string | null }): PipelineRunStep {
    const id = randomUUID();
    this.statements.insertStep.run(id, input.runId, input.stepIndex, input.stepName, input.round, input.sessionId ?? null, input.state, input.startedAt === undefined ? this.now() : input.startedAt, input.note ?? null);
    return this.step(id)!;
  }

  step(id: string): PipelineRunStep | null {
    const row = this.statements.getStep.get(id) as StepRow | undefined;
    return row ? toStep(row) : null;
  }

  steps(runId: string): PipelineRunStep[] {
    return (this.statements.stepsOf.all(runId) as unknown as StepRow[]).map(toStep);
  }

  /** Every run's steps at once, by run id. */
  allSteps(): Map<string, PipelineRunStep[]> {
    const out = new Map<string, PipelineRunStep[]>();
    for (const row of this.statements.allSteps.all() as unknown as StepRow[]) {
      const list = out.get(row.run_id) ?? [];
      list.push(toStep(row));
      out.set(row.run_id, list);
    }
    return out;
  }

  /** The step a session is the sub-session of, or null. */
  stepOfSession(sessionId: string): PipelineRunStep | null {
    const row = this.statements.stepBySession.get(sessionId) as StepRow | undefined;
    return row ? toStep(row) : null;
  }

  updateStep(id: string, patch: StepPatch): PipelineRunStep | null {
    const keys = (Object.keys(patch) as Array<keyof StepPatch>).filter((key) => patch[key] !== undefined);
    if (keys.length > 0) {
      const sets = keys.map((key) => `${STEP_COLUMNS[key]} = ?`);
      const values = keys.map((key) => patch[key] ?? null);
      this.db.prepare(`UPDATE pipeline_run_steps SET ${sets.join(', ')} WHERE id = ?`).run(...(values as Array<string | number | null>), id);
    }
    return this.step(id);
  }

  // --- The tree ----------------------------------------------------------------------------------------------------

  /** Makes a session a sub-session: its parent is a session id, or `run:<runId>`. */
  link(sessionId: string, parentId: string, runId: string): void {
    this.statements.linkParent.run(sessionId, parentId, runId);
    this.parents.set(sessionId, parentId);
  }

  unlink(sessionId: string): void {
    this.statements.unlinkParent.run(sessionId);
    this.parents.delete(sessionId);
  }

  /** The parent of a session, if it is a sub-session. */
  parentOf(sessionId: string): string | undefined {
    return this.parents.get(sessionId);
  }

  /** The sub-sessions of a run. */
  childrenOfRun(runId: string): string[] {
    return (this.statements.childrenOfRun.all(runId) as Array<{ session_id: string }>).map((row) => row.session_id);
  }

  /** A run row got a session of its own: its children move under it. Returns them. */
  repoint(runId: string, from: string, to: string): string[] {
    const children = this.childrenOfRun(runId).filter((id) => this.parents.get(id) === from);
    this.statements.repoint.run(to, runId, from);
    for (const id of children) this.parents.set(id, to);
    return children;
  }

  // --- Shared pipelines you trusted --------------------------------------------------------------------------------

  isTrusted(root: string, pipelineId: string, hash: string): boolean {
    return (this.statements.trusted.get(root, pipelineId) as { hash: string } | undefined)?.hash === hash;
  }

  trust(root: string, pipelineId: string, hash: string): void {
    this.statements.trust.run(root, pipelineId, hash);
  }

  private toRun(row: RunRow): PipelineRun | null {
    let snapshot: unknown;
    let blanks: unknown;
    try {
      snapshot = JSON.parse(row.pipeline_json);
      blanks = JSON.parse(row.blanks_json);
    } catch {
      return null;
    }
    const parsed = PipelineRun.safeParse({
      id: row.id,
      pipelineId: row.pipeline_id,
      pipeline: Pipeline.safeParse(snapshot).data,
      parentSessionId: row.parent_session_id,
      root: row.root,
      cwd: row.cwd,
      task: row.task,
      blanks,
      profileId: row.profile_id,
      state: row.state,
      heldBy: row.held_by,
      stepIndex: row.step_index,
      loopTo: row.loop_to,
      note: row.note,
      briefSentAt: row.brief_sent_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
    return parsed.success ? parsed.data : null;
  }
}

function toStep(row: StepRow): PipelineRunStep {
  return PipelineRunStep.parse({
    id: row.id,
    runId: row.run_id,
    stepIndex: row.step_index,
    stepName: row.step_name,
    round: row.round,
    sessionId: row.session_id,
    state: row.state,
    verdict: row.verdict,
    verdictText: row.verdict_text,
    reply: row.reply,
    plan: row.plan,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    note: row.note,
  });
}
