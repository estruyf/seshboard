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
  // The rollout file's size, for the archive clean-up's report. A thread without one has none to give.
  const fileSize = thread.path ? statSync(thread.path, { throwIfNoEntry: false })?.size : undefined;
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
}

export type CodexSessionSource = SessionSource & {
  /** One thread as Codex has it (a subagent's too); undefined when it can't be read. */
  thread(threadId: string): Promise<Thread | undefined>;
  /** A thread's turns, oldest first, with every item (`itemsView: 'full'`); empty when they can't be read. */
  turns(threadId: string): Promise<Turn[]>;
};

/**
 * Reads OpenAI Codex's sessions through `codex app-server` (`thread/list`, `thread/read`, `thread/turns/list`), never
 * from its files: Codex keeps paginated history in its own database. Lists without `useStateDbOnly`, so a rollout file
 * moved to the Trash takes its thread out of the list. A Codex that isn't installed, or a server that crashed or timed
 * out, leaves the sessions as they were last listed (none before the first list) and is logged once until it works again.
 */
export function codexSessionSource(server: AppServer, { log = () => {} }: CodexSourceOptions = {}): CodexSessionSource {
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

  const turns = (threadId: string) =>
    THREAD_ID.test(threadId)
      ? attempt(
          'reading a conversation',
          async () => {
            const all: Turn[] = [];
            let cursor: string | null = null;
            for (let page = 0; page < MAX_PAGES; page++) {
              const { data, nextCursor }: { data: Turn[]; nextCursor: string | null } = await server.request('thread/turns/list', { threadId, cursor, sortDirection: 'asc', itemsView: 'full' });
              all.push(...data);
              if (!nextCursor || nextCursor === cursor) break;
              cursor = nextCursor;
            }
            return all;
          },
          [] as Turn[],
        )
      : Promise.resolve([] as Turn[]);

  return {
    async list() {
      const threads = await attempt('listing sessions', listThreads, null);
      if (!threads) return lastList;
      const seen = new Set<string>();
      lastList = [];
      for (const t of threads) {
        const info = seen.has(t.id) ? undefined : codexSessionInfo(t);
        seen.add(t.id);
        if (info) lastList.push(info);
      }
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
