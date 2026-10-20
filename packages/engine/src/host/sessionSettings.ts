import type { DatabaseSync } from 'node:sqlite';
import { AutoPick, type Effort, type PermissionMode } from '@switchboard/protocol';

/** What a session last ran with, so a resume (after Stop, the idle timeout or an app restart) carries on the same way. */
export interface SessionSettings {
  permissionMode: PermissionMode | null;
  /** Only what you picked; null follows your Claude Code default. */
  model: string | null;
  effort: Effort | null;
  /** What Auto picked when the session started; null when Auto didn't pick its model. */
  autoPick: AutoPick | null;
  /** A pipeline's read-only step (#179): only tools that read, also after a resume. */
  readOnly: boolean;
}

export interface SessionSettingsStore {
  get(sessionId: string): SessionSettings | null;
  set(sessionId: string, patch: Partial<SessionSettings>): void;
  delete(sessionId: string): void;
}

const EMPTY: SessionSettings = { permissionMode: null, model: null, effort: null, autoPick: null, readOnly: false };

/** A stored pick, or null when it is missing or no longer readable. */
function readPick(json: string | null): AutoPick | null {
  if (!json) return null;
  try {
    const parsed = AutoPick.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Kept in the `session_settings` table (a user choice, so it survives a cache rebuild). */
export function createSessionSettingsStore(db: DatabaseSync): SessionSettingsStore {
  const select = db.prepare('SELECT permission_mode, model, effort, auto_pick_json, read_only FROM session_settings WHERE id = ?');
  const upsert = db.prepare(`
    INSERT INTO session_settings (id, permission_mode, model, effort, auto_pick_json, read_only) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET permission_mode = excluded.permission_mode, model = excluded.model, effort = excluded.effort, auto_pick_json = excluded.auto_pick_json, read_only = excluded.read_only
  `);
  const remove = db.prepare('DELETE FROM session_settings WHERE id = ?');
  const get = (sessionId: string): SessionSettings | null => {
    // SQLite can't bind a missing id; such a session has nothing saved.
    if (typeof sessionId !== 'string') return null;
    const row = select.get(sessionId) as { permission_mode: string | null; model: string | null; effort: string | null; auto_pick_json: string | null; read_only: number } | undefined;
    return row ? { permissionMode: row.permission_mode as PermissionMode | null, model: row.model, effort: row.effort as Effort | null, autoPick: readPick(row.auto_pick_json), readOnly: row.read_only === 1 } : null;
  };
  return {
    get,
    set(sessionId, patch) {
      if (typeof sessionId !== 'string') return;
      const next = { ...EMPTY, ...get(sessionId), ...patch };
      upsert.run(sessionId, next.permissionMode, next.model, next.effort, next.autoPick ? JSON.stringify(next.autoPick) : null, next.readOnly ? 1 : 0);
    },
    delete(sessionId) {
      if (typeof sessionId !== 'string') return;
      remove.run(sessionId);
    },
  };
}

/** For tests and engines without a database: forgets everything when the engine restarts. */
export function createMemorySessionSettings(): SessionSettingsStore {
  const map = new Map<string, SessionSettings>();
  return {
    get: (sessionId) => map.get(sessionId) ?? null,
    set: (sessionId, patch) => void map.set(sessionId, { ...EMPTY, ...map.get(sessionId), ...patch }),
    delete: (sessionId) => void map.delete(sessionId),
  };
}
