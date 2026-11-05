import type { DatabaseSync } from 'node:sqlite';
import type { ActivitySummary } from '@seshboard/protocol';

export interface StoredSummary extends ActivitySummary {
  /** What it was written from. */
  inputHash: string;
  /** Written after the day was over: it stays until you ask for another. */
  final: boolean;
}

/** The day in short, kept per day (`activity_summaries`). Each costs a call to Haiku: a rebuild keeps them. */
export class ActivityStore {
  private readonly statements;

  constructor(db: DatabaseSync) {
    this.statements = {
      get: db.prepare('SELECT text, generated_at AS generatedAt, sessions, input_hash AS inputHash, final FROM activity_summaries WHERE day = ?'),
      save: db.prepare('INSERT OR REPLACE INTO activity_summaries (day, text, generated_at, sessions, input_hash, final) VALUES (?, ?, ?, ?, ?, ?)'),
    };
  }

  get(day: string): StoredSummary | null {
    const row = this.statements.get.get(day) as (Omit<StoredSummary, 'final'> & { final: number }) | undefined;
    return row ? { ...row, final: row.final === 1 } : null;
  }

  save(day: string, summary: StoredSummary): void {
    this.statements.save.run(day, summary.text, summary.generatedAt, summary.sessions, summary.inputHash, summary.final ? 1 : 0);
  }
}
