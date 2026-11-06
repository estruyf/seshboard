import { join } from 'node:path';
import type { LogLevel } from '@seshboard/protocol';
import type { DriverStatus, ProviderAdapter } from '../provider.ts';
import { createAppServer, type AppServer, type AppServerOptions, type CodexBinary } from './appServer.ts';
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
const SIGN_IN = 'Not signed in to Codex CLI. Use Sign in on this profile in Settings › Profiles, or run `codex login`. Seshboard uses that login.';

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

/** What `account/read` says, as Settings › Profiles shows it. Seshboard never reads `auth.json`. */
export function codexAccountStatus(binary: CodexBinary, { account, requiresOpenaiAuth }: GetAccountResponse): DriverStatus {
  // A model provider that needs no OpenAI login (set in Codex's config) counts as signed in.
  const signedIn = account !== null || !requiresOpenaiAuth;
  const email = account?.type === 'chatgpt' ? account.email : null;
  return { binary: binary.path, version: binary.version, signedIn, account: email, login: email, problem: signedIn ? null : SIGN_IN };
}

/**
 * One OpenAI Codex profile, read-only: its sessions listed and read through `codex app-server`, started with the
 * profile's own `CODEX_HOME` and stopped when idle, and its rollout files (`sessions/YYYY/MM/DD/rollout-*.jsonl`)
 * watched for changes. Sessions are started and continued in Codex CLI (#276, Phase 2 adds a driver).
 */
export function codexProvider({ profileId, codexHome, userHome, shellEnv = async () => process.env, binary, createAppServer: create = createAppServer, log = () => {} }: CodexProviderOptions): ProviderAdapter {
  const folder = codexSessionsDir(codexHome);
  // Looked up each time until found: installing Codex CLI works without restarting Seshboard.
  const findBinary = binary ?? (async () => findCodex(await shellEnv(), userHome));
  const homeEnv = { CODEX_HOME: codexHome };
  // Made on the first request: a profile whose sessions are never read starts nothing.
  let made: AppServer | undefined;
  const serverOptions: AppServerOptions = { binary: findBinary, env: async () => ({ ...(await shellEnv()), ...homeEnv }) };
  const server: AppServer = {
    request: async (method, params) => (made ??= create(serverOptions)).request(method, params),
    pid: () => made?.pid() ?? null,
    dispose: async () => {
      const running = made;
      made = undefined;
      await running?.dispose();
    },
  };
  const source = codexSessionSource(server, { log });
  return {
    id: 'codex',
    profileId,
    home: codexHome,
    homeEnv,
    folder,
    files: codexRolloutFiles(folder),
    source,
    resumeCommand: CODEX_RESUME,
    signInCommand: 'codex login',
    // No driver yet: its sessions are read-only here.
    async status() {
      const found = await findBinary().catch(() => null);
      if (!found) return { binary: null, version: null, signedIn: false, account: null, login: null, problem: INSTALL };
      try {
        return codexAccountStatus(found, await server.request('account/read', {}));
      } catch (error) {
        return { binary: found.path, version: found.version, signedIn: false, account: null, login: null, problem: (error as Error).message };
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
