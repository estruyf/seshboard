import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { LaterDraft, Schedule, SCHEDULE_HISTORY, SCHEDULE_SKIPS, ScheduleLastRun, ScheduleMissedSchema, ScheduleRuleSchema, ScheduleSave, type ScheduleSession } from '@seshboard/protocol';

interface Row {
  id: string;
  name: string;
  draft_json: string;
  rule_json: string;
  missed: string;
  paused: number;
  paused_reason: string | null;
  last_run_json: string | null;
  runs_json: string | null;
  skipped_runs_json: string | null;
  checked_at: number;
  created_at: number;
  updated_at: number;
}

/** A schedule, and the moment up to which its runs were dealt with. */
export interface StoredSchedule {
  schedule: Schedule;
  checkedAt: number;
}

/**
 * Scheduled sessions (#173), kept in `schedules`, a user choice, so they survive a cache rebuild. The draft is stored as
 * a queued item's is (`LaterDraft`, images included), the rule and the last run as JSON. `checked_at` is internal: runs
 * due after it and before now are the ones still to deal with.
 */
export class ScheduleStore {
  private readonly statements;

  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {
    this.statements = {
      all: db.prepare('SELECT * FROM schedules ORDER BY created_at, rowid'),
      one: db.prepare('SELECT * FROM schedules WHERE id = ?'),
      upsert: db.prepare(`
        INSERT INTO schedules (id, name, draft_json, rule_json, missed, paused, paused_reason, last_run_json, runs_json, skipped_runs_json, checked_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET name = excluded.name, draft_json = excluded.draft_json, rule_json = excluded.rule_json,
          missed = excluded.missed, paused = excluded.paused, paused_reason = excluded.paused_reason, last_run_json = excluded.last_run_json,
          runs_json = excluded.runs_json, skipped_runs_json = excluded.skipped_runs_json, checked_at = excluded.checked_at, created_at = excluded.created_at, updated_at = excluded.updated_at`),
      setPaused: db.prepare('UPDATE schedules SET paused = ?, paused_reason = ?, checked_at = ?, updated_at = ? WHERE id = ?'),
      setLastRun: db.prepare('UPDATE schedules SET last_run_json = ?, runs_json = ? WHERE id = ?'),
      setSkipped: db.prepare('UPDATE schedules SET skipped_runs_json = ? WHERE id = ?'),
      setChecked: db.prepare('UPDATE schedules SET checked_at = ? WHERE id = ?'),
      remove: db.prepare('DELETE FROM schedules WHERE id = ?'),
      runs: db.prepare('SELECT session_id, schedule_id FROM schedule_runs'),
      addRun: db.prepare('INSERT INTO schedule_runs (session_id, schedule_id, at) VALUES (?, ?, ?) ON CONFLICT (session_id) DO NOTHING'),
    };
  }

  list(): Schedule[] {
    return this.stored().map((s) => s.schedule);
  }

  /** Every schedule with the moment its runs were dealt with up to. */
  stored(): StoredSchedule[] {
    return (this.statements.all.all() as unknown as Row[]).flatMap((row) => {
      const stored = toStored(row);
      return stored ? [stored] : [];
    });
  }

  get(id: string): Schedule | null {
    return this.getStored(id)?.schedule ?? null;
  }

  getStored(id: string): StoredSchedule | null {
    const row = this.statements.one.get(id) as unknown as Row | undefined;
    return row ? toStored(row) : null;
  }

  /**
   * Creates a schedule or changes one. It keeps its age, its runs and the runs you skipped; its runs count from now, so
   * a time already past today doesn't run at once. Resuming it here (paused off) clears the reason Seshboard paused it for.
   */
  save(input: ScheduleSave): Schedule {
    const parsed = ScheduleSave.parse(input);
    const before = parsed.id ? this.get(parsed.id) : null;
    const now = this.now();
    const schedule = Schedule.parse({
      ...parsed,
      id: parsed.id ?? randomUUID(),
      pausedReason: parsed.paused ? (before?.pausedReason ?? null) : null,
      lastRun: before?.lastRun ?? null,
      runs: before?.runs ?? [],
      skippedRuns: before?.skippedRuns ?? [],
      createdAt: before?.createdAt ?? now,
      updatedAt: now,
    });
    this.write(schedule, now);
    return schedule;
  }

  /** Puts a deleted schedule back as it was (Undo); its runs count from now. */
  restore(schedule: Schedule): Schedule {
    const parsed = Schedule.parse(schedule);
    this.write(parsed, this.now());
    return this.get(parsed.id)!;
  }

