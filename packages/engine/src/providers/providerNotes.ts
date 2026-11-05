import type { DatabaseSync } from 'node:sqlite';
import type { RawSessionMessage } from '../claude/transcript.ts';

/** When a message happened (its `timestamp`), for putting notes in their place; 0 when it doesn't say. */
const timeOf = (message: RawSessionMessage): number => {
  const at = Date.parse(typeof message.timestamp === 'string' ? message.timestamp : '');
  return Number.isFinite(at) ? at : 0;
};

/**
 * A provider's conversation with Seshboard's notes in their places: each after the last message from before it, in
 * the order they came. A note whose message the provider's file has (same uuid) isn't added twice.
 */
export function mergeNotes(messages: readonly RawSessionMessage[], notes: readonly RawSessionMessage[]): RawSessionMessage[] {
  if (!notes.length) return [...messages];
  const have = new Set(messages.map((m) => m.uuid));
  const out = [...messages];
  for (const note of notes) {
    if (have.has(note.uuid)) continue;
    const at = timeOf(note);
    let index = out.length;
    while (index > 0 && timeOf(out[index - 1]!) > at) index--;
    out.splice(index, 0, note);
  }
  return out;
}

interface Row {
  message_json: string;
}

/**
 * What another provider's session showed but its own file doesn't have (Copilot's slash commands and the words they
 * answered), kept in `provider_notes` so a reload shows them where they were. Nothing else has them: a cache rebuild
 * keeps them.
 */
export class ProviderNotes {
  private readonly statements;

  constructor(db: DatabaseSync) {
    this.statements = {
      list: db.prepare('SELECT message_json FROM provider_notes WHERE session_id = ? ORDER BY at, rowid'),
      insert: db.prepare('INSERT OR IGNORE INTO provider_notes (uuid, session_id, at, message_json) VALUES (?, ?, ?, ?)'),
      forget: db.prepare('DELETE FROM provider_notes WHERE session_id = ?'),
    };
  }

  add(sessionId: string, messages: readonly RawSessionMessage[]): void {
    for (const message of messages) this.statements.insert.run(message.uuid, sessionId, timeOf(message), JSON.stringify(message));
  }

  list(sessionId: string): RawSessionMessage[] {
    return (this.statements.list.all(sessionId) as unknown as Row[]).flatMap((row) => {
      try {
        return [JSON.parse(row.message_json) as RawSessionMessage];
      } catch {
        return [];
      }
    });
  }

  /** The session went to the Trash. */
  forget(sessionId: string): void {
    this.statements.forget.run(sessionId);
  }
}
