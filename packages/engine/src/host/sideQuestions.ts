import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { SIDE_QUESTION_BROWSE_VERSION, SIDE_QUESTION_HISTORY, SIDE_QUESTIONS_KEPT, type LogLevel, type SideQuestion, type SideQuestionEvent, type SideQuestionList } from '@switchboard/protocol';
import { compareVersions } from '../system/claudeInstall.ts';

/** What Claude Code's `side_question` request answers (`Query.askSideQuestion`, which the SDK has but doesn't declare). */
export interface SideAnswer {
  /** Null when there was nothing to answer from. */
  response: string | null;
  /** Claude Code wrote the answer itself: an API error, or the model trying to use a tool. */
  synthetic: boolean;
}

/** An earlier exchange, as Claude Code takes it with a new side question. */
export interface SideExchange {
  question: string;
  response: string;
}

/** The part of the SDK's Query a side question needs; it isn't in the SDK's types yet. */
interface SideQuestionQuery {
  askSideQuestion?(question: string, options?: { history?: SideExchange[]; signal?: AbortSignal }): Promise<SideAnswer | null>;
}

/**
 * Asks Claude Code a side question on a running process: a one-shot fork of the conversation without tools, which
 * Claude Code never writes to the session file and which runs beside a turn without touching it (spike 13).
 */
export async function askSideQuestion(query: unknown, question: string, history: SideExchange[], signal?: AbortSignal): Promise<SideAnswer> {
  const ask = (query as SideQuestionQuery).askSideQuestion;
  if (typeof ask !== 'function') throw new Error('This version of Claude Code can’t answer side questions. Update Claude Code.');
  const answer = await ask.call(query, question, { history, ...(signal ? { signal } : {}) });
  return answer ?? { response: null, synthetic: false };
}

/** The text to show for an answer, or why there is none (an error, which isn't kept). */
export function readAnswer(answer: SideAnswer): { answer: string } | { error: string } {
  const text = answer.response?.trim() ?? '';
  if (!text) return { error: 'Claude had nothing to answer from yet.' };
  // Claude Code puts its own messages in parentheses: "(API error: …)", "(The model tried to call Bash instead of …)".
  if (answer.synthetic) return { error: text.replace(/^\((.*)\)$/s, '$1') };
  return { answer: text };
}

interface Row {
  id: string;
  question: string;
  answer: string;
  at: number;
}

/**
 * Side questions per session, kept in `side_questions` (your own questions, not derived from ~/.claude) so they
 * survive a reload of the window and a restart of the app. Only the last `SIDE_QUESTIONS_KEPT` per session stay.
 */
export class SideQuestionStore {
  private readonly statements;

  constructor(db: DatabaseSync) {
    this.statements = {
      list: db.prepare('SELECT id, question, answer, at FROM side_questions WHERE session_id = ? ORDER BY at, rowid'),
      insert: db.prepare('INSERT OR REPLACE INTO side_questions (id, session_id, question, answer, at) VALUES (?, ?, ?, ?, ?)'),
      trim: db.prepare('DELETE FROM side_questions WHERE session_id = ? AND id NOT IN (SELECT id FROM side_questions WHERE session_id = ? ORDER BY at DESC, rowid DESC LIMIT ?)'),
      forget: db.prepare('DELETE FROM side_questions WHERE session_id = ?'),
    };
  }

  /** A session's side questions, oldest first. */
  list(sessionId: string): SideQuestion[] {
    return (this.statements.list.all(sessionId) as unknown as Row[]).map((row) => ({ id: row.id, question: row.question, answer: row.answer, at: row.at }));
  }

  /** Keeps an answered side question; the oldest go once a session has more than it keeps. */
  add(sessionId: string, entry: SideQuestion): void {
    this.statements.insert.run(entry.id, sessionId, entry.question, entry.answer, entry.at);
    this.statements.trim.run(sessionId, sessionId, SIDE_QUESTIONS_KEPT);
  }

  /** The last exchanges, oldest first, to send along with a new question. */
  history(sessionId: string): SideExchange[] {
    return this.list(sessionId)
      .slice(-SIDE_QUESTION_HISTORY)
      .map((entry) => ({ question: entry.question, response: entry.answer }));
  }

  forget(sessionId: string): void {
    this.statements.forget.run(sessionId);
  }
}

/**
 * The answer the smoke test and the screenshots get instead of asking Claude Code: they must never call a model.
 * A few words in the question pick an answer that fits the demo world's conversations.
 */
