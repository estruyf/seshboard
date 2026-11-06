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
import type { ProviderUpdaterDeps } from './providerUpdates.ts';

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
  /** Where a provider says what went wrong while it reads (a Codex that won't start). */
  log?: (level: LogLevel, message: string) => void;
}

/** The update check of a provider's CLI (Settings › About), for a provider with a profile. Null for one without it yet. */
export function createProviderUpdater(provider: OptionalProvider, { env, home, shellEnv, copilot = {}, codex = {} }: ProviderOptions, deps: ProviderUpdaterDeps) {
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
      // Its rollout file goes to the Trash; effort per turn; the queue, schedules and triggers start it like New
      // session does, in a worktree or on a branch Seshboard makes. Fork, rename, rewind and Ask are Phase 3.
      supports: ['delete', 'effort', 'worktree', 'branch', 'later', 'schedule', 'trigger'],
    },
  ];
}

/**
 * A provider's CLI on this computer, for its own folder, without a profile of it: the same status check a profile's
 * runtime makes (`copilot` started headless, or `codex app-server`, to ask about its login), then stopped. Nothing is read but its folder's
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
export function createProvider(profile: ProviderProfile, { home, shellEnv, copilot = {}, codex = {}, log }: ProviderOptions): ProviderAdapter {
  const kind: OptionalProvider = profile.provider;
  switch (kind) {
    case 'copilot':
      return copilotProvider({ profileId: profile.id, copilotHome: profile.home, userHome: home, shellEnv, ...copilot });
    case 'codex':
      return codexProvider({ profileId: profile.id, codexHome: profile.home, userHome: home, shellEnv, ...codex, ...(log ? { log } : {}) });
  }
}
