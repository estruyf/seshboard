import type { DatabaseSync } from 'node:sqlite';
import { withoutContext, type SearchHit, type TranscriptMessage } from '@switchboard/protocol';
import type { SessionSource } from '../claude/sessionSource.ts';
import { normaliseMessage } from '../claude/transcript.ts';

const SYSTEM_REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const MAX_TEXT = 20_000;
/** Marks the highlighted words in snippets (control characters never appear in prose). */
export const MARK_START = '\u0002';
export const MARK_END = '\u0003';

/**
 * What a message says, for searching: your prompts and Claude's replies. Tool
 * calls and their output, command markup and system reminders are left out.
 */
export function searchableText(message: TranscriptMessage): string | null {
  if (message.role === 'system') return null;
  const text = message.blocks
    .flatMap((b) => (b.type === 'text' ? [b.text] : []))
    .join('\n\n')
    .replace(SYSTEM_REMINDER, '')
    .trim();
  if (!text) return null;
  if (message.role === 'user') {
    // Slash commands keep their name and arguments; command output and interrupts are skipped.
    const command = /<command-name>([\s\S]*?)<\/command-name>/.exec(text);
    if (command) return `${command[1]!.trim()} ${/<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim() ?? ''}`.trim();
    if (/^<local-command|^\[Request interrupted/.test(text)) return null;
    // A linked session's brief belongs to that session, and an issue's text to GitHub: searching finds their words there.
    const typed = withoutContext(text);
    return typed ? typed.slice(0, MAX_TEXT) : null;
  }
  return text.slice(0, MAX_TEXT);
}

/**
 * Turns what you type into an FTS5 query: every word must appear, the last one
 * as a prefix ("deplo" finds "deploy"). Quoting each word keeps FTS syntax out.
 */
export function toFtsQuery(input: string): string | null {
  const words = input.match(/[\p{L}\p{N}_]+/gu);
  if (!words?.length) return null;
  return words.map((w, i) => `"${w.replace(/"/g, '')}"${i === words.length - 1 ? '*' : ''}`).join(' ');
}

interface IndexedSession {
  id: string;
  /** Changes whenever the transcript does (its mtime and size). */
  version: string;
}

/**
 * Full-text index of every transcript. Sessions are (re)indexed one at a time in
 * the background whenever their transcript changed, so search stays current
 * without ever blocking the engine.
 */
export class SearchIndex {
  private readonly statements;
  private running: Promise<void> | null = null;
  private again = false;
  private pending: IndexedSession[] = [];
  progress = { indexed: 0, total: 0 };

  constructor(
    db: DatabaseSync,
    private readonly source: SessionSource,
    private readonly sessions: () => IndexedSession[],
    private readonly log: (level: 'debug' | 'warn', message: string) => void,
    /** Each transcript as it was read for indexing, for what else is read from it (the pull requests a session opened). */
    private readonly onRead?: (sessionId: string, messages: readonly TranscriptMessage[]) => void,
  ) {
    this.statements = {
      versions: db.prepare('SELECT session_id, version FROM transcript_indexed'),
      clear: db.prepare('DELETE FROM transcript_fts WHERE session_id = ?'),
      insert: db.prepare('INSERT INTO transcript_fts (session_id, uuid, role, at, text) VALUES (?, ?, ?, ?, ?)'),
      mark: db.prepare('INSERT OR REPLACE INTO transcript_indexed (session_id, version) VALUES (?, ?)'),
      forget: db.prepare('DELETE FROM transcript_indexed WHERE session_id = ?'),
      search: db.prepare(
        `SELECT session_id AS sessionId, uuid AS messageUuid, role, at,
                snippet(transcript_fts, 4, '${MARK_START}', '${MARK_END}', '…', 18) AS snippet
         FROM transcript_fts WHERE transcript_fts MATCH ? ORDER BY bm25(transcript_fts) LIMIT ?`,
      ),
      searchIn: db.prepare(
        `SELECT session_id AS sessionId, uuid AS messageUuid, role, at,
                snippet(transcript_fts, 4, '${MARK_START}', '${MARK_END}', '…', 18) AS snippet
         FROM transcript_fts WHERE transcript_fts MATCH ? AND session_id IN (SELECT value FROM json_each(?))
         ORDER BY bm25(transcript_fts) LIMIT ?`,
      ),
    };
    this.begin = db.prepare('BEGIN');
    this.commit = db.prepare('COMMIT');
    this.rollback = db.prepare('ROLLBACK');
  }

  private readonly begin;
  private readonly commit;
  private readonly rollback;

  /** Indexes whatever changed since last time. Calls while running queue one more pass. */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.pass()
      .catch((error: Error) => this.log('warn', `Search indexing stopped: ${error.message}`))
      .finally(() => {
        this.running = null;
        if (this.again) {
          this.again = false;
          void this.sync();
        }
      });
    return this.running;
  }

  private async pass(): Promise<void> {
    const indexed = new Map((this.statements.versions.all() as Array<{ session_id: string; version: string }>).map((r) => [r.session_id, r.version]));
    const current = this.sessions();
    const live = new Set(current.map((s) => s.id));
    for (const id of indexed.keys()) {
      if (live.has(id)) continue;
      this.statements.clear.run(id);
      this.statements.forget.run(id);
    }
    // Newest first, so recent conversations are searchable soonest.
    this.pending = current.filter((s) => indexed.get(s.id) !== s.version);
    this.progress = { indexed: current.length - this.pending.length, total: current.length };
    for (const session of this.pending) {
      await this.indexSession(session);
      this.progress.indexed++;
      // Let other work (RPC calls, file watching) run between sessions.
      await new Promise((resolve) => setImmediate(resolve));
    }
    this.pending = [];
  }

  private async indexSession(session: IndexedSession): Promise<void> {
    let messages: TranscriptMessage[];
    try {
      messages = (await this.source.messages(session.id)).map((m) => normaliseMessage(m));
    } catch (error) {
      this.log('debug', `Could not index ${session.id}: ${(error as Error).message}`);
      return;
    }
    this.begin.run();
    try {
      this.statements.clear.run(session.id);
      for (const message of messages) {
        const text = searchableText(message);
        if (text) this.statements.insert.run(session.id, message.uuid, message.role, message.timestamp, text);
      }
      this.statements.mark.run(session.id, session.version);
      this.commit.run();
    } catch (error) {
      this.rollback.run();
      throw error;
    }
    try {
      this.onRead?.(session.id, messages);
    } catch (error) {
      this.log('debug', `Reading ${session.id} after indexing failed: ${(error as Error).message}`);
    }
  }

  /**
   * The best matches, at most `limit`. `only` keeps them to those sessions; it is applied before the limit,
   * so sessions left out (other apps', with "Switchboard sessions only") can't take every place.
   */
  search(input: string, limit: number, only?: Iterable<string>): SearchHit[] {
    const query = toFtsQuery(input);
    if (!query) return [];
    try {
      if (only) return this.statements.searchIn.all(query, JSON.stringify([...only]), limit) as unknown as SearchHit[];
      return this.statements.search.all(query, limit) as unknown as SearchHit[];
    } catch (error) {
      this.log('debug', `Search for ${JSON.stringify(input)} failed: ${(error as Error).message}`);
      return [];
    }
  }
}