export function stubAnswer(question: string): string {
  if (/\bcent\b|round/i.test(question)) {
    return 'Tax was added to the subtotal as a fraction of a cent and never rounded, so `59.97 × 1.21` came to `7256.37` cents. Claude now rounds the tax once per invoice, half up, in `src/invoice.ts`, and is running the PAY-212 test.';
  }
  if (/flag/i.test(question)) {
    return 'It was `--cleanStart`. You added it in the first turn so the beta publish skips the cache, and #210 confirmed it works with beta `3746232`.';
  }
  return [
    'Three files changed since the last commit:',
    '',
    '- `apps/ui/src/state/sidebarRows.ts`: archive days instead of 48 hours',
    '- `packages/protocol/src/bridge.ts`: the two new preferences',
    '- `apps/ui/src/components/SettingsView.tsx`: the Sessions page',
    '',
    'The engine changes are not made yet. Claude is still working on the scheduler in this turn, so check again when it ends.',
  ].join('\n');
}

/** Splits a stubbed answer into word-sized pieces, so it comes in the way a streamed one would. */
export function stubPieces(answer: string): string[] {
  return answer.match(/\S+\s*|\s+/g) ?? [answer];
}

export interface SideQuestionDeps {
  store: SideQuestionStore;
  /** Asks Claude Code (the session's process, or a short-lived copy of it). */
  ask(sessionId: string, question: string, history: SideExchange[]): Promise<SideAnswer>;
  /** Sends an answer's progress to the windows. */
  emit(event: SideQuestionEvent): void;
  /** The installed Claude Code's version, null while unknown. */
  claudeVersion(): string | null;
  /** Answer with `stubAnswer` instead of asking Claude Code (the smoke test and the screenshots). */
  stub?: boolean;
  /** Time between the stub's pieces. */
  stubDelayMs?: number;
  log(level: LogLevel, message: string): void;
}

/**
 * Side questions (`/btw`): asks them beside whatever the session is doing and keeps the answers. Nothing here
 * touches the session's turn, its Up next, its transcript or its status, and no notification follows an answer.
 */
export class SideQuestions {
  constructor(private readonly deps: SideQuestionDeps) {}

  /** Starts answering; the answer comes through `emit` with the returned id. */
  ask(sessionId: string, question: string): { id: string; at: number } {
    const id = randomUUID();
    const at = Date.now();
    void this.answer(sessionId, id, question, at);
    return { id, at };
  }

  /** A session's kept side questions; on a Claude Code that can't show earlier ones, none (`unsupported`). */
  list(sessionId: string): SideQuestionList {
    const version = this.deps.claudeVersion();
    // An unknown version (not found yet, or not readable) isn't held against it.
    if (!this.deps.stub && version && compareVersions(version, SIDE_QUESTION_BROWSE_VERSION) < 0) return { items: [], unsupported: true };
    return { items: this.deps.store.list(sessionId), unsupported: false };
  }

  private async answer(sessionId: string, id: string, question: string, at: number): Promise<void> {
    let result: { answer: string } | { error: string };
    try {
      if (this.deps.stub) result = { answer: await this.stream(sessionId, id, stubAnswer(question)) };
      else {
        result = readAnswer(await this.deps.ask(sessionId, question, this.deps.store.history(sessionId)));
        if ('answer' in result) this.deps.emit({ sessionId, id, delta: result.answer });
      }
    } catch (error) {
      result = { error: error instanceof Error ? error.message : String(error) };
    }
    if ('error' in result) {
      this.deps.log('warn', `Side question in ${sessionId} failed: ${result.error}`);
      this.deps.emit({ sessionId, id, done: true, error: result.error });
      return;
    }
    try {
      this.deps.store.add(sessionId, { id, question, answer: result.answer, at });
    } catch (error) {
      // The answer is still shown; it just won't be there after a restart.
      this.deps.log('warn', `Keeping a side question failed: ${(error as Error).message}`);
    }
    this.deps.emit({ sessionId, id, done: true });
  }

  /** Sends the stub's answer in pieces, as a streamed answer would come. */
  private async stream(sessionId: string, id: string, answer: string): Promise<string> {
    for (const piece of stubPieces(answer)) {
      await new Promise((resolve) => setTimeout(resolve, this.deps.stubDelayMs ?? 30));
      this.deps.emit({ sessionId, id, delta: piece });
    }
    return answer;
  }
}
