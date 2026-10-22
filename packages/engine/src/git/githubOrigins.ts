import type { DatabaseSync } from 'node:sqlite';
import type { GithubOrigin } from '@switchboard/protocol';

/** Why push and Create pull request are off in a session from a fork's pull request (the header says the same). */
export const FORK_READ_ONLY = "From a fork you can't push to.";

/**
 * `session_github`: the issue or pull request each session was started from (New session from it), and whether it is
 * a pull request from a fork Switchboard can't push to. In that session push and Create pull request are off, in the
 * header and in the engine (`readOnlyAt`). Set when the session starts and never read back from a transcript, so it
 * is kept like the other user choices.
 */
export class GithubOriginStore {
  private readonly statements;

  constructor(db: DatabaseSync) {
    this.statements = {
      save: db.prepare(`INSERT INTO session_github (session_id, type, repo, number, read_only, cwd, branch, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (session_id) DO UPDATE SET type = excluded.type, repo = excluded.repo, number = excluded.number, read_only = excluded.read_only, cwd = excluded.cwd, branch = excluded.branch`),
      get: db.prepare('SELECT type, repo, number, read_only AS readOnly FROM session_github WHERE session_id = ?'),
      readOnlyAt: db.prepare('SELECT 1 FROM session_github WHERE read_only = 1 AND cwd = ? AND branch = ? LIMIT 1'),
    };
  }

  /** `cwd` and `branch`: where the session works on it, for `readOnlyAt`. */
  save(sessionId: string, origin: GithubOrigin, where: { cwd: string; branch: string | null }, at = Date.now()): void {
    this.statements.save.run(sessionId, origin.type, origin.repo, origin.number, origin.readOnly ? 1 : 0, where.cwd, where.branch, at);
  }

  get(sessionId: string): GithubOrigin | null {
    const row = this.statements.get.get(sessionId) as { type: GithubOrigin['type']; repo: string; number: number; readOnly: number } | undefined;
    return row ? { type: row.type, repo: row.repo, number: row.number, readOnly: row.readOnly === 1 } : null;
  }

  /** A fork's pull request that Switchboard can't push to is checked out in `cwd` on `branch`. */
  readOnlyAt(cwd: string, branch: string | null): boolean {
    return branch !== null && this.statements.readOnlyAt.get(cwd, branch) !== undefined;
  }
}
