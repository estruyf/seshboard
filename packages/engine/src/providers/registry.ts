import { existsSync } from 'node:fs';
import { PROVIDER_NAMES, type LogLevel, type OptionalProvider, type ProviderDetection, type ProviderInfo } from '@seshboard/protocol';
import type { ProviderProfile } from '../profiles/profileStore.ts';
import { disposeProvider, providerStatus, type ProviderAdapter } from './provider.ts';
import { COPILOT_MODES, type CreateCopilotClient } from './copilot/copilotDriver.ts';
import { COPILOT_INSTALL, COPILOT_RESUME, copilotProvider } from './copilot/copilotProvider.ts';
import { copilotHome } from './copilot/copilotSource.ts';
import { findCopilot } from './copilot/copilotBinary.ts';
import { copilotUpdater, type CopilotVersionCommand } from './copilot/copilotUpdate.ts';
import type { AppServer, AppServerOptions, CodexBinary } from './codex/appServer.ts';
import { CODEX_MODES } from './codex/codexModes.ts';
import { CODEX_INSTALL, CODEX_RESUME, codexHome, codexProvider } from './codex/codexProvider.ts';
import { findCodex } from './codex/codexBinary.ts';
import { codexUpdater, type CodexLatestVersion } from './codex/codexUpdate.ts';
import type { AcpConnection, AcpConnectionOptions } from './acp/acpConnection.ts';
import type { GeminiBinary } from './gemini/geminiBinary.ts';
import { findGemini } from './gemini/geminiBinary.ts';
import { GEMINI_MODES } from './gemini/geminiDriver.ts';
import { GEMINI_INSTALL, GEMINI_RESUME, geminiProvider } from './gemini/geminiProvider.ts';
import { geminiDataDir, geminiHome } from './gemini/geminiSource.ts';
import { geminiUpdater, type GeminiLatestVersion } from './gemini/geminiUpdate.ts';
import type { ProviderUpdaterDeps } from './providerUpdates.ts';
import type { ForkRecord } from './providerForks.ts';

export interface ProviderOptions {
  env: NodeJS.ProcessEnv;
  /** The user's home folder. */
  home: string;
  /** The login shell's environment, which providers' CLIs run with (their own config and login are found through it). */
  shellEnv: () => Promise<Record<string, string | undefined>>;
  /** A fake Copilot SDK and `copilot` (tests), and what its `copilot version` says (the demo). */
  copilot?: { createClient?: CreateCopilotClient; binary?: () => Promise<{ path: string; args?: string[]; version: string | null } | null>; version?: CopilotVersionCommand };
  /** A fake `codex` and `codex app-server` (tests and the demo), and the newest version its update check finds (the demo). */
  codex?: { binary?: () => Promise<CodexBinary | null>; createAppServer?: (options: AppServerOptions) => AppServer; latestVersion?: CodexLatestVersion };
  /** A fake `gemini` and its ACP agent (tests and the demo), and the newest version its update check finds (the demo). */
  gemini?: { binary?: () => Promise<GeminiBinary | null>; createConnection?: (options: AcpConnectionOptions) => AcpConnection; latestVersion?: GeminiLatestVersion };
  /** Where a provider says what went wrong while it reads (a Codex that won't start). */
  log?: (level: LogLevel, message: string) => void;
  /** Where each profile's forks made here are kept (`provider_forks`); in memory when left out. */
  forks?: (profileId: string) => ForkRecord;
  /** A session's details changed without a file the watcher sees (a Codex thread's new name): read it again. */
  onSessionChanged?: (sessionId: string) => void;
}

/** The update check of a provider's CLI (Settings › About), for a provider with a profile. Null for one without it yet. */
export function createProviderUpdater(provider: OptionalProvider, { env, home, shellEnv, copilot = {}, codex = {}, gemini = {} }: ProviderOptions, deps: ProviderUpdaterDeps) {
  const stringEnv = async () => Object.fromEntries(Object.entries(await shellEnv()).filter((e): e is [string, string] => typeof e[1] === 'string'));
  switch (provider) {
    case 'copilot':
      return copilotUpdater({
        ...deps,
        // Found again on each check: an update can move it, and installing it works without restarting Seshboard.
        binary: copilot.binary ?? (async () => findCopilot(await shellEnv(), home)),
        env: stringEnv,
        ...(copilot.version ? { version: copilot.version } : {}),
      });
    case 'codex':
      return codexUpdater({
        ...deps,
        binary: codex.binary ?? (async () => findCodex(await shellEnv(), home)),
        // Codex's own folder, whose config may turn its update check off; a profile's folder is its own login.
        codexHome: codexHome(env, home),
        env: stringEnv,
        ...(codex.latestVersion ? { latest: codex.latestVersion } : {}),
      });
    case 'gemini':
      return geminiUpdater({
        ...deps,
        binary: gemini.binary ?? (async () => findGemini(await shellEnv(), home)),
        // Gemini's own folder, whose settings may turn its update nag off; a profile's folder is its own login.
        geminiDir: geminiDataDir(geminiHome(env, home)),
        env: stringEnv,
        ...(gemini.latestVersion ? { latest: gemini.latestVersion } : {}),
      });
  }
}