  /** Pauses (with Seshboard's reason, or null when you paused it) or resumes. Null when it is gone. */
  setPaused(id: string, paused: boolean, reason: string | null = null): Schedule | null {
    if (!this.get(id)) return null;
    const now = this.now();
    // Resumed, it counts from now: what was due while it was paused doesn't run.
    this.statements.setPaused.run(paused ? 1 : 0, paused ? reason : null, now, now, id);
    return this.get(id);
  }

  /** Records a run: it becomes the last run and goes on top of the run history (the last `SCHEDULE_HISTORY`). */
  setLastRun(id: string, lastRun: ScheduleLastRun): void {
    const run = ScheduleLastRun.parse(lastRun);
    const runs = [run, ...(this.get(id)?.runs ?? [])].slice(0, SCHEDULE_HISTORY);
    this.statements.setLastRun.run(JSON.stringify(run), JSON.stringify(runs), id);
  }

  /**
   * Skip this run (`skip` true) or take it back. `at` is the run's moment; it is kept as an ISO time. Runs already dealt
   * with (before `checkedAt`) are cleaned up on the way. Null when the schedule is gone.
   */
  setSkipped(id: string, at: number, skip: boolean): Schedule | null {
    const stored = this.getStored(id);
    if (!stored) return null;
    const iso = new Date(at).toISOString();
    const kept = stored.schedule.skippedRuns.filter((time) => time !== iso && Date.parse(time) > stored.checkedAt);
    const next = skip ? [...kept, iso].sort().slice(-SCHEDULE_SKIPS) : kept;
    this.statements.setSkipped.run(next.length > 0 ? JSON.stringify(next) : null, id);
    return this.get(id);
  }

  /** Its runs up to `at` were dealt with. */
  setChecked(id: string, at: number): void {
    this.statements.setChecked.run(at, id);
  }

  remove(id: string): void {
    this.statements.remove.run(id);
  }

  /** A schedule started this session. */
  addRun(sessionId: string, scheduleId: string, at: number): void {
    this.statements.addRun.run(sessionId, scheduleId, at);
  }

  /** The sessions schedules started (also those of deleted schedules: they still came from one). */
  sessions(): ScheduleSession[] {
    return (this.statements.runs.all() as unknown as { session_id: string; schedule_id: string }[]).map((row) => ({ sessionId: row.session_id, scheduleId: row.schedule_id }));
  }

  private write(schedule: Schedule, checkedAt: number): void {
    this.statements.upsert.run(
      schedule.id,
      schedule.name,
      JSON.stringify(schedule.draft),
      JSON.stringify(schedule.rule),
      schedule.missed,
      schedule.paused ? 1 : 0,
      schedule.pausedReason,
      schedule.lastRun ? JSON.stringify(schedule.lastRun) : null,
      schedule.runs.length > 0 ? JSON.stringify(schedule.runs) : null,
      schedule.skippedRuns.length > 0 ? JSON.stringify(schedule.skippedRuns) : null,
      checkedAt,
      schedule.createdAt,
      schedule.updatedAt,
    );
  }
}

/** A row as a schedule; null for one a newer build wrote differently, skipped rather than failing the whole list. */
function toStored(row: Row): StoredSchedule | null {
  const draft = LaterDraft.safeParse(safeJson(row.draft_json));
  const rule = ScheduleRuleSchema.safeParse(safeJson(row.rule_json));
  if (!draft.success || !rule.success) return null;
  const lastRun = row.last_run_json === null ? null : ScheduleLastRun.safeParse(safeJson(row.last_run_json));
  // A run or a skipped time that doesn't read is left out, rather than the whole schedule.
  const runs = row.runs_json === null ? [] : listOf(safeJson(row.runs_json)).flatMap((r) => {
    const run = ScheduleLastRun.safeParse(r);
    return run.success ? [run.data] : [];
  });
  const skippedRuns = row.skipped_runs_json === null ? [] : listOf(safeJson(row.skipped_runs_json)).filter((t): t is string => typeof t === 'string' && !Number.isNaN(Date.parse(t)));
  const schedule = Schedule.safeParse({
    id: row.id,
    name: row.name,
    draft: draft.data,
    rule: rule.data,
    missed: ScheduleMissedSchema.catch('run').parse(row.missed),
    paused: row.paused === 1,
    pausedReason: row.paused_reason,
    lastRun: lastRun?.success ? lastRun.data : null,
    runs: runs.slice(0, SCHEDULE_HISTORY),
    skippedRuns: skippedRuns.slice(-SCHEDULE_SKIPS),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  return schedule.success ? { schedule: schedule.data, checkedAt: row.checked_at } : null;
}

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
