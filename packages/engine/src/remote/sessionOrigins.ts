import type { DatabaseSync, StatementSync } from 'node:sqlite';

/** How many sessions' starters it keeps: the most recent, well past what a phone's list shows. */
export const SESSION_ORIGINS_MAX = 2_000;

/**
 * Which paired device started a session, or a pipeline run, from afar (`session.create`, `pipelines.run`), for
 * `RemoteSession.startedBy`: a computer sharing this one names the other people's sessions with it. A session started
 * on this computer itself has none.
 */
export class SessionOrigins {
  private readonly statements: Record<'all' | 'add' | 'trim', StatementSync>;

  constructor(
    db: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {
    this.statements = {
      all: db.prepare('SELECT session_id, device_id, device_name FROM remote_session_origins'),
      add: db.prepare('INSERT OR REPLACE INTO remote_session_origins (session_id, device_id, device_name, started_at) VALUES (?, ?, ?, ?)'),
      trim: db.prepare('DELETE FROM remote_session_origins WHERE rowid NOT IN (SELECT rowid FROM remote_session_origins ORDER BY started_at DESC, rowid DESC LIMIT ?)'),
    };
  }

  /** A device started this session or run. */
  add(sessionId: string, device: { id: string; name: string }): void {
    this.statements.add.run(sessionId, device.id, device.name, this.now());
    this.statements.trim.run(SESSION_ORIGINS_MAX);
  }

  /**
   * Who started each session, by session id: the device's name now (`names`, the paired devices by id), else the name
   * it had then (it was revoked since).
   */
  starters(names: ReadonlyMap<string, string>): Map<string, string> {
    const rows = this.statements.all.all() as unknown as Array<{ session_id: string; device_id: string; device_name: string }>;
    return new Map(rows.map((row) => [row.session_id, names.get(row.device_id) ?? row.device_name]));
  }
}