/**
 * Every provider Seshboard supports besides Claude Code, in the order Add profile lists them: what each is, for
 * Settings and the message box. Adding a provider is a line here and one in `createProvider`.
 */
export function providerCatalog({ env, home }: Pick<ProviderOptions, 'env' | 'home'>): ProviderInfo[] {
  return [
    {
      id: 'copilot',
      name: PROVIDER_NAMES.copilot,
      defaultFolder: copilotHome(env, home),
      resumeCommand: COPILOT_RESUME,
      canStart: true,
      modes: COPILOT_MODES,
      installCommand: COPILOT_INSTALL,
      // Through Copilot's own APIs (fork, rewind, rename, Ask) and its folder (delete, to the Trash); the queue,
      // schedules and triggers start it like New session does, in a worktree or on a branch Seshboard makes. A pipeline's
      // step picks Copilot itself: a run stays Claude Code's.
      supports: ['fork', 'rewind', 'rename', 'delete', 'effort', 'ask', 'later', 'schedule', 'trigger', 'worktree', 'branch'],
    },
    {
      id: 'codex',
      name: PROVIDER_NAMES.codex,
      defaultFolder: codexHome(env, home),
      resumeCommand: CODEX_RESUME,
      // Read and run through the profile's `codex app-server` (#276).
      canStart: true,
      modes: CODEX_MODES,
      installCommand: CODEX_INSTALL,
      // Renamed with `thread/name/set`; forked with `thread/fork`; Ask about this session in a throwaway, read-only fork;
      // its rollout file goes to the Trash; effort per turn; the queue, schedules and triggers start it like New session
      // does, in a worktree or on a branch Seshboard makes. Rewind is Phase 3.
      supports: ['fork', 'rename', 'delete', 'effort', 'ask', 'worktree', 'branch', 'later', 'schedule', 'trigger'],
    },
    {
      id: 'gemini',
      name: PROVIDER_NAMES.gemini,
      defaultFolder: geminiHome(env, home),
      resumeCommand: GEMINI_RESUME,
      // Read from its files, run through its ACP agent (`gemini --acp`, #272).
      canStart: true,
      modes: GEMINI_MODES,
      installCommand: GEMINI_INSTALL,
      // Its session's files go to the Trash; the queue, schedules and triggers start it like New session does, in a
      // worktree or on a branch Seshboard makes. Gemini's ACP agent has no fork, rewind, rename, effort or Ask yet.
      supports: ['delete', 'worktree', 'branch', 'later', 'schedule', 'trigger'],
    },
  ];
}

/**
 * A provider's CLI on this computer, for its own folder, without a profile of it: the same status check a profile's
 * runtime makes (`copilot` started headless, `codex app-server`, or Gemini's files read, to ask about its login), then stopped. Nothing is read but its folder's
 * session list.
 */
export async function detectProvider(info: ProviderInfo, options: ProviderOptions): Promise<ProviderDetection> {
  const adapter = createProvider({ id: `detect-${info.id}`, provider: info.id, home: info.defaultFolder }, options);
  try {
    const status = await providerStatus(adapter);
    return {
      id: info.id,
      installed: !!status?.binary,
      version: status?.version ?? null,
      folder: info.defaultFolder,
      folderExists: existsSync(info.defaultFolder),
      sessions: adapter.files.files().size,
      signedIn: status?.signedIn ?? false,
      login: status?.login ?? null,
    };
  } finally {
    await disposeProvider(adapter);
  }
}

/** The adapter for one provider profile: its folder, its runtime and its login. */
export function createProvider(profile: ProviderProfile, { home, shellEnv, copilot = {}, codex = {}, gemini = {}, log, forks, onSessionChanged }: ProviderOptions): ProviderAdapter {
  const kind: OptionalProvider = profile.provider;
  switch (kind) {
    case 'copilot':
      return copilotProvider({ profileId: profile.id, copilotHome: profile.home, userHome: home, shellEnv, ...copilot });
    case 'codex':
      return codexProvider({ profileId: profile.id, codexHome: profile.home, userHome: home, shellEnv, ...codex, ...(log ? { log } : {}), ...(forks ? { forks: forks(profile.id) } : {}), ...(onSessionChanged ? { onSessionChanged } : {}) });
    case 'gemini':
      return geminiProvider({ profileId: profile.id, geminiHome: profile.home, userHome: home, shellEnv, ...(gemini.binary ? { binary: gemini.binary } : {}), ...(gemini.createConnection ? { createConnection: gemini.createConnection } : {}), ...(log ? { log } : {}) });
  }
}
