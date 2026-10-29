import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  effectiveMaxAtOnce,
  StateLabels,
  Trigger,
  TRIGGER_EVENTS_KEPT,
  TriggerDraft,
  TriggerEvent,
  TriggerSave,
  TriggerSession,
  TriggerSource,
  TriggerStart,
  type FoundEvent,
  type SeenState,
  type TriggerEventStatus,
} from '@seshboard/protocol';

interface Row {
  id: string;
  project_root: string;
  name: string;
  source_json: string;
  prompt: string;
  draft_json: string;
  start_json: string | null;
  max_at_once: number;
  max_waiting: number;
  interval_min: number;
  state_labels_json: string;
  assign_on_pickup: number;
  paused: number;
  paused_reason: string | null;
  failures: number;
  last_error: string | null;
  blocked_until: number | null;
  last_checked_at: number | null;
  seeded_at: number | null;
  seen_json: string | null;
  created_at: number;
  updated_at: number;
}

interface EventRow {
  id: string;
  trigger_id: string;
  key: string;
  kind: string;
  title: string;
  url: string;
  fields_json: string;
  context: string | null;
  status: string;
  reason: string | null;
  session_id: string | null;
  run_id: string | null;
  item_id: string | null;
  label: string | null;
  reassigned_to: string | null;
  created_at: number;
  started_at: number | null;
}

/** An event with what Claude gets to read about it, which the windows don't need. */
export interface StoredEvent {
  event: TriggerEvent;
  context: string | null;
}

/** What a check changes on its trigger. */
export interface CheckResult {
  at: number;
  /** A check that worked: what it saw, and the count of failures back to 0. */
  seen?: SeenState;
  seeded?: boolean;
  /** A check that failed: the reason, counted. */
  error?: string;
  /** Stop checking until then (a rate limit). */
  blockedUntil?: number | null;
}

/**
 * Event triggers (#180), kept in `triggers`, `trigger_events` and `trigger_sessions`: user data, so they survive a
 * cache rebuild. A trigger's source, draft and state labels are JSON on its row, with what its last check saw
 * (`seen_json`). Events are one row per key; a key that matches again (an issue labelled again) takes its row over,
 * while the session it started keeps its own line in `trigger_sessions`.
 */
