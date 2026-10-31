import { homedir } from 'node:os';
import { join } from 'node:path';
import { earlierParts, joinParts, readTranscriptEntries, type TranscriptEntry } from './compactedHistory.ts';
import type { SessionOrigin, SessionProvider } from '@seshboard/protocol';
import type { RawSessionMessage } from './transcript.ts';

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
  /** Copies a session up to and including `upToMessageId` into a new one; returns its id. */
  fork?(sessionId: string, upToMessageId: string): Promise<string>;
  /** Sets the session's title the way Claude Code's `/rename` does, so the CLI shows it too. */
  rename?(sessionId: string, title: string): Promise<void>;
}

type Sdk = typeof import('@anthropic-ai/claude-agent-sdk');

/** Runs an SDK call with the right config folder (see ConfigDirLane). */
export type ConfigDirScope = <T>(fn: () => Promise<T>) => Promise<T>;

/** Sessions whose earlier parts are kept, so a compacted session that's running isn't re-read whole on every change. */
const EARLIER_CACHE = 4;

/**
 * Session source backed by the Claude Agent SDK. The SDK is loaded lazily so
 * importing it (about 1 MB of JS) never delays engine startup. `scope` points
 * the SDK at one profile's config folder for the duration of each call.
 */
export function sdkSessionSource(scope: ConfigDirScope = (fn) => fn()): SessionSource {
  let sdk: Promise<Sdk> | undefined;
  const load = () => (sdk ??= import('@anthropic-ai/claude-agent-sdk'));
  // What came before a session's last compaction never changes, so it's kept per summary.
  const earlier = new Map<string, { summary: string; messages: RawSessionMessage[] }>();
  const messages = async (id: string): Promise<RawSessionMessage[]> => {
    const { getSessionMessages } = await load();
    const latest = (await getSessionMessages(id)) as RawSessionMessage[];
    const summary = latest.find((m) => m.isCompactSummary)?.uuid;
    if (!summary) return latest;
    let cached = earlier.get(id);
    if (cached?.summary !== summary) {
      // The reader only returns the conversation from the last compaction on: the earlier parts
      // come from the same reader, given the file's entries up to each compaction.
      const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
      const entries = await readTranscriptEntries(configDir, id, summary).catch(() => null);
      if (!entries) return latest;
      const read = async (part: TranscriptEntry[]) => (await getSessionMessages(id, { sessionStore: { append: async () => {}, load: async () => part } })) as RawSessionMessage[];
      cached = { summary, messages: await earlierParts(latest, entries, read).catch(() => []) };
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
