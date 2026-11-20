import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { withoutContext, type SearchHit, type TranscriptMessage } from '@seshboard/protocol';
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
  /** Changes whenever the transcript does (its time and size). */
  version: string;
  /** When its transcript was last written, if known: one written in the last `quietMs` waits until it is quiet. */
  writtenAt?: number | null;
}

/** What the index holds for a session: enough to add only the messages after it when the transcript just grew. */
interface Indexed {
  version: string;
  /** How many messages were read, and a hash of their uuids in order (null for rows written before these existed). */
  messages: number | null;
  prefix: string | null;
  /** The row of the last message, which is indexed again with the next messages (null when it had no text). */
  lastRowid: number | null;
}

export interface SearchIndexOptions {
  /** How long a transcript must go unwritten before it is indexed, unless its turn ended (`settled`). */
  quietMs?: number;
  now?: () => number;
}

/** Writes in a busy session come about every second: it is indexed once it is quiet this long, or when its turn ends. */
const QUIET_MS = 30_000;

/** The hash of the first `count` uuids, and of all of them. */
function prefixHashes(messages: readonly TranscriptMessage[], count: number): { prefix: string | null; all: string } {
  const hash = createHash('sha1');
  let prefix: string | null = count === 0 ? hash.copy().digest('hex') : null;
  messages.forEach((m, i) => {
    hash.update(`${m.uuid}\n`);
    if (i === count - 1) prefix = hash.copy().digest('hex');
  });
  return { prefix, all: hash.digest('hex') };
}

/**
 * Full-text index of every transcript. Sessions are (re)indexed one at a time in the background whenever their
 * transcript changed, so search stays current without ever blocking the engine. A session being written waits until
 * it is quiet or its turn ended, and a transcript that only grew gets its new messages added, not all of them again.
 */
export class SearchIndex {
  private readonly statements;
  private running: Promise<void> | null = null;
  private again = false;
  private pending: IndexedSession[] = [];
  /** Sessions whose turn ended: indexed at the next pass, written just now or not. */
  private readonly ended = new Set<string>();
  private retry: ReturnType<typeof setTimeout> | undefined;
  private readonly quietMs: number;
  private readonly now: () => number;
  progress = { indexed: 0, total: 0 };

  constructor(
    db: DatabaseSync,
    private readonly source: SessionSource,
    private readonly sessions: () => IndexedSession[],
    private readonly log: (level: 'debug' | 'warn', message: string) => void,
    /** Each transcript as it was read for indexing, for what else is read from it (the pull requests a session opened). */
    private readonly onRead?: (sessionId: string, messages: readonly TranscriptMessage[]) => void,
    options: SearchIndexOptions = {},
  ) {
    this.quietMs = options.quietMs ?? QUIET_MS;
    this.now = options.now ?? Date.now;
    this.statements = {
      versions: db.prepare('SELECT session_id, version, messages, prefix, last_rowid FROM transcript_indexed'),
      clear: db.prepare('DELETE FROM transcript_fts WHERE session_id = ?'),
      clearRow: db.prepare('DELETE FROM transcript_fts WHERE rowid = ?'),
      insert: db.prepare('INSERT INTO transcript_fts (session_id, uuid, role, at, text) VALUES (?, ?, ?, ?, ?)'),
      mark: db.prepare('INSERT OR REPLACE INTO transcript_indexed (session_id, version, messages, prefix, last_rowid) VALUES (?, ?, ?, ?, ?)'),
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

  /** The session's turn ended: the next pass indexes it, however recently it was written. */
  settled(sessionId: string): void {
    this.ended.add(sessionId);
  }

  stop(): void {
    clearTimeout(this.retry);
    this.retry = undefined;
  }

  private async pass(): Promise<void> {
    const indexed = new Map(
      (this.statements.versions.all() as Array<{ session_id: string; version: string; messages: number | null; prefix: string | null; last_rowid: number | null }>).map((r) => [
        r.session_id,
        { version: r.version, messages: r.messages, prefix: r.prefix, lastRowid: r.last_rowid } satisfies Indexed,
      ]),
    );
    const current = this.sessions();
    const live = new Set(current.map((s) => s.id));
    for (const id of indexed.keys()) {
      if (live.has(id)) continue;
      this.statements.clear.run(id);
      this.statements.forget.run(id);
    }
    for (const id of this.ended) if (!live.has(id)) this.ended.delete(id);
    // Newest first, so recent conversations are searchable soonest. One written just now waits until it is quiet.
    const now = this.now();
    const changed = current.filter((s) => indexed.get(s.id)?.version !== s.version);
    const busy = changed.filter((s) => !this.ended.has(s.id) && s.writtenAt != null && now - s.writtenAt < this.quietMs);
    this.pending = changed.filter((s) => !busy.includes(s));
    this.progress = { indexed: current.length - this.pending.length, total: current.length };
    if (busy.length) this.later(Math.min(...busy.map((s) => s.writtenAt! + this.quietMs)) - now);
    for (const session of this.pending) {
      this.ended.delete(session.id);
      await this.indexSession(session, indexed.get(session.id));
      this.progress.indexed++;
      // Let other work (RPC calls, file watching) run between sessions.
      await new Promise((resolve) => setImmediate(resolve));
    }
    this.pending = [];
  }

  /** Another pass once the busy sessions are quiet; the earliest wins. */
  private later(delayMs: number): void {
    if (this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = undefined;
      void this.sync();
    }, Math.max(0, delayMs) + 50);
    this.retry.unref?.();
  }

  private async indexSession(session: IndexedSession, known: Indexed | undefined): Promise<void> {
    let messages: TranscriptMessage[];
    try {
      messages = (await this.source.messages(session.id)).map((m) => normaliseMessage(m));
    } catch (error) {
      this.log('debug', `Could not index ${session.id}: ${(error as Error).message}`);
      return;
    }
    // The transcript only grew when the messages indexed before are still the first ones, in the same order. A
    // rewind, a compaction or a rewrite changes them, and the whole session is indexed again.
    const before = known?.messages ?? null;
    const hashes = prefixHashes(messages, before !== null && before <= messages.length ? before : -1);
    const grew = before !== null && known!.prefix !== null && hashes.prefix === known!.prefix;
    // The last message indexed is indexed again with the new ones, in case it was still being written.
    const from = grew ? Math.max(0, before - 1) : 0;
    this.begin.run();
    try {
      if (!grew) this.statements.clear.run(session.id);
      else if (known!.lastRowid !== null) this.statements.clearRow.run(known!.lastRowid);
      let lastRowid: number | null = null;
      for (let i = from; i < messages.length; i++) {
        const message = messages[i]!;
        const text = searchableText(message);
        if (!text) continue;
        const row = this.statements.insert.run(session.id, message.uuid, message.role, message.timestamp, text);
        if (i === messages.length - 1) lastRowid = Number(row.lastInsertRowid);
      }
      this.statements.mark.run(session.id, session.version, messages.length, hashes.all, lastRowid);
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
   * so sessions left out (other apps', with "Seshboard sessions only") can't take every place.
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