export class TriggerStore {
  private readonly statements;

  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {
    this.statements = {
      all: db.prepare('SELECT * FROM triggers ORDER BY created_at, rowid'),
      inProject: db.prepare('SELECT * FROM triggers WHERE project_root = ? ORDER BY created_at, rowid'),
      one: db.prepare('SELECT * FROM triggers WHERE id = ?'),
      upsert: db.prepare(`
        INSERT INTO triggers (id, project_root, name, source_json, prompt, draft_json, start_json, max_at_once, max_waiting, interval_min, state_labels_json,
          assign_on_pickup, paused, paused_reason, failures, last_error, blocked_until, last_checked_at, seeded_at, seen_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET project_root = excluded.project_root, name = excluded.name, source_json = excluded.source_json,
          prompt = excluded.prompt, draft_json = excluded.draft_json, start_json = excluded.start_json, max_at_once = excluded.max_at_once, max_waiting = excluded.max_waiting,
          interval_min = excluded.interval_min, state_labels_json = excluded.state_labels_json, assign_on_pickup = excluded.assign_on_pickup,
          paused = excluded.paused, paused_reason = excluded.paused_reason, failures = excluded.failures, last_error = excluded.last_error,
          blocked_until = excluded.blocked_until, last_checked_at = excluded.last_checked_at, seeded_at = excluded.seeded_at,
          seen_json = excluded.seen_json, created_at = excluded.created_at, updated_at = excluded.updated_at`),
      setPaused: db.prepare('UPDATE triggers SET paused = ?, paused_reason = ?, failures = ?, last_error = ?, blocked_until = NULL, seeded_at = ?, seen_json = ?, updated_at = ? WHERE id = ?'),
      checked: db.prepare('UPDATE triggers SET last_checked_at = ?, failures = 0, last_error = NULL, blocked_until = NULL, seen_json = ?, seeded_at = COALESCE(seeded_at, ?) WHERE id = ?'),
      failed: db.prepare('UPDATE triggers SET last_checked_at = ?, failures = failures + 1, last_error = ?, blocked_until = ? WHERE id = ?'),
      setSeen: db.prepare('UPDATE triggers SET seen_json = ? WHERE id = ?'),
      blocked: db.prepare('UPDATE triggers SET last_checked_at = ?, last_error = ?, blocked_until = ? WHERE id = ?'),
      remove: db.prepare('DELETE FROM triggers WHERE id = ?'),
      removeEvents: db.prepare('DELETE FROM trigger_events WHERE trigger_id = ?'),
      events: db.prepare('SELECT * FROM trigger_events ORDER BY created_at, rowid'),
      eventsOf: db.prepare('SELECT * FROM trigger_events WHERE trigger_id = ? ORDER BY created_at, rowid'),
      event: db.prepare('SELECT * FROM trigger_events WHERE id = ?'),
      eventByKey: db.prepare('SELECT * FROM trigger_events WHERE trigger_id = ? AND key = ?'),
      eventOfSession: db.prepare('SELECT * FROM trigger_events WHERE session_id = ?'),
      eventOfItem: db.prepare('SELECT * FROM trigger_events WHERE item_id = ?'),
      eventOfRun: db.prepare('SELECT * FROM trigger_events WHERE run_id = ?'),
      insertEvent: db.prepare(`
        INSERT INTO trigger_events (id, trigger_id, key, kind, title, url, fields_json, context, status, reason, session_id, item_id, label, reassigned_to, created_at, started_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, NULL)
        ON CONFLICT (trigger_id, key) DO UPDATE SET id = excluded.id, kind = excluded.kind, title = excluded.title, url = excluded.url,
          fields_json = excluded.fields_json, context = excluded.context, status = excluded.status, reason = excluded.reason, session_id = NULL,
          run_id = NULL, item_id = NULL, label = NULL, reassigned_to = NULL, created_at = excluded.created_at, started_at = NULL`),
      setStatus: db.prepare('UPDATE trigger_events SET status = ?, reason = ?, session_id = COALESCE(?, session_id), run_id = COALESCE(?, run_id), item_id = ?, started_at = COALESCE(?, started_at) WHERE id = ?'),
      setLabel: db.prepare('UPDATE trigger_events SET label = ? WHERE id = ?'),
      setReassigned: db.prepare('UPDATE trigger_events SET reassigned_to = ? WHERE id = ?'),
      setFields: db.prepare('UPDATE trigger_events SET fields_json = ? WHERE id = ?'),
      prune: db.prepare(`
        DELETE FROM trigger_events WHERE trigger_id = ? AND status <> 'waiting' AND id NOT IN (
          SELECT id FROM trigger_events WHERE trigger_id = ? AND status <> 'waiting' ORDER BY created_at DESC, rowid DESC LIMIT ?
        )`),
      forgetSessions: db.prepare('DELETE FROM trigger_sessions WHERE trigger_id = ?'),
      sessions: db.prepare('SELECT session_id, trigger_id, event_id, trigger_name, kind, ref, url, at FROM trigger_sessions ORDER BY at, rowid'),
      addSession: db.prepare(`INSERT INTO trigger_sessions (session_id, trigger_id, event_id, trigger_name, kind, ref, url, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (session_id) DO NOTHING`),
    };
  }

  list(): Trigger[] {
    return this.rows(this.statements.all.all() as unknown as Row[]);
  }

  /** The triggers of one project, oldest first. */
  inProject(root: string): Trigger[] {
    return this.rows(this.statements.inProject.all(root) as unknown as Row[]);
  }

  get(id: string): Trigger | null {
    const row = this.statements.one.get(id) as unknown as Row | undefined;
    return row ? toTrigger(row) : null;
  }

