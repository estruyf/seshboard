import type { DatabaseSync } from 'node:sqlite';

/** The forks a provider profile made here, for its source to list until the provider's own list has them. */
export interface ForkRecord {
  list(): string[];
  add(sessionId: string): void;
  remove(sessionId: string): void;
}

/**
 * Forks Seshboard made of another provider's sessions, per profile (`provider_forks`). Codex's own list leaves out a
 * fork without a turn of its own, so without this one made from a message would be gone after a restart. Nothing else
 * has them: a cache rebuild keeps them.
 */
export class ProviderForks {
  private readonly statements;

  constructor(db: DatabaseSync) {
    this.statements = {
      list: db.prepare('SELECT session_id FROM provider_forks WHERE profile_id = ? ORDER BY created_at'),
      add: db.prepare('INSERT OR IGNORE INTO provider_forks (session_id, profile_id, created_at) VALUES (?, ?, ?)'),
      remove: db.prepare('DELETE FROM provider_forks WHERE session_id = ?'),
    };
  }

  /** One profile's record. */
  of(profileId: string): ForkRecord {
    return {
      list: () => (this.statements.list.all(profileId) as Array<{ session_id: string }>).map((r) => r.session_id),
      add: (sessionId) => void this.statements.add.run(sessionId, profileId, Date.now()),
      remove: (sessionId) => this.forget(sessionId),
    };
  }

  /** A session deleted: it is no fork to list any more, whichever profile made it. */
  forget(sessionId: string): void {
    this.statements.remove.run(sessionId);
  }
}
