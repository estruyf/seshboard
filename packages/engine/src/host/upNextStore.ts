import type { DatabaseSync } from 'node:sqlite';
import type { ImageAttachment, QueuedMessage } from '@seshboard/protocol';

/** A message in Up next as the engine keeps it: with its images, which the window never gets. */
export interface StoredUpNext {
  id: string;
  text: string;
  attachments: ImageAttachment[];
  createdAt: number;
}

/** What the window sees of a stored message: its images by name only. */
export const summarise = ({ attachments, ...message }: StoredUpNext): QueuedMessage => ({
  ...message,
  attachments: attachments.map((a, i) => a.name ?? `Image ${i + 1}`),
});

interface Row {
  id: string;
  session_id: string;
  text: string;
  attachments_json: string;
  created_at: number;
}

/**
 * Up next per session, kept in `up_next` (your own messages, so a cache rebuild keeps them) so they survive quitting
 * the app or stopping the session. Each change writes a session's whole list, in order: lists are short.
 */
export class UpNextStore {
  private readonly statements;

  constructor(private readonly db: DatabaseSync) {
    this.statements = {
      list: db.prepare('SELECT * FROM up_next WHERE session_id = ? ORDER BY position'),
      all: db.prepare('SELECT * FROM up_next ORDER BY session_id, position'),
      clear: db.prepare('DELETE FROM up_next WHERE session_id = ?'),
      insert: db.prepare('INSERT INTO up_next (id, session_id, position, text, attachments_json, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    };
  }

  list(sessionId: string): StoredUpNext[] {
    return (this.statements.list.all(sessionId) as unknown as Row[]).map(fromRow);
  }

  /** Every session that has messages waiting, without their images. */
  all(): Array<{ sessionId: string; queue: QueuedMessage[] }> {
    const bySession = new Map<string, QueuedMessage[]>();
    for (const row of this.statements.all.all() as unknown as Row[]) {
      const queue = bySession.get(row.session_id) ?? [];
      queue.push(summarise(fromRow(row)));
      bySession.set(row.session_id, queue);
    }
    return [...bySession].map(([sessionId, queue]) => ({ sessionId, queue }));
  }

  /** Replaces a session's list; an empty one removes it. */
  save(sessionId: string, messages: readonly StoredUpNext[]): void {
    this.db.exec('BEGIN');
    try {
      this.statements.clear.run(sessionId);
      messages.forEach((m, i) => this.statements.insert.run(m.id, sessionId, i, m.text, JSON.stringify(m.attachments), m.createdAt));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

function fromRow(row: Row): StoredUpNext {
  let attachments: ImageAttachment[] = [];
  try {
    const parsed = JSON.parse(row.attachments_json) as unknown;
    if (Array.isArray(parsed)) attachments = parsed as ImageAttachment[];
  } catch {
    // A broken row keeps its text; its images are gone.
  }
  return { id: row.id, text: row.text, attachments, createdAt: row.created_at };
}