  /** What a trigger's last check saw. */
  seen(id: string): SeenState {
    const row = this.statements.one.get(id) as unknown as Row | undefined;
    const value = row?.seen_json ? safeJson(row.seen_json) : null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, SeenState[string]] => entry[1] === 'match' || entry[1] === 'held' || entry[1] === 'released'));
  }

  /** Marks one key of what the trigger saw, without a check (a state label Seshboard took off). */
  setSeen(id: string, key: string, state: SeenState[string]): void {
    if (!this.get(id)) return;
    this.statements.setSeen.run(JSON.stringify({ ...this.seen(id), [key]: state }), id);
  }

  /**
   * Creates a trigger or changes one. Bypassing permissions is refused (the schema has no such mode). In the project's
   * folder it allows one session at a time. A new trigger, or one whose source changed, looks again before it starts
   * anything: what matches then is marked as seen. Resuming it here clears the reason Seshboard paused it for.
   */
  save(input: TriggerSave): Trigger {
    const parsed = TriggerSave.parse(input);
    const before = parsed.id ? this.get(parsed.id) : null;
    const now = this.now();
    const sourceChanged = !before || JSON.stringify(before.source) !== JSON.stringify(parsed.source);
    const resumed = !!before?.paused && !parsed.paused;
    const fresh = sourceChanged || resumed;
    const trigger = Trigger.parse({
      ...parsed,
      id: parsed.id ?? randomUUID(),
      maxAtOnce: effectiveMaxAtOnce({ maxAtOnce: parsed.maxAtOnce, draft: parsed.draft, start: parsed.start }),
      pausedReason: parsed.paused ? (before?.pausedReason ?? null) : null,
      failures: parsed.paused || resumed ? 0 : (before?.failures ?? 0),
      lastError: resumed ? null : (before?.lastError ?? null),
      blockedUntil: resumed ? null : (before?.blockedUntil ?? null),
      lastCheckedAt: fresh ? null : (before?.lastCheckedAt ?? null),
      seededAt: fresh ? null : (before?.seededAt ?? null),
      createdAt: before?.createdAt ?? now,
      updatedAt: now,
    });
    this.write(trigger, fresh ? null : this.seen(trigger.id));
    return trigger;
  }

  /** Puts a deleted trigger back as it was (Undo), with its events; it looks again before it starts anything. */
  restore(trigger: Trigger, events: readonly StoredEvent[] = []): Trigger {
    const parsed = Trigger.parse({ ...trigger, seededAt: null, lastCheckedAt: null });
    this.write(parsed, null);
    for (const { event, context } of events) {
      if (event.triggerId !== parsed.id) continue;
      this.statements.insertEvent.run(event.id, event.triggerId, event.key, event.kind, event.title, event.url, JSON.stringify(event.fields), context, event.status, event.reason, event.createdAt);
      this.statements.setStatus.run(event.status, event.reason, event.sessionId, event.runId, event.itemId, event.startedAt, event.id);
      if (event.label) this.statements.setLabel.run(event.label, event.id);
    }
    return this.get(parsed.id)!;
  }

  /**
   * Pauses (with Seshboard's reason, or null when you paused it) or resumes. Resumed, it looks again first, so what
   * came while it was paused is marked as seen. Null when it is gone.
   */
  setPaused(id: string, paused: boolean, reason: string | null = null): Trigger | null {
    const before = this.get(id);
    if (!before) return null;
    const now = this.now();
    if (paused) this.statements.setPaused.run(1, reason, before.failures, before.lastError, before.seededAt, JSON.stringify(this.seen(id)), now, id);
    else this.statements.setPaused.run(0, null, 0, null, null, null, now, id);
    return this.get(id);
  }

  /** Records a check: one that worked (what it saw) or one that failed (counted, with its reason). */
  checked(id: string, result: CheckResult): Trigger | null {
    if (result.error !== undefined) this.statements.failed.run(result.at, result.error.slice(0, 300), result.blockedUntil ?? null, id);
    else this.statements.checked.run(result.at, JSON.stringify(result.seen ?? {}), result.seeded ? result.at : null, id);
    return this.get(id);
  }

  /** A rate limit: no checks until `until`. Not counted as a failure, so it never pauses the trigger. */
  blocked(id: string, at: number, until: number, message: string): void {
    this.statements.blocked.run(at, message.slice(0, 300), until, id);
  }

  /** Deletes a trigger and its events. The sessions it started keep their bolt and their line. */
  remove(id: string): void {
    this.statements.remove.run(id);
    this.statements.removeEvents.run(id);
  }

  /** Every event, oldest first: the last `TRIGGER_EVENTS_KEPT` of each trigger and everything waiting. */
  events(): TriggerEvent[] {
    return (this.statements.events.all() as unknown as EventRow[]).flatMap((row) => toEvent(row)?.event ?? []);
  }

  /** A trigger's events with what Claude gets to read, oldest first (for Undo, and the watcher). */
  eventsOf(triggerId: string): StoredEvent[] {
    return (this.statements.eventsOf.all(triggerId) as unknown as EventRow[]).flatMap((row) => toEvent(row) ?? []);
  }

  event(id: string): StoredEvent | null {
    const row = this.statements.event.get(id) as unknown as EventRow | undefined;
    return row ? toEvent(row) : null;
  }

  eventByKey(triggerId: string, key: string): StoredEvent | null {
    const row = this.statements.eventByKey.get(triggerId, key) as unknown as EventRow | undefined;
    return row ? toEvent(row) : null;
  }

  /** The event a session works on. */
  eventOfSession(sessionId: string): StoredEvent | null {
    const row = this.statements.eventOfSession.get(sessionId) as unknown as EventRow | undefined;
    return row ? toEvent(row) : null;
  }

  /** The event a pipeline run works on. */
  eventOfRun(runId: string): StoredEvent | null {
    const row = this.statements.eventOfRun.get(runId) as unknown as EventRow | undefined;
    return row ? toEvent(row) : null;
  }

  /** The event a queued item came from. */
  eventOfItem(itemId: string): StoredEvent | null {
    const row = this.statements.eventOfItem.get(itemId) as unknown as EventRow | undefined;
    return row ? toEvent(row) : null;
  }

  /**
   * Records an event a check found, as `status` (`waiting` or `skipped`). One row per key: a key that comes back
   * (an issue that matches again) takes its row over, starting fresh. Old events past the last
   * `TRIGGER_EVENTS_KEPT` go; waiting ones stay.
   */
  addEvent(triggerId: string, found: FoundEvent, status: TriggerEventStatus, reason: string | null = null, at = this.now()): TriggerEvent {
    const id = randomUUID();
    this.statements.insertEvent.run(id, triggerId, found.key, found.kind, found.title.slice(0, 500), found.url.slice(0, 1000), JSON.stringify(clipFields(found.fields)), found.context?.slice(0, 20_000) ?? null, status, reason, at);
    this.statements.prune.run(triggerId, triggerId, TRIGGER_EVENTS_KEPT);
    return this.event(id)!.event;
  }

  /** Moves an event on: started (with its session or run), queued (with its item), skipped or replaced (with why). */
  setStatus(id: string, status: TriggerEventStatus, extra: { reason?: string | null; sessionId?: string | null; runId?: string | null; itemId?: string | null; startedAt?: number | null } = {}): TriggerEvent | null {
    this.statements.setStatus.run(status, extra.reason ?? null, extra.sessionId ?? null, extra.runId ?? null, extra.itemId ?? null, extra.startedAt ?? null, id);
    return this.event(id)?.event ?? null;
  }

  /** The state label Seshboard put on the event's issue last. */
  setLabel(id: string, label: string | null): void {
    this.statements.setLabel.run(label, id);
  }

  setReassigned(id: string, login: string | null): void {
    this.statements.setReassigned.run(login, id);
  }

  setFields(id: string, fields: Record<string, string>): void {
    this.statements.setFields.run(JSON.stringify(clipFields(fields)), id);
  }

  /** A trigger started this session for this event. */
  addSession(link: TriggerSession): void {
    this.statements.addSession.run(link.sessionId, link.triggerId, link.eventId, link.triggerName, link.kind, link.ref, link.url, link.at);
  }

  /** Forgets which sessions a trigger started (the screenshot tour's demo triggers, taken out again). */
  forgetSessions(triggerId: string): void {
    this.statements.forgetSessions.run(triggerId);
  }

  /** The sessions triggers started (also those of deleted triggers: they still came from one). */
  sessions(): TriggerSession[] {
    return (this.statements.sessions.all() as unknown as Array<{ session_id: string; trigger_id: string; event_id: string; trigger_name: string; kind: string; ref: string; url: string; at: number }>).flatMap((row) => {
      const parsed = TriggerSession.safeParse({ sessionId: row.session_id, triggerId: row.trigger_id, eventId: row.event_id, triggerName: row.trigger_name, kind: row.kind, ref: row.ref, url: row.url, at: row.at });
      return parsed.success ? [parsed.data] : [];
    });
  }

  private rows(rows: Row[]): Trigger[] {
    return rows.flatMap((row) => toTrigger(row) ?? []);
  }

  private write(trigger: Trigger, seen: SeenState | null): void {
    this.statements.upsert.run(
      trigger.id,
      trigger.projectRoot,
      trigger.name,
      JSON.stringify(trigger.source),
      trigger.prompt,
      JSON.stringify(trigger.draft),
      trigger.start.kind === 'session' ? null : JSON.stringify(trigger.start),
      trigger.maxAtOnce,
      trigger.maxWaiting,
      trigger.intervalMinutes,
      JSON.stringify(trigger.stateLabels),
      trigger.assignOnPickUp ? 1 : 0,
      trigger.paused ? 1 : 0,
      trigger.pausedReason,
      trigger.failures,
      trigger.lastError,
      trigger.blockedUntil,
      trigger.lastCheckedAt,
      trigger.seededAt,
      seen ? JSON.stringify(seen) : null,
      trigger.createdAt,
      trigger.updatedAt,
    );
  }
}

