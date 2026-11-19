import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { LogLevel } from '@seshboard/protocol';
import type { ProviderAdapter, ProviderFiles } from '../provider.ts';
import { createAcpConnection, type AcpConnection, type AcpConnectionOptions } from '../acp/acpConnection.ts';
import { codexLocks, systemLockHolders, type LockHolders } from '../codex/codexInUse.ts';
import { findAgy, type AgyBinary } from './agyBinary.ts';
import { agyDriver } from './agyDriver.ts';
import { agyBrainDir, agyFiles, agyLogFile, agyPresenceLock, agyTrashPaths } from './agyFiles.ts';
import { agySessionSource } from './agySource.ts';

/** Continues a session in Antigravity CLI. */
export const AGY_RESUME = 'agy --conversation {sessionId}';

/** Installs Antigravity CLI (Google's own instructions): PowerShell on Windows. */
export const agyInstall = (platform: NodeJS.Platform = process.platform) =>
  platform === 'win32' ? 'irm https://antigravity.google/cli/install.ps1 | iex' : 'curl -fsSL https://antigravity.google/cli/install.sh | bash';

/** Antigravity CLI's `--gemini-dir`: `~/.gemini` unless a profile names another. */
export const agyHome = (home: string) => join(home, '.gemini');

/** A conversation open elsewhere whose log was written this recently counts as working. */
const WORKING_MS = 15_000;

export interface AgyProviderOptions {
  /** The Antigravity profile this is (Settings › Profiles). */
  profileId: string;
  /** The profile's `--gemini-dir`: its sessions and settings. Antigravity's login is the system's, shared by every folder. */
  geminiDir: string;
  /** The user's home folder, where Antigravity's installer puts it. */
  userHome: string;
  /** The login shell's environment, for finding and running `agy`. */
  shellEnv?: () => Promise<Record<string, string | undefined>>;
  /** Where `agy` is (tests and the demo); found on PATH and in the usual places otherwise. */
  binary?: () => Promise<AgyBinary | null>;
  /** A fake `agy acp` (tests and the demo). */
  createConnection?: (options: AcpConnectionOptions) => AcpConnection;
  /** Who has Antigravity's presence locks open (tests); the system's answer otherwise. */
  lockHolders?: LockHolders;
  /** Moves paths to the Trash (Ask's throwaway session), checked by main like a deleted session's. */
  discard?: (paths: string[]) => Promise<void>;
  log?: (level: LogLevel, message: string) => void;
  /** A session's details changed without a file the watcher sees (a title Antigravity gave it): it is read again. */
  onSessionChanged?: (sessionId: string) => void;
}

/** The logs as they are now: each one's path, size and time. An unchanged answer means an unchanged list. */
function logChanges(files: ProviderFiles): string {
  const parts: string[] = [];
  for (const path of [...files.files().values()].sort()) {
    const stat = statSync(path, { throwIfNoEntry: false });
    parts.push(`${path}\0${stat?.size ?? -1}\0${stat?.mtimeMs ?? -1}`);
  }
  return parts.join('\n');
}

/**
 * One Google Antigravity profile: its sessions listed and read through one `agy acp` (`agySource.ts`), and run
 * through another (`agyDriver.ts`), so a read never takes a session that runs here. Both start with the profile's
 * `--gemini-dir` (none for the default folder) on the first request, and stop when idle unless a session runs. Each
 * conversation's step log (`brain/<id>/.system_generated/logs/transcript.jsonl`) is watched for changes.
 */
export function agyProvider({ profileId, geminiDir, userHome, shellEnv = async () => process.env, binary, createConnection = createAcpConnection, lockHolders, discard, log = () => {}, onSessionChanged }: AgyProviderOptions): ProviderAdapter {
  const lookup = binary ?? (async () => findAgy(await shellEnv(), userHome));
  // Kept once found (`agy --version` is a process of its own), and looked up again until then: installing it works
  // without restarting Seshboard.
  let found: AgyBinary | null = null;
  const findBinary = async () => (found ??= await lookup());
  const own = resolve(geminiDir) === resolve(agyHome(userHome));
  const connection = (): AcpConnection =>
    createConnection({
      agentName: 'Antigravity CLI',
      command: async () => {
        const agy = await findBinary();
        return agy && { path: agy.path, args: ['acp', ...(own ? [] : ['--gemini-dir', geminiDir])] };
      },
      env: shellEnv,
    });
  const reader = connection();
  const runner = connection();
  const files = agyFiles(geminiDir);
  const source = agySessionSource(reader, { geminiDir, log, changes: () => logChanges(files) });
  const driver = agyDriver({
    connection: runner,
    geminiDir,
    binary: findBinary,
    has: (sessionId) => source.has(sessionId),
    transcript: (sessionId) => source.messages(sessionId),
    ...(discard ? { discard: (sessionId: string) => discard(agyTrashPaths(geminiDir, sessionId)) } : {}),
    onTitle(sessionId, title) {
      source.named(sessionId, title);
      onSessionChanged?.(sessionId);
    },
    log,
  });
  // Where the system can't name who holds a lock (Windows), none counts: Antigravity may leave the file behind.
  const locks = codexLocks(geminiDir, { holders: lockHolders ?? systemLockHolders() ?? (async () => new Map()), lockFile: (id) => agyPresenceLock(geminiDir, id) });
  /** Which of `sessionIds` an Antigravity CLI has open: its presence lock, held by a process not Seshboard's. */
  const openElsewhere = (sessionIds: readonly string[]) => {
    const pids = [reader.pid(), runner.pid()].filter((pid): pid is number => pid !== null);
    return locks.openThreads(sessionIds, new Set(pids), driver.sessions());
  };
  return {
    id: 'antigravity',
    profileId,
    home: geminiDir,
    folder: agyBrainDir(geminiDir),
    files,
    source,
    resumeCommand: AGY_RESUME,
    // Antigravity's own Google sign in, then it exits; the login is the system's, for every folder.
    signInCommand: own ? 'agy acp --login' : `agy acp --login --gemini-dir "${geminiDir}"`,
    driver,
    inUse: async (sessionId) => (await openElsewhere([sessionId])).has(sessionId),
    /**
     * Conversations an Antigravity CLI has open, from their presence locks. It writes its log as it works, so one written
     * in the last few seconds is working, else between turns.
     */
    async live(sessionIds) {
      const open = await openElsewhere(sessionIds);
      const now = Date.now();
      return [...open].map((sessionId) => {
        const written = statSync(agyLogFile(geminiDir, sessionId), { throwIfNoEntry: false })?.mtimeMs ?? null;
        return { sessionId, pid: 0, status: written !== null && now - written < WORKING_MS ? ('running' as const) : ('idle' as const), updatedAt: written === null ? null : Math.round(written) };
      });
    },
    trashPaths: (sessionId) => agyTrashPaths(geminiDir, sessionId),
    dispose: async () => {
      await Promise.all([reader.dispose(), runner.dispose()]);
    },
  };
}
