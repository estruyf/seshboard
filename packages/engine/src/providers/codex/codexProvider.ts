import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { LogLevel } from '@seshboard/protocol';
import type { DriverStatus, ProviderAdapter, ProviderFiles } from '../provider.ts';
import { AppServerError, createAppServer, type AppServer, type AppServerOptions, type CodexBinary } from './appServer.ts';
import { findCodex } from './codexBinary.ts';
import { codexMessages, codexSubagentThread } from './codexEvents.ts';
import { codexRolloutFiles, codexRolloutsOf, codexSessionsDir } from './codexFiles.ts';
import { codexDriver } from './codexDriver.ts';
import { codexForkTurn } from './codexFork.ts';
import { codexLocks, type LockHolders } from './codexInUse.ts';
import { codexSessionSource } from './codexSource.ts';
import type { GetAccountResponse } from './protocol.ts';

/** Continues a session in Codex CLI. */
export const CODEX_RESUME = 'codex resume {sessionId}';

/** Installs Codex CLI (OpenAI's own instructions). */
export const CODEX_INSTALL = 'npm install -g @openai/codex';

/** Codex CLI's data folder: `$CODEX_HOME`, else `~/.codex`. */
export function codexHome(env: NodeJS.ProcessEnv, home: string): string {
  return env.CODEX_HOME || join(home, '.codex');
}

const INSTALL = 'Install OpenAI Codex CLI to run Codex sessions here.';

/** A thread open elsewhere whose rollout was written this recently counts as working. */
const WORKING_MS = 15_000;

export interface CodexProviderOptions {
  /** The Codex profile this is (Settings › Profiles). */
  profileId: string;
  /** The profile's `CODEX_HOME`: its config, login and sessions. */
  codexHome: string;
  /** The user's home folder, where Codex's installers put it. */
  userHome: string;
  /** The login shell's environment, for finding and running `codex`. Without it, the process's own. */
  shellEnv?: () => Promise<Record<string, string | undefined>>;
  /** Where `codex` is (tests and the demo); found on PATH and in the usual places otherwise. */
  binary?: () => Promise<CodexBinary | null>;
  /** A fake `codex app-server` (tests). */
  createAppServer?: (options: AppServerOptions) => AppServer;
  /** Who has Codex's lock files open (tests); the system's answer otherwise (`codexInUse.ts`). */
  lockHolders?: LockHolders;
  log?: (level: LogLevel, message: string) => void;
}

const SIGN_IN = 'Not signed in to Codex CLI. Use Sign in on this profile in Settings › Profiles, or run `codex login`. Seshboard uses that login.';

/**
 * What `account/read` says, as Settings › Profiles shows it. Seshboard never reads `auth.json`. Its sessions are read
 * signed out too; running one needs the login, so signed out is the problem New session shows.
 */
export function codexAccountStatus(binary: CodexBinary, { account, requiresOpenaiAuth }: GetAccountResponse): DriverStatus {
  // A model provider that needs no OpenAI login (set in Codex's config) counts as signed in.
  const signedIn = account !== null || !requiresOpenaiAuth;
  const email = account?.type === 'chatgpt' ? account.email : null;
  return { binary: binary.path, version: binary.version, signedIn, account: email, login: email, problem: signedIn ? null : SIGN_IN };
}

/**
 * The rollout files as they are now: each one's path, size and time. Codex writes a thread's rollout on every turn and
 * moves it when it archives one, so an unchanged answer means an unchanged list (but for names, see `maxListAgeMs`).
 */
function rolloutChanges(files: ProviderFiles): string {
  const parts: string[] = [];
  for (const path of [...files.files().values()].sort()) {
    const stat = statSync(path, { throwIfNoEntry: false });
    parts.push(`${path}\0${stat?.size ?? -1}\0${stat?.mtimeMs ?? -1}`);
  }
  return parts.join('\n');
}

/**
 * One OpenAI Codex profile: its sessions listed, read and run through `codex app-server` (`codexDriver.ts`), started
 * with the profile's own `CODEX_HOME` and stopped when idle unless a session runs, and its rollout files
 * (`sessions/YYYY/MM/DD/rollout-*.jsonl`) watched for changes.
 */