/** Fields as stored: each value within what the schema takes. */
const clipFields = (fields: Record<string, string>) => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v).slice(0, 2000)]));

/** A row as a trigger; null for one a newer build wrote differently, skipped rather than failing the whole list. */
function toTrigger(row: Row): Trigger | null {
  const source = TriggerSource.safeParse(safeJson(row.source_json));
  if (!source.success) return null;
  const draft = TriggerDraft.safeParse(safeJson(row.draft_json));
  const labels = StateLabels.safeParse(safeJson(row.state_labels_json));
  // Null before triggers could start pipelines: a session.
  const start = row.start_json ? TriggerStart.safeParse(safeJson(row.start_json)) : null;
  if (start && !start.success) return null;
  const trigger = Trigger.safeParse({
    id: row.id,
    projectRoot: row.project_root,
    name: row.name,
    source: source.data,
    prompt: row.prompt,
    draft: draft.success ? draft.data : TriggerDraft.parse({}),
    start: start?.data ?? { kind: 'session' },
    maxAtOnce: row.max_at_once,
    maxWaiting: row.max_waiting,
    intervalMinutes: row.interval_min,
    stateLabels: labels.success ? labels.data : StateLabels.parse({}),
    assignOnPickUp: row.assign_on_pickup === 1,
    paused: row.paused === 1,
    pausedReason: row.paused_reason,
    failures: row.failures,
    lastError: row.last_error,
    blockedUntil: row.blocked_until,
    lastCheckedAt: row.last_checked_at,
    seededAt: row.seeded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  return trigger.success ? trigger.data : null;
}

function toEvent(row: EventRow): StoredEvent | null {
  const fields = safeJson(row.fields_json);
  const event = TriggerEvent.safeParse({
    id: row.id,
    triggerId: row.trigger_id,
    key: row.key,
    kind: row.kind,
    title: row.title,
    url: row.url,
    fields: fields && typeof fields === 'object' && !Array.isArray(fields) ? fields : {},
    status: row.status,
    reason: row.reason,
    sessionId: row.session_id,
    runId: row.run_id,
    itemId: row.item_id,
    label: row.label,
    reassignedTo: row.reassigned_to,
    createdAt: row.created_at,
    startedAt: row.started_at,
  });
  return event.success ? { event: event.data, context: row.context } : null;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
