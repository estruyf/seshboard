import type { DatabaseSync } from 'node:sqlite';

/** A pull request a session opened, or whose head is the branch it worked on. */
export interface SessionPr {
  /** `owner/name`. */
  repo: string;
  number: number;
  url: string;
  state: 'open' | 'merged' | 'closed';
  base: string | null;
  head: string | null;
  /** `opened`: Claude ran `gh pr create` in the session. `branch`: found by the session's branch. */
  source: 'opened' | 'branch';
  seenAt: number;
  checkedAt: number;
}

/**
 * `session_links` and `session_prs` (session linking): which sessions a session's messages linked, and the pull
 * requests of each session. A cache read back from transcripts, so a rebuild may drop it.
 */
export class LinkStore {
  private readonly statements;

  constructor(db: DatabaseSync) {
    this.statements = {
      link: db.prepare('INSERT OR IGNORE INTO session_links (from_session, to_session, label, created_at) VALUES (?, ?, ?, ?)'),
      linksFrom: db.prepare('SELECT to_session AS sessionId, label, MAX(created_at) AS at FROM session_links WHERE from_session = ? GROUP BY to_session ORDER BY at DESC'),
      // An `opened` row is never turned back into a `branch` one; its state and base still follow what gh says.
      savePr: db.prepare(`INSERT INTO session_prs (session_id, repo, number, url, state, base, head, source, seen_at, checked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (session_id, repo, number) DO UPDATE SET
          url = excluded.url, state = excluded.state, base = COALESCE(excluded.base, base), head = COALESCE(excluded.head, head),
          source = CASE WHEN source = 'opened' THEN 'opened' ELSE excluded.source END, checked_at = excluded.checked_at`),
      prsOf: db.prepare('SELECT repo, number, url, state, base, head, source, seen_at AS seenAt, checked_at AS checkedAt FROM session_prs WHERE session_id = ? ORDER BY seen_at DESC, number DESC'),
    };
  }

  /** A message in `from` linked `to`. */
  link(from: string, to: string, label: string, at = Date.now()): void {
    this.statements.link.run(from, to, label, at);
  }

  /** The sessions `from` linked, the latest first, once each. */
  linksFrom(from: string): Array<{ sessionId: string; label: string; at: number }> {
    return this.statements.linksFrom.all(from) as Array<{ sessionId: string; label: string; at: number }>;
  }

  savePr(sessionId: string, pr: Omit<SessionPr, 'seenAt' | 'checkedAt'>, at = Date.now()): void {
    this.statements.savePr.run(sessionId, pr.repo, pr.number, pr.url, pr.state, pr.base, pr.head, pr.source, at, at);
  }

  /** A session's pull requests, the newest first. */
  prsOf(sessionId: string): SessionPr[] {
    return this.statements.prsOf.all(sessionId) as unknown as SessionPr[];
  }
}
