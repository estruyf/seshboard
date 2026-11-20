import { homedir } from 'node:os';
import { join } from 'node:path';
import { earlierParts, joinParts, readTranscriptEntries, type TranscriptEntry } from './compactedHistory.ts';
import { isSameOrInside, type SessionOrigin, type SessionProvider } from '@seshboard/protocol';
import type { RawSessionMessage } from './transcript.ts';
import type { TranscriptCache } from './transcriptCache.ts';

/** The subset of the SDK's SDKSessionInfo we use. */
export interface RawSessionInfo {
  sessionId: string;
  summary: string;
  lastModified: number;
  fileSize?: number;
  customTitle?: string;
  firstPrompt?: string;
  gitBranch?: string;
  cwd?: string;
  tag?: string;
  createdAt?: number;
  /** The Claude profile whose config folder holds the session (set by the multi-profile source). */
  profileId?: string;
  /** Set for another provider's session (Copilot): its source derived everything, so the index reads no Claude files. */
  provider?: Exclude<SessionProvider, 'claude'>;
  /** Where another provider's session was started (Claude Code's comes from the transcript's `entrypoint`). */
  origin?: SessionOrigin;
}

/**
 * Reads sessions. For Claude Code the SDK implementation is the only one that touches transcript formats; other
 * providers have their own (`providers/`).
 */
export interface SessionSource {
  list(): Promise<RawSessionInfo[]>;
  info(sessionId: string): Promise<RawSessionInfo | undefined>;
  messages(sessionId: string): Promise<RawSessionMessage[]>;
  subagentMessages?(sessionId: string, agentId: string): Promise<RawSessionMessage[]>;
  /**
   * Copies a session up to and including `upToMessageId` into a new one; returns its id. `editing`: the prompt Edit and
   * resend is for, the message after `upToMessageId` (a source that forks at turns forks just before it).
   */
  fork?(sessionId: string, upToMessageId: string, options?: { editing?: string }): Promise<string>;
  /** Sets the session's title the way Claude Code's `/rename` does, so the CLI shows it too. */
  rename?(sessionId: string, title: string): Promise<void>;
}

type Sdk = typeof import('@anthropic-ai/claude-agent-sdk');

/** Runs an SDK call with the right config folder (see ConfigDirLane). */
export type ConfigDirScope = <T>(fn: () => Promise<T>) => Promise<T>;

/** Sessions whose earlier parts are kept, so a compacted session that's running isn't re-read whole on every change. */
const EARLIER_CACHE = 4;

export interface SdkSourceOptions {
  /** Parsed transcripts shared by every reader (`TranscriptCache`); without it, each read reads the whole file. */
  cache?: TranscriptCache;
  /** The transcript file of a session, when known (the session index has it). */
  pathOf?: (sessionId: string) => string | null;
}

/**
 * Session source backed by the Claude Agent SDK. The SDK is loaded lazily so
 * importing it (about 1 MB of JS) never delays engine startup. `scope` points
 * the SDK at one profile's config folder for the duration of each call.
 */
export function sdkSessionSource(scope: ConfigDirScope = (fn) => fn(), options: SdkSourceOptions = {}): SessionSource {
  let sdk: Promise<Sdk> | undefined;
  const load = () => (sdk ??= import('@anthropic-ai/claude-agent-sdk'));
  // What came before a session's last compaction never changes, so it's kept per summary.
  const earlier = new Map<string, { summary: string; messages: RawSessionMessage[] }>();
  const configDir = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  /** The SDK's reader, given the entries of a file instead of reading it. */
  const fromEntries = async (id: string, part: readonly TranscriptEntry[]) => {
    const { getSessionMessages } = await load();
    return (await getSessionMessages(id, { sessionStore: { append: async () => {}, load: async () => part as TranscriptEntry[] } })) as RawSessionMessage[];
  };
  /**
   * The latest part of the conversation, and the file's entries when they were read for it. Through the cache when the
   * file is known and in this profile's folder; else (and when that fails) the SDK reads the file itself.
   */
  const latestOf = async (id: string): Promise<{ latest: readonly RawSessionMessage[]; entries: readonly TranscriptEntry[] | null }> => {
    const path = options.cache && options.pathOf?.(id);
    if (path && isSameOrInside(path, join(configDir(), 'projects'))) {
      try {
        const latest = await options.cache!.read(id, path, (entries) => fromEntries(id, entries));
        return { latest, entries: options.cache!.entries(id, path) };
      } catch {
        // Gone or unreadable: the SDK finds the file itself, or says why it can't.
      }
    }
    const { getSessionMessages } = await load();
    return { latest: (await getSessionMessages(id)) as RawSessionMessage[], entries: null };
  };
  const messages = async (id: string): Promise<RawSessionMessage[]> => {
    const { latest, entries: read } = await latestOf(id);
    const summary = latest.find((m) => m.isCompactSummary)?.uuid;
    if (!summary) return [...latest];
    let cached = earlier.get(id);
    if (cached?.summary !== summary) {
      // The reader only returns the conversation from the last compaction on: the earlier parts
      // come from the same reader, given the file's entries up to each compaction.
      const entries = read ?? (await readTranscriptEntries(configDir(), id, summary).catch(() => null));
      if (!entries) return [...latest];
      cached = { summary, messages: await earlierParts(latest, entries, (part) => fromEntries(id, part)).catch(() => []) };
      earlier.delete(id);
      earlier.set(id, cached);
      if (earlier.size > EARLIER_CACHE) earlier.delete(earlier.keys().next().value!);
    }
    return joinParts(cached.messages, latest);
  };
  return {
    list: () => scope(async () => (await load()).listSessions()),
    info: (id) => scope(async () => (await load()).getSessionInfo(id)),
    messages: (id) => scope(() => messages(id)),
    subagentMessages: (id, agentId) => scope(async () => (await (await load()).getSubagentMessages(id, agentId)) as RawSessionMessage[]),
    fork: (id, upToMessageId) => scope(async () => (await (await load()).forkSession(id, { upToMessageId })).sessionId),
    rename: (id, title) => scope(async () => (await load()).renameSession(id, title)),
  };
}
