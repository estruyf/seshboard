import type { DatabaseSync } from 'node:sqlite';
import { CatchUp, type TokenCounts } from '@switchboard/protocol';

/** The latest catch-up per session, in `catchup`, so it outlives a restart. A card that no longer reads is dropped. */
export class CatchUpStore {
  private readonly statements;

  constructor(db: DatabaseSync) {
    this.statements = {
      get: db.prepare('SELECT json FROM catchup WHERE session_id = ?'),
      all: db.prepare('SELECT json FROM catchup'),
      save: db.prepare('INSERT OR REPLACE INTO catchup (session_id, turn_id, json) VALUES (?, ?, ?)'),
      clear: db.prepare('DELETE FROM catchup WHERE session_id = ?'),
    };
  }

  get(sessionId: string): CatchUp | null {
    const row = this.statements.get.get(sessionId) as { json: string } | undefined;
    return row ? read(row.json) : null;
  }

  all(): CatchUp[] {
    return (this.statements.all.all() as Array<{ json: string }>).flatMap((row) => read(row.json) ?? []);
  }

  save(card: CatchUp): void {
    this.statements.save.run(card.sessionId, card.turnId, JSON.stringify(card));
  }

  /** Whether there was one to clear. */
  clear(sessionId: string): boolean {
    return Number(this.statements.clear.run(sessionId).changes) > 0;
  }
}

/** A stored card, checked again (an older version may have written another shape). */
function read(json: string): CatchUp | null {
  try {
    const parsed = CatchUp.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** One summary call's tokens, for Usage (its "Catch-up summaries" row). */
export interface CatchUpUsageEntry {
  id: string;
  scope: string;
  at: number;
  model: string;
  sessionId: string;
  tokens: TokenCounts;
}

/** The tokens the summaries used, per profile scope (`catchup_usage`): no transcript holds them. */
export class CatchUpUsageStore {
  private readonly insert;
  constructor(db: DatabaseSync) {
    this.insert = db.prepare('INSERT OR REPLACE INTO catchup_usage (id, scope, at, model, session_id, input, output, cache_read, cache_write) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  }

  record(entry: CatchUpUsageEntry): void {
    const { tokens } = entry;
    this.insert.run(entry.id, entry.scope, entry.at, entry.model, entry.sessionId, tokens.input, tokens.output, tokens.cacheRead, tokens.cacheWrite);
  }
}
