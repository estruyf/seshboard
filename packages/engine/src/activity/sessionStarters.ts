import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { ActivityStarter } from '@seshboard/protocol';

/** How far up a session's parents a starter is looked for: a pipeline's step under its run, a sub-session's sub-session. */
const PARENT_DEPTH = 6;

/**
 * Who started each session, for Activity: read from what the engine already records when it starts one for someone
 * else. A paired device (`remote_session_origins`, written by the remote hub for `session.create` and `pipelines.run`),
 * a trigger (`trigger_sessions`) or a schedule (`schedule_runs`). A session in none of them was started by you here.
 */
export class SessionStarters {
  private readonly statements: Record<'devices' | 'triggers' | 'schedules', StatementSync>;

  constructor(db: DatabaseSync) {
    this.statements = {
      // A device's name now, else the one it had when it started the session (its row is gone).
      devices: db.prepare('SELECT o.session_id AS sessionId, o.device_id AS id, COALESCE(d.name, o.device_name) AS name FROM remote_session_origins o LEFT JOIN remote_devices d ON d.id = o.device_id'),
      triggers: db.prepare('SELECT s.session_id AS sessionId, s.trigger_id AS id, COALESCE(t.name, s.trigger_name) AS name FROM trigger_sessions s LEFT JOIN triggers t ON t.id = s.trigger_id'),
      schedules: db.prepare("SELECT r.session_id AS sessionId, r.schedule_id AS id, COALESCE(s.name, 'A schedule') AS name FROM schedule_runs r LEFT JOIN schedules s ON s.id = r.schedule_id"),
    };
  }

  /** Every recorded starter by session (or pipeline run) id. A device wins over a trigger, a trigger over a schedule. */
  all(): Map<string, ActivityStarter> {
    const out = new Map<string, ActivityStarter>();
    for (const kind of ['schedules', 'triggers', 'devices'] as const) {
      const starter = kind === 'devices' ? 'device' : kind === 'triggers' ? 'trigger' : 'schedule';
      for (const row of this.statements[kind].all() as Array<{ sessionId: string; id: string; name: string }>) out.set(row.sessionId, { kind: starter, id: row.id, name: row.name });
    }
    return out;
  }
}

/** A session's starter: its own, else the nearest one of the sessions (or run) it sits under. Null: you started it here. */
export function starterOf(sessionId: string, starters: ReadonlyMap<string, ActivityStarter>, parentOf: (id: string) => string | null | undefined): ActivityStarter | null {
  let id: string | null | undefined = sessionId;
  for (let depth = 0; id && depth <= PARENT_DEPTH; depth++) {
    const found = starters.get(id);
    if (found) return found;
    id = parentOf(id);
  }
  return null;
}