export function codexProvider({ profileId, codexHome, userHome, shellEnv = async () => process.env, binary, createAppServer: create = createAppServer, lockHolders, log = () => {} }: CodexProviderOptions): ProviderAdapter {
  const folder = codexSessionsDir(codexHome);
  const lookup = binary ?? (async () => findCodex(await shellEnv(), userHome));
  // Kept once found (`codex --version` is a process of its own), and looked up again when it isn't there any more: until
  // found, each time, so installing Codex CLI works without restarting Seshboard.
  let found: CodexBinary | null = null;
  const findBinary = async () => (found ??= await lookup());
  const homeEnv = { CODEX_HOME: codexHome };
  // Made on the first request: a profile whose sessions are never read starts nothing.
  let made: AppServer | undefined;
  let disposed = false;
  // The experimental API is for Plan mode (`turn/start`'s `collaborationMode`); everything else is stable.
  const serverOptions: AppServerOptions = {
    // A thread closed here unloads at once (Codex waits a minute by default), so its lock goes with it and Codex CLI can
    // open it straight away.
    binary: async () => {
      const codex = await findBinary();
      return codex && { ...codex, args: [...(codex.args ?? []), '-c', 'thread_unload_delay_secs=0'] };
    },
    env: async () => ({ ...(await shellEnv()), ...homeEnv }),
    experimentalApi: true,
  };
  /** The process's client, made (not started) on first use. */
  const real = () => (made ??= create(serverOptions));
  const server: AppServer = {
    async request(method, params) {
      // Gone with its profile (or the app quits): nothing starts a server again that nobody would stop.
      if (disposed) throw new AppServerError('Codex app-server was disposed.', 'disposed');
      try {
        return await real().request(method, params);
      } catch (error) {
        if (error instanceof AppServerError && error.code === 'notInstalled') found = null;
        throw error;
      }
    },
    pid: () => made?.pid() ?? null,
    // After dispose these do nothing: nothing may start or keep a server that nobody would stop.
    onNotification: (listener) => (disposed ? () => {} : real().onNotification(listener)),
    handleRequests: (handler) => {
      if (!disposed) real().handleRequests(handler);
    },
    hold: () => (disposed ? () => {} : real().hold()),
    onExit: (listener) => (disposed ? () => {} : real().onExit(listener)),
    dispose: async () => {
      disposed = true;
      const running = made;
      made = undefined;
      await running?.dispose();
    },
  };
  /** Whether `codex` is there, and who it is signed in as (`account/read`). */
  const status = async (): Promise<DriverStatus> => {
    const codex = await findBinary().catch(() => null);
    if (!codex) return { binary: null, version: null, signedIn: false, account: null, login: null, problem: INSTALL };
    try {
      return codexAccountStatus(codex, await server.request('account/read', {}));
    } catch (error) {
      if (error instanceof AppServerError && error.code === 'notInstalled') return { binary: null, version: null, signedIn: false, account: null, login: null, problem: INSTALL };
      return { binary: codex.path, version: codex.version, signedIn: false, account: null, login: null, problem: (error as Error).message };
    }
  };
  const driver = codexDriver({ server, status, log });
  const files = codexRolloutFiles(folder);
  const source = codexSessionSource(server, { log, changes: () => rolloutChanges(files) });
  /** Which of `threadIds` another Codex has open (a terminal, the Codex app): its lock, held by a process not Seshboard's. */
  const locks = codexLocks(codexHome, lockHolders ? { holders: lockHolders } : {});
  const openElsewhere = (threadIds: readonly string[]) => {
    const pid = server.pid();
    return locks.openThreads(threadIds, new Set(pid === null ? [] : [pid]), driver.threads());
  };
  /** Each open thread's rollout file, found once: the live scan asks every few seconds. */
  const rollouts = new Map<string, string>();
  const rolloutOf = (threadId: string) => {
    const known = rollouts.get(threadId);
    if (known && statSync(known, { throwIfNoEntry: false })) return known;
    const found = codexRolloutsOf(codexHome, threadId).find((p) => p.endsWith('.jsonl'));
    if (found) rollouts.set(threadId, found);
    else rollouts.delete(threadId);
    return found ?? null;
  };
  return {
    id: 'codex',
    profileId,
    home: codexHome,
    homeEnv,
    folder,
    files,
    source: {
      ...source,
      // Codex forks at the end of a turn: the message's whole turn goes with it (`codexForkTurn`).
      async fork(sessionId, upToMessageId) {
        const [turns, from] = await Promise.all([source.turns(sessionId), source.thread(sessionId)]);
        const turn = codexForkTurn(turns, upToMessageId);
        if (!turn) throw new Error('Codex can only fork at one of its own messages');
        // On its source's model: a fork otherwise takes Codex's default.
        const forked = await driver.fork(sessionId, turn, from?.model ?? null);
        source.remember(forked);
        return forked;
      },
    },
    resumeCommand: CODEX_RESUME,
    signInCommand: 'codex login',
    driver,
    inUse: async (sessionId) => (await openElsewhere([sessionId])).has(sessionId),
    /**
     * Threads another Codex has open, from their locks. Codex writes its rollout as it works, so one written in the last
     * few seconds is working, else between turns; whether it waits on an approval doesn't show in a file it appends to.
     */
    async live(sessionIds) {
      const open = await openElsewhere(sessionIds);
      const now = Date.now();
      return [...open].map((sessionId) => {
        const path = rolloutOf(sessionId);
        const written = path ? (statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? null) : null;
        return { sessionId, pid: 0, status: written !== null && now - written < WORKING_MS ? ('running' as const) : ('idle' as const), updatedAt: written === null ? null : Math.round(written) };
      });
    },
    async subagent(sessionId, toolUseId) {
      const threadId = codexSubagentThread(await source.turns(sessionId), toolUseId);
      // Codex doesn't name a subagent's type in a way that is verified yet.
      return { agentType: null, messages: threadId ? codexMessages(await source.turns(threadId)) : [] };
    },
    // The thread's rollout file (both spellings while Codex compresses it, and the archived one), nothing else.
    trashPaths: (sessionId) => codexRolloutsOf(codexHome, sessionId),
    dispose: () => server.dispose(),
  };
}
