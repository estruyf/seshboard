import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { LogLevel } from '@seshboard/protocol';
import type { RawSessionInfo, SessionSource } from '../../claude/sessionSource.ts';
import type { RawSessionMessage } from '../../claude/transcript.ts';
import type { AcpConnection } from '../acp/acpConnection.ts';
import { agyMessages } from './agyEvents.ts';
import { agyDataDir, agyLogFile, agyPromptTimes, SESSION_ID } from './agyFiles.ts';

/** A conversation as `session/list` gives it. */
export interface AgyListed {
  sessionId: string;
  cwd: string | null;
  title: string | null;
  updatedAt: number;
}

/** A stop for a cursor that never ends. */
const MAX_PAGES = 200;

/** A list is asked again at least this often, even when no conversation's log changed. */
const MAX_LIST_AGE_MS = 10 * 60_000;

/** How long `session/load` may take to replay a long conversation. */
const LOAD_TIMEOUT_MS = 120_000;

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** `session/list`'s entries, read loosely: one without an id is left out. */
export function parseList(result: unknown): { sessions: AgyListed[]; nextCursor: string | null } {
  const { sessions, nextCursor } = (result ?? {}) as { sessions?: unknown; nextCursor?: unknown };
  const out: AgyListed[] = [];
  for (const raw of Array.isArray(sessions) ? sessions : []) {
    const entry = (raw ?? {}) as Record<string, unknown>;
    const sessionId = str(entry.sessionId);
    if (!sessionId || !SESSION_ID.test(sessionId)) continue;
    const updated = Date.parse(str(entry.updatedAt) ?? '');
    out.push({ sessionId: sessionId.toLowerCase(), cwd: str(entry.cwd), title: str(entry.title)?.trim() || null, updatedAt: Number.isFinite(updated) ? updated : 0 });
  }
  return { sessions: out, nextCursor: str(nextCursor) };
}

/** A conversation as a session in the sidebar. Antigravity names each one itself; one it hasn't named yet is "Untitled". */
export function agySessionInfo(listed: AgyListed, geminiDir: string, title?: string | null): RawSessionInfo {
  let fileSize: number | undefined;
  try {
    fileSize = statSync(join(agyDataDir(geminiDir), 'conversations', `${listed.sessionId}.db`), { throwIfNoEntry: false })?.size;
  } catch {
    fileSize = undefined;
  }
  const name = title ?? listed.title;
  return {
    sessionId: listed.sessionId,
    provider: 'antigravity',
    summary: name ?? 'Untitled session',
    ...(name ? { customTitle: name } : {}),
    lastModified: listed.updatedAt,
    ...(listed.cwd ? { cwd: listed.cwd } : {}),
    ...(fileSize !== undefined ? { fileSize } : {}),
    // Antigravity records no client: the ones started here are marked by Seshboard (`owned_sessions`).
    origin: 'cli',
  };
}

export interface AgySourceOptions {
  /** The profile's `--gemini-dir`. */
  geminiDir: string;
  log?: (level: LogLevel, message: string) => void;
  /**
   * What the conversations' logs are now (their names, sizes and times). While it stays the same, `list()` answers from
   * the last list instead of asking Antigravity, so an idle `agy acp` isn't started again on every refresh.
   */
  changes?: () => string;
  maxListAgeMs?: number;
  now?: () => number;
}

export type AgySessionSource = SessionSource & {
  /** A title Antigravity gave a session while it runs here (`session_info_update`): the last list says so now. */
  named(sessionId: string, title: string): void;
  /** Whether Antigravity lists the session: `session/load` answers for any id, even one it doesn't have. */
  has(sessionId: string): Promise<boolean>;
};

/**
 * Reads Antigravity's conversations through `agy acp` (its own process, so a read never takes a session the driver
 * runs): `session/list` for the list, and `session/load` for a conversation, whose replay (`agyMessages`) comes as
 * updates before its answer, then `session/close`. One read at a time: a replay's updates are told apart only by their
 * session's id. An `agy` that isn't installed or fails keeps the last list (none before the first) and is logged once
 * until it works again. A conversation that can't be read throws, so the transcript says so.
 */
