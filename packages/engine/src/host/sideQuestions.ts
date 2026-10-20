import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ASK_THREADS_KEPT, threadTitle, type AskEvent, type AskItem, type AskThread, type AskThreadList, type LogLevel, type TokenCounts } from '@switchboard/protocol';

/*
 * Ask about this session (and `/btw`, which asks the same way): questions about a session that Claude answers from
 * its conversation and the project, with read-only tools, without anything reaching the conversation.
 *
 * Claude Code's own side question (`Query.askSideQuestion`, spike 13) has no tools, doesn't stream and reports no
 * tokens, so a question is answered by a short-lived fork of the session instead (spike 14): `resume` with
 * `forkSession` and `persistSession: false`, so nothing is written to the session or anywhere else, with the
 * question as its prompt. It keeps the session's tools (so the prompt cache still matches) and a PreToolUse hook
 * lets only reading through.
 */

/** An earlier question and its answer in the same thread, sent along with a follow-up. */
export interface AskExchange {
  question: string;
  answer: string;
}

/** Earlier exchanges of a thread that go along with a follow-up. */
export const ASK_HISTORY = 20;

/** Tools that only read. */
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS']);
/** `git status`, `diff`, `log` or `show`, without anything a shell would run or redirect. */
const READ_GIT = /^git[ \t]+(?:--no-pager[ \t]+)?(?:status|diff|log|show)(?:[ \t]+[^;&|`$<>()\\\n\r]*)?$/;

/** Whether a tool call only reads: Read, Grep, Glob, or a git status, diff, log or show that writes no file. */
export function isReadOnlyTool(name: string, input: Record<string, unknown>): boolean {
  if (READ_TOOLS.has(name)) return true;
  if (name !== 'Bash') return false;
  const command = typeof input.command === 'string' ? input.command.trim() : '';
  // `--output` writes the diff or log to a file.
  return READ_GIT.test(command) && !/[ \t]--output\b/.test(command);
}

/** What Claude is told when it tries anything else. */
export const READ_ONLY_REASON = 'Questions about the session can only read: read files, search, and run git status, diff, log or show. Nothing else is allowed.';

/**
 * The prompt the fork gets: the session's conversation is already in it, so this frames the question as one asked
 * on the side (and says that a turn may still be running), with the thread's earlier questions and answers.
 */
export function askPrompt(question: string, history: readonly AskExchange[]): string {
  const parts = [
    '<side-question>',
    'The user is asking a question about this session on the side, in a panel next to the conversation. Answer it from the conversation so far and the project. Claude may still be working on a turn: a tool call without a result is still running, not interrupted.',
    'You can read files, search, and run git status, diff, log or show. Do not change anything, do not run other commands, and do not carry on with the task. Answer the question directly and keep it short.',
  ];
  if (history.length) {
    parts.push('', 'Earlier questions in this thread, with your answers:');
    for (const exchange of history) parts.push('', `Question: ${exchange.question}`, `Answer: ${exchange.answer}`);
  }
  parts.push('</side-question>', '', question);
  return parts.join('\n');
}

interface ThreadRow {
  id: string;
  title: string;
  created_at: number;
}

interface ItemRow {
  id: string;
  thread_id: string;
  question: string;
  answer: string;
  at: number;
  error: string | null;
}

const toItem = (row: ItemRow): AskItem => ({ id: row.id, question: row.question, answer: row.answer, at: row.at, ...(row.error ? { error: row.error } : {}) });

/**
 * Threads per session, kept in `ask_threads` and `side_questions` (your own questions, not derived from ~/.claude)
 * so they survive a reload and a restart. Only the last `ASK_THREADS_KEPT` threads of a session stay.
 */
export class AskStore {
  private readonly statements;

  constructor(private readonly db: DatabaseSync) {
    this.statements = {
      threads: db.prepare('SELECT id, title, created_at FROM ask_threads WHERE session_id = ? ORDER BY created_at DESC, rowid DESC'),
      thread: db.prepare('SELECT session_id FROM ask_threads WHERE id = ?'),
      items: db.prepare('SELECT id, thread_id, question, answer, at, error FROM side_questions WHERE session_id = ? ORDER BY at, rowid'),
      threadItems: db.prepare('SELECT id, thread_id, question, answer, at, error FROM side_questions WHERE thread_id = ? ORDER BY at, rowid'),
      addThread: db.prepare('INSERT OR IGNORE INTO ask_threads (id, session_id, title, created_at) VALUES (?, ?, ?, ?)'),
      addItem: db.prepare('INSERT OR REPLACE INTO side_questions (id, session_id, thread_id, question, answer, at, error) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      removeItem: db.prepare('DELETE FROM side_questions WHERE id = ? AND thread_id = ?'),
      old: db.prepare('SELECT id FROM ask_threads WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?'),
      dropThread: db.prepare('DELETE FROM ask_threads WHERE id = ?'),
      dropItems: db.prepare('DELETE FROM side_questions WHERE thread_id = ?'),
      forgetThreads: db.prepare('DELETE FROM ask_threads WHERE session_id = ?'),
      forgetItems: db.prepare('DELETE FROM side_questions WHERE session_id = ?'),
      usage: db.prepare(
        'INSERT OR REPLACE INTO side_question_usage (id, scope, session_id, at, model, input, output, cache_read, cache_write) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ),
    };
  }

  /** A session's threads with their questions, newest thread first. */
  threads(sessionId: string): AskThread[] {
    const items = new Map<string, AskItem[]>();
    for (const row of this.statements.items.all(sessionId) as unknown as ItemRow[]) {
      const list = items.get(row.thread_id) ?? [];
      list.push(toItem(row));
      items.set(row.thread_id, list);
    }
    return (this.statements.threads.all(sessionId) as unknown as ThreadRow[]).map((row) => ({ id: row.id, title: row.title, createdAt: row.created_at, items: items.get(row.id) ?? [] }));
  }

  /** Whether a thread exists for this session. */
  has(sessionId: string, threadId: string): boolean {
    return (this.statements.thread.get(threadId) as { session_id: string } | undefined)?.session_id === sessionId;
  }

  /** Starts a thread; the oldest go once the session has more than it keeps. */
  addThread(sessionId: string, thread: { id: string; title: string; createdAt: number }): void {
    this.statements.addThread.run(thread.id, sessionId, thread.title, thread.createdAt);
    for (const { id } of this.statements.old.all(sessionId, ASK_THREADS_KEPT) as Array<{ id: string }>) {
      this.statements.dropItems.run(id);
      this.statements.dropThread.run(id);
    }
  }

  /** Keeps an answered (or failed) question in its thread. */
  addItem(sessionId: string, threadId: string, item: AskItem): void {
    this.statements.addItem.run(item.id, sessionId, threadId, item.question, item.answer, item.at, item.error ?? null);
  }

  /** Drops a failed question that is asked again. */
  removeItem(threadId: string, id: string): void {
    this.statements.removeItem.run(id, threadId);
  }

  /** The thread's last answered exchanges, oldest first, to send along with a follow-up. */
  history(threadId: string): AskExchange[] {
    return (this.statements.threadItems.all(threadId) as unknown as ItemRow[])
      .filter((row) => !row.error && row.answer)
      .slice(-ASK_HISTORY)
      .map((row) => ({ question: row.question, answer: row.answer }));
  }

  /**
   * Keeps what an answer used, on the usage scope of the session's profile: the fork that answers leaves no
   * transcript, so the Usage scanner never sees these tokens, and Usage shows them as their own row. Kept after the
   * session is deleted, like any tokens already used.
   */
  recordUsage(scope: string, sessionId: string, id: string, at: number, usage: readonly AskUsage[]): void {
    for (const { model, tokens } of usage) this.statements.usage.run(`${id}:${model}`, scope, sessionId, at, model, tokens.input, tokens.output, tokens.cacheRead, tokens.cacheWrite);
  }

  forget(sessionId: string): void {
    this.statements.forgetItems.run(sessionId);
    this.statements.forgetThreads.run(sessionId);
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
  if (/which test/i.test(question)) {
    return 'PAY-212 in `src/invoice.test.ts`: a cart of `59.97` at 21% tax must come to `72.56`. Claude added it in this turn and is running it now.';
  }
  if (/flag/i.test(question)) {
    return 'It was `--cleanStart`. You added it in the first turn so the beta publish skips the cache, and #210 confirmed it works with beta `3746232`.';
  }
  if (/release script|and the release/i.test(question)) {
    return 'The release script is not touched. `scripts/release.ts` still reads the version from `apps/desktop/package.json`, so the new preferences need no change there.';
  }
  if (/left to do|what is left/i.test(question)) {
    return 'Two things are left: the scheduler in `packages/engine/src/archive.ts`, which Claude is writing now, and a test for the 30 day limit.';
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

/** Text coming in while Claude answers: more of the answer, or `reset` when it went on to read something first. */
export type AskText = { delta: string } | { reset: true };

/** What a fork's answer used, per model (one question can use more than one, a subagent's for instance). */
export interface AskUsage {
  model: string;
  tokens: TokenCounts;
}

/** How the fork's run ended. */
export interface AskResult {
  answer: string | null;
  /** Why there is no answer. */
  error?: string;
  usage: AskUsage[];
}

/** Steps (model calls) a question gets: enough to read a few files and the git history, not to wander off. */
export const ASK_MAX_TURNS = 12;
/** How long an answer may take, start included (a long conversation takes a while to load). */
export const ASK_TIMEOUT_MS = 300_000;

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * One API response's tokens from an assistant message the SDK streams, keyed by its message id; null without usage
 * or for a message Claude Code wrote itself (`<synthetic>`).
 */
export function readUsage(message: unknown): { key: string; model: string; tokens: TokenCounts } | null {
  const m = message as { id?: unknown; model?: unknown; usage?: Record<string, unknown> | null } | null;
  if (!m || typeof m.id !== 'string' || typeof m.model !== 'string' || m.model === '<synthetic>' || !m.usage) return null;
  const u = m.usage;
  return { key: m.id, model: m.model, tokens: { input: count(u.input_tokens), output: count(u.output_tokens), cacheRead: count(u.cache_read_input_tokens), cacheWrite: count(u.cache_creation_input_tokens) } };
}

/** Responses added up per model, leaving out models that used nothing. */
export function sumByModel(responses: readonly AskUsage[]): AskUsage[] {
  const totals = new Map<string, TokenCounts>();
  for (const { model, tokens } of responses) {
    const total = totals.get(model) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    total.input += tokens.input;
    total.output += tokens.output;
    total.cacheRead += tokens.cacheRead;
    total.cacheWrite += tokens.cacheWrite;
    totals.set(model, total);
  }
  return [...totals].filter(([, t]) => t.input + t.output + t.cacheRead + t.cacheWrite > 0).map(([model, tokens]) => ({ model, tokens }));
}

export interface AskerDeps {
  store: AskStore;
  /** Asks Claude Code: a short-lived fork of the session that writes nothing (`HostManager.ask`). */
  ask(sessionId: string, prompt: string, onText: (text: AskText) => void): Promise<AskResult>;
  /** Sends an answer's progress to the windows. */
  emit(event: AskEvent): void;
  /** Keeps what an answer used, for Usage's Side questions row. */
  recordUsage(sessionId: string, id: string, usage: readonly AskUsage[]): void;
  /** Answer with `stubAnswer` instead of asking Claude Code (the smoke test and the screenshots). */
  stub?: boolean;
  /** Time between the stub's pieces. */
  stubDelayMs?: number;
  log(level: LogLevel, message: string): void;
}

/**
 * Asks questions about a session beside whatever it is doing and keeps them in threads. Nothing here touches the
 * session's turn, its Up next, its transcript, its title or its status, and no notification follows an answer.
 */
export class Asker {
  constructor(private readonly deps: AskerDeps) {}

  /**
   * Starts answering, in `threadId` (a new thread without one, or when it is gone); the answer comes through
   * `emit` with the returned ids. `replaces` is a failed question in the thread that is asked again.
   */
  ask(sessionId: string, question: string, threadId?: string, replaces?: string): { threadId: string; id: string; at: number } {
    const id = randomUUID();
    const at = Date.now();
    let thread = threadId && this.deps.store.has(sessionId, threadId) ? threadId : null;
    if (!thread) {
      thread = randomUUID();
      this.deps.store.addThread(sessionId, { id: thread, title: threadTitle(question), createdAt: at });
    }
    if (replaces) this.deps.store.removeItem(thread, replaces);
    // Read now: a question asked right after this one doesn't wait for this answer.
    const history = this.deps.store.history(thread);
    void this.answer(sessionId, thread, id, question, at, history);
    return { threadId: thread, id, at };
  }

  /** A session's threads, newest first. */
  list(sessionId: string): AskThreadList {
    return { threads: this.deps.store.threads(sessionId) };
  }

  private async answer(sessionId: string, threadId: string, id: string, question: string, at: number, history: AskExchange[]): Promise<void> {
    let result: AskResult;
    const onText = (text: AskText) => this.deps.emit({ sessionId, threadId, id, ...text });
    try {
      result = this.deps.stub ? { answer: await this.stream(onText, stubAnswer(question)), usage: [] } : await this.deps.ask(sessionId, askPrompt(question, history), onText);
    } catch (error) {
      result = { answer: null, error: error instanceof Error ? error.message : String(error), usage: [] };
    }
    if (result.usage.length) {
      try {
        this.deps.recordUsage(sessionId, id, result.usage);
      } catch (error) {
        this.deps.log('warn', `Keeping a side question's tokens failed: ${(error as Error).message}`);
      }
    }
    const answer = result.answer?.trim() ?? '';
    const error = answer ? undefined : (result.error ?? 'Claude had nothing to answer.');
    if (error) this.deps.log('warn', `Side question in ${sessionId} failed: ${error}`);
    try {
      this.deps.store.addItem(sessionId, threadId, { id, question, answer, at, ...(error ? { error } : {}) });
    } catch (e) {
      // The answer is still shown; it just won't be there after a restart.
      this.deps.log('warn', `Keeping a side question failed: ${(e as Error).message}`);
    }
    this.deps.emit(error ? { sessionId, threadId, id, done: true, error } : { sessionId, threadId, id, done: true, answer });
  }

  /** Sends the stub's answer in pieces, as a streamed answer would come. */
  private async stream(onText: (text: AskText) => void, answer: string): Promise<string> {
    for (const piece of stubPieces(answer)) {
      await new Promise((resolve) => setTimeout(resolve, this.deps.stubDelayMs ?? 30));
      onText({ delta: piece });
    }
    return answer;
  }
}
