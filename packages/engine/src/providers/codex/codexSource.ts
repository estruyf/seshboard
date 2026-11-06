import { statSync } from 'node:fs';
import type { LogLevel, SessionOrigin } from '@seshboard/protocol';
import type { RawSessionInfo, SessionSource } from '../../claude/sessionSource.ts';
import type { RawSessionMessage } from '../../claude/transcript.ts';
import type { AppServer } from './appServer.ts';
import { codexMessages } from './codexEvents.ts';
import { THREAD_ID } from './codexFiles.ts';
import type { Thread, ThreadSourceKind, Turn } from './protocol.ts';

/** Every kind of thread but a subagent's: those open from their parent's tool call (the Agents panel). */
const SOURCE_KINDS: ThreadSourceKind[] = ['cli', 'vscode', 'exec', 'appServer', 'unknown'];

/** Threads asked for per page of `thread/list`. */
const PAGE_SIZE = 100;

/** A stop for a cursor that never ends (a Codex bug must not loop forever). */
const MAX_PAGES = 1_000;

/** Where a thread was started: by Seshboard (its `clientInfo.name`), else Codex's own source. */
export function codexOrigin(thread: Pick<Thread, 'originator' | 'source'>): SessionOrigin {
  if (thread.originator === 'seshboard') return 'app';
  if (thread.source === 'cli') return 'cli';
  if (thread.source === 'vscode') return 'ide';
  return 'unknown';
}

/** A subagent's own thread: it has a parent, or says it is one. */
const isSubagent = (thread: Thread) => !!thread.parentThreadId || (typeof thread.source === 'object' && thread.source !== null && 'subAgent' in thread.source);

/** A thread as a session in the sidebar; undefined for a subagent's, an ephemeral one, or one without a prompt yet. */
export function codexSessionInfo(thread: Thread): RawSessionInfo | undefined {
  if (isSubagent(thread) || thread.ephemeral) return undefined;
  const name = thread.name?.trim() || undefined;
  const preview = thread.preview?.trim() || undefined;
  if (!name && !preview) return undefined;
  // The rollout file's size, for the archive clean-up's report. A thread without one (or one that can't be read) has none.
  let fileSize: number | undefined;
  try {
    fileSize = thread.path ? statSync(thread.path, { throwIfNoEntry: false })?.size : undefined;
  } catch {
    fileSize = undefined;
  }
  return {
    sessionId: thread.id,
    provider: 'codex',
    summary: name ?? preview!,
    ...(name ? { customTitle: name } : {}),
    ...(preview ? { firstPrompt: preview } : {}),
    lastModified: thread.updatedAt * 1000,
    createdAt: thread.createdAt * 1000,
    ...(thread.cwd ? { cwd: thread.cwd } : {}),
    ...(thread.gitInfo?.branch ? { gitBranch: thread.gitInfo.branch } : {}),
    ...(fileSize !== undefined ? { fileSize } : {}),
    origin: codexOrigin(thread),
  };
}

export interface CodexSourceOptions {
  log?: (level: LogLevel, message: string) => void;
  /**
   * What the rollout files are now (their names, sizes and times). While it stays the same, a timed `list()` answers
   * from the last list instead of asking Codex, so an idle app-server isn't started again on every refresh.
   */
  changes?: () => string;
  /** How long a list is used while nothing changed: names set elsewhere don't touch the rollout files. */
  maxListAgeMs?: number;
  now?: () => number;
}

/** A list is asked again at least this often, even when no rollout file changed. */
const MAX_LIST_AGE_MS = 10 * 60_000;

export type CodexSessionSource = SessionSource & {
  /** One thread as Codex has it (a subagent's too); undefined when it can't be read. */
  thread(threadId: string): Promise<Thread | undefined>;
  /** A thread's turns, oldest first, with every item (`itemsView: 'full'`). Throws when they can't be read. */
  turns(threadId: string): Promise<Turn[]>;
};

/**
 * Reads OpenAI Codex's sessions through `codex app-server` (`thread/list`, `thread/read`, `thread/turns/list`), never
 * from its files: Codex keeps paginated history in its own database. Lists without `useStateDbOnly`, so a rollout file
 * moved to the Trash takes its thread out of the list. A Codex that isn't installed, or a server that crashed or timed
 * out, leaves the sessions as they were last listed (none before the first list) and is logged once until it works
 * again. A conversation that can't be read throws, so the transcript says so rather than show nothing.
 */
export function codexSessionSource(server: AppServer, { log = () => {}, changes, maxListAgeMs = MAX_LIST_AGE_MS, now = Date.now }: CodexSourceOptions = {}): CodexSessionSource {
  /** What failed and was logged: logged again only after it worked once. */
  const failing = new Set<string>();
  const attempt = async <T>(what: string, run: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      const result = await run();
      failing.delete(what);
      return result;
    } catch (error) {
      if (!failing.has(what)) log('warn', `Codex: ${what} failed: ${(error as Error).message}`);
      failing.add(what);
      return fallback;
    }
  };
  /** The last list that worked: a server that fails for a moment doesn't empty the sidebar. */
  let lastList: RawSessionInfo[] = [];
  /** When it was listed, and what the rollout files were then; null until a list worked. */
  let listed: { at: number; changes: string | null } | null = null;

  const listThreads = async (): Promise<Thread[]> => {
    const threads: Thread[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, nextCursor }: { data: Thread[]; nextCursor: string | null } = await server.request('thread/list', { cursor, limit: PAGE_SIZE, sortKey: 'updated_at', sortDirection: 'desc', sourceKinds: SOURCE_KINDS, archived: false });
      threads.push(...data);
      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }
    return threads;
  };

  const thread = (threadId: string) =>
    THREAD_ID.test(threadId) ? attempt('reading a thread', async () => (await server.request('thread/read', { threadId, includeTurns: false })).thread, undefined) : Promise.resolve(undefined);

  const turns = async (threadId: string): Promise<Turn[]> => {
    if (!THREAD_ID.test(threadId)) return [];
    const all: Turn[] = [];
    let cursor: string | null = null;
    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const { data, nextCursor }: { data: Turn[]; nextCursor: string | null } = await server.request('thread/turns/list', { threadId, cursor, sortDirection: 'asc', itemsView: 'full' });
        all.push(...data);
        if (!nextCursor || nextCursor === cursor) break;
        cursor = nextCursor;
      }
    } catch (error) {
      throw new Error(`Couldn't read this Codex session: ${(error as Error).message}`);
    }
    return all;
  };

  /** What the rollout files are now; null when that can't be told (then Codex is asked). */
  const changesNow = () => {
    try {
      return changes?.() ?? null;
    } catch {
      return null;
    }
  };

  return {
    async list() {
      const current = changesNow();
      if (listed && current !== null && current === listed.changes && now() - listed.at < maxListAgeMs) return lastList;
      const threads = await attempt('listing sessions', listThreads, null);
      if (!threads) return lastList;
      const seen = new Set<string>();
      const infos: RawSessionInfo[] = [];
      for (const t of threads) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        const info = codexSessionInfo(t);
        if (info) infos.push(info);
      }
      lastList = infos;
      listed = { at: now(), changes: current };
      return lastList;
    },
    async info(sessionId) {
      const found = await thread(sessionId);
      return found ? codexSessionInfo(found) : undefined;
    },
    async messages(sessionId): Promise<RawSessionMessage[]> {
      return codexMessages(await turns(sessionId));
    },
    thread,
    turns,
  };
}