export function agySessionSource(connection: AcpConnection, { geminiDir, log = () => {}, changes, maxListAgeMs = MAX_LIST_AGE_MS, now = Date.now }: AgySourceOptions): AgySessionSource {
  const failing = new Set<string>();
  const attempt = async <T>(what: string, run: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      const result = await run();
      failing.delete(what);
      return result;
    } catch (error) {
      if (!failing.has(what)) log('warn', `Antigravity: ${what} failed: ${(error as Error).message}`);
      failing.add(what);
      return fallback;
    }
  };
  let lastList: AgyListed[] = [];
  let listed: { at: number; changes: string | null } | null = null;
  /** Titles given while a session ran here, newer than the last list. */
  const titles = new Map<string, string>();

  const changesNow = () => {
    try {
      return changes?.() ?? null;
    } catch {
      return null;
    }
  };

  const listAll = async (): Promise<AgyListed[]> => {
    const all: AgyListed[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const { sessions, nextCursor } = parseList(await connection.request('session/list', cursor ? { cursor } : {}));
      all.push(...sessions);
      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }
    return all;
  };

  /** The list, asked again when a log changed or it's old. */
  const current = async (force = false): Promise<AgyListed[]> => {
    const changed = changesNow();
    if (!force && listed && changed !== null && changed === listed.changes && now() - listed.at < maxListAgeMs) return lastList;
    const fresh = await attempt('listing sessions', listAll, null);
    if (!fresh) return lastList;
    lastList = fresh;
    listed = { at: now(), changes: changed };
    for (const entry of fresh) if (entry.title && titles.get(entry.sessionId) === entry.title) titles.delete(entry.sessionId);
    return lastList;
  };

  /** Reads are one at a time: a replay is told from another only by its session's id. */
  let queue: Promise<unknown> = Promise.resolve();
  const oneAtATime = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run);
    queue = next.catch(() => {});
    return next;
  };

  /** The last conversation read, by its log's size and time: a session reread for nothing (a title) isn't replayed again. */
  const cache = new Map<string, { stamp: string; messages: RawSessionMessage[] }>();
  const stampOf = (sessionId: string) => {
    const stat = statSync(agyLogFile(geminiDir, sessionId), { throwIfNoEntry: false });
    return stat ? `${stat.size}:${stat.mtimeMs}` : null;
  };

  const replay = (sessionId: string, cwd: string): Promise<unknown[]> =>
    oneAtATime(async () => {
      const updates: unknown[] = [];
      const off = connection.onNotification((method, params) => {
        const { sessionId: id, update } = (params ?? {}) as { sessionId?: unknown; update?: unknown };
        if (method === 'session/update' && id === sessionId && update) updates.push(update);
      });
      try {
        await connection.request('session/load', { sessionId, cwd, mcpServers: [] }, { timeoutMs: LOAD_TIMEOUT_MS });
      } finally {
        off();
        // Read, not run: let go of it at once, so nothing of it stays loaded in the reader.
        await connection.request('session/close', { sessionId }).catch(() => {});
      }
      return updates;
    });

  const find = async (sessionId: string, force = false) => (await current(force)).find((s) => s.sessionId === sessionId);

  return {
    async list() {
      return (await current()).map((entry) => agySessionInfo(entry, geminiDir, titles.get(entry.sessionId)));
    },
    async info(sessionId) {
      const entry = await find(sessionId);
      return entry ? agySessionInfo(entry, geminiDir, titles.get(sessionId)) : undefined;
    },
    async messages(sessionId) {
      if (!SESSION_ID.test(sessionId)) return [];
      const entry = (await find(sessionId)) ?? (await find(sessionId, true));
      // `session/load` answers for an id Antigravity doesn't have: only a listed one is read.
      if (!entry) return [];
      const stamp = stampOf(sessionId);
      const kept = cache.get(sessionId);
      if (stamp && kept?.stamp === stamp) return kept.messages;
      let updates: unknown[];
      try {
        updates = await replay(sessionId, entry.cwd ?? geminiDir);
      } catch (error) {
        throw new Error(`Couldn't read this Antigravity session: ${(error as Error).message}`);
      }
      const messages = agyMessages(sessionId, updates, { prompts: agyPromptTimes(agyLogFile(geminiDir, sessionId)), fallback: entry.updatedAt || now() });
      if (stamp) cache.set(sessionId, { stamp, messages });
      if (cache.size > 8) cache.delete(cache.keys().next().value!);
      return messages;
    },
    named(sessionId, title) {
      titles.set(sessionId, title);
    },
    async has(sessionId) {
      return !!((await find(sessionId)) ?? (await find(sessionId, true)));
    },
  };
}
