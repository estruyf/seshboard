import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { LogLevel } from '@seshboard/protocol';
import type { DriverStatus, ProviderAdapter, ProviderFiles } from '../provider.ts';
import { AppServerError, createAppServer, type AppServer, type AppServerOptions, type CodexBinary } from './appServer.ts';
import { findCodex } from './codexBinary.ts';
import { codexMessages, codexSubagentThread } from './codexEvents.ts';
import { codexRolloutFiles, codexRolloutsOf, codexSessionsDir } from './codexFiles.ts';
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

const INSTALL = 'Install OpenAI Codex CLI to show its sessions here.';

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
  log?: (level: LogLevel, message: string) => void;
}

/**
 * What `account/read` says, as Settings › Profiles shows it. Seshboard never reads `auth.json`. Reading sessions needs
 * no login, so being signed out is no problem while Codex is read-only here (the profile still offers Sign in).
 */
export function codexAccountStatus(binary: CodexBinary, { account, requiresOpenaiAuth }: GetAccountResponse): DriverStatus {
  // A model provider that needs no OpenAI login (set in Codex's config) counts as signed in.
  const signedIn = account !== null || !requiresOpenaiAuth;
  const email = account?.type === 'chatgpt' ? account.email : null;
  return { binary: binary.path, version: binary.version, signedIn, account: email, login: email, problem: null };
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
 * One OpenAI Codex profile, read-only: its sessions listed and read through `codex app-server`, started with the
 * profile's own `CODEX_HOME` and stopped when idle, and its rollout files (`sessions/YYYY/MM/DD/rollout-*.jsonl`)
 * watched for changes. Sessions are started and continued in Codex CLI (#276, Phase 2 adds a driver).
 */
export function codexProvider({ profileId, codexHome, userHome, shellEnv = async () => process.env, binary, createAppServer: create = createAppServer, log = () => {} }: CodexProviderOptions): ProviderAdapter {
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
  const serverOptions: AppServerOptions = { binary: findBinary, env: async () => ({ ...(await shellEnv()), ...homeEnv }) };
  const server: AppServer = {
    async request(method, params) {
      // Gone with its profile (or the app quits): nothing starts a server again that nobody would stop.
      if (disposed) throw new AppServerError('Codex app-server was disposed.', 'disposed');
      try {
        return await (made ??= create(serverOptions)).request(method, params);
      } catch (error) {
        if (error instanceof AppServerError && error.code === 'notInstalled') found = null;
        throw error;
      }
    },
    pid: () => made?.pid() ?? null,
    onNotification: () => {
      throw new Error('onNotification: not built yet');
    },
    handleRequests: () => {
      throw new Error('handleRequests: not built yet');
    },
    hold: () => {
      throw new Error('hold: not built yet');
    },
    onExit: () => {
      throw new Error('onExit: not built yet');
    },
    dispose: async () => {
      disposed = true;
      const running = made;
      made = undefined;
      await running?.dispose();
    },
  };
  const files = codexRolloutFiles(folder);
  const source = codexSessionSource(server, { log, changes: () => rolloutChanges(files) });
  return {
    id: 'codex',
    profileId,
    home: codexHome,
    homeEnv,
    folder,
    files,
    source,
    resumeCommand: CODEX_RESUME,
    signInCommand: 'codex login',
    // No driver yet: its sessions are read-only here.
    async status() {
      const codex = await findBinary().catch(() => null);
      if (!codex) return { binary: null, version: null, signedIn: false, account: null, login: null, problem: INSTALL };
      try {
        return codexAccountStatus(codex, await server.request('account/read', {}));
      } catch (error) {
        if (error instanceof AppServerError && error.code === 'notInstalled') return { binary: null, version: null, signedIn: false, account: null, login: null, problem: INSTALL };
        return { binary: codex.path, version: codex.version, signedIn: false, account: null, login: null, problem: (error as Error).message };
      }
    },
    // `inUse` and `live` wait for Codex's per-thread lock (`thread-writer-locks/`), whose format isn't verified yet.
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
