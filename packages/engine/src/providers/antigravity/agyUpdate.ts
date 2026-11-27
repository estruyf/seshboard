import { realpathSync } from 'node:fs';
import type { LogLevel, ProviderUpdateState } from '@seshboard/protocol';
import type { AppStateStore } from '../../db/appState.ts';
import type { ClaudeInstallInfo } from '../../system/claudeInstall.ts';
import { initialClaudeUpdateState, type FoundInstall } from '../../system/claudeUpdateState.ts';
import { ToolUpdater, type RunCommand } from '../../system/toolUpdater.ts';
import type { AgyBinary } from './agyBinary.ts';

/** The name About and the toasts give it. */
export const AGY_CLI = 'Antigravity CLI';

/** Where Antigravity's installer and its own updater look for the newest version: one manifest per platform. */
const MANIFEST_BASE_URL = 'https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests';
const HOMEBREW_CASK_URL = 'https://formulae.brew.sh/api/cask/antigravity-cli.json';
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Works out how `agy` was installed from where it lives (`realPath`: symlinks followed), and so how to update it.
 * Homebrew's cask (`antigravity-cli`) links `bin/agy` to a wrapper in its Caskroom that turns Antigravity's own updates
 * off, so it is updated with `brew upgrade`. Anything else is Antigravity's installer (`~/.local/bin/agy`,
 * `%LOCALAPPDATA%\agy\bin\agy.exe`) or a binary from it put elsewhere, which `agy update` replaces in place.
 */
export function detectAgyInstall(path: string, realPath: string, platform: NodeJS.Platform = process.platform): ClaudeInstallInfo {
  if (platform !== 'win32') {
    const cask = /^(.*)\/Caskroom\/(antigravity-cli(?:@[\w.-]+)?)\//.exec(realPath);
    if (cask) return { method: 'homebrew', cask: cask[2]!, command: `brew upgrade --cask ${cask[2]}`, run: { file: `${cask[1]}/bin/brew`, args: ['upgrade', '--cask', cask[2]!] } };
  }
  return { method: 'native', cask: null, command: 'agy update', run: { file: path, args: ['update'] } };
}

/** The manifest's name for this computer (`darwin_arm64`, `windows_amd64`), as Antigravity's installers pick it. */
export function agyManifestPlatform(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
  const os = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'darwin' : 'linux';
  return `${os}_${arch === 'arm64' ? 'arm64' : 'amd64'}`;
}

const TRUTHY = (value: string | undefined) => value !== undefined && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());

/** Antigravity's own updates are turned off (`AGY_CLI_DISABLE_AUTO_UPDATE`, or a CI): show an update, but don't nag. */
export const agyUpdatesOff = (env: Record<string, string | undefined>): boolean =>
  TRUTHY(env.AGY_CLI_DISABLE_AUTO_UPDATE) || ['CI', 'BUILD_NUMBER', 'RUN_ID', 'SYSTEM_COLLECTIONURI'].some((key) => !!env[key]);

/** The newest version for an install method (the demo and tests answer for it). */
export type AgyLatestVersion = (method: ClaudeInstallInfo['method']) => Promise<string>;

const getJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
  return response.json();
};

/** Homebrew's cask has its own version (`1.5.15,5514532022517760`, it can lag a release); else Antigravity's manifest. */
export const fetchAgyLatest: AgyLatestVersion = async (method) => {
  if (method === 'homebrew') {
    const version = ((await getJson(HOMEBREW_CASK_URL)) as { version?: unknown }).version;
    if (typeof version === 'string' && version) return version.split(',')[0]!;
  }
  const version = ((await getJson(`${MANIFEST_BASE_URL}/${agyManifestPlatform()}.json`)) as { version?: unknown }).version;
  if (typeof version !== 'string' || !version) throw new Error('Antigravity didn’t say its latest version');
  return version;
};

const realPath = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

export interface AgyUpdaterOptions {
  store: AppStateStore;
  /** The user's `agy`, found again on each check (null: not installed). */
  binary: () => Promise<AgyBinary | null>;
  env: () => Promise<Record<string, string>>;
  ready: Promise<unknown>;
  onChange: (state: ProviderUpdateState) => void;
  log: (level: LogLevel, message: string) => void;
  /** Asks the network unless a test or the demo answers. */
  latest?: AgyLatestVersion;
  allowUpdate?: boolean;
  run?: RunCommand;
  now?: () => number;
}

/**
 * Antigravity CLI's check: the newest version from the manifest its own updater reads (Homebrew's cask for a Homebrew
 * install), and `agy update` to install it. Antigravity also updates itself while it runs, so this mostly catches an
 * `agy` that hasn't run in a while.
 */
export function agyUpdater(options: AgyUpdaterOptions): ToolUpdater<ProviderUpdateState> {
  /** How the last check found it installed: Homebrew's version is asked of Homebrew. */
  let install: ClaudeInstallInfo | null = null;
  const find = async (): Promise<FoundInstall<string | null> | null> => {
    const found = await options.binary();
    if (!found) return null;
    const info = detectAgyInstall(found.path, realPath(found.path));
    install = info;
    return { path: found.path, version: found.version, info, channel: null, override: false, quiet: agyUpdatesOff(await options.env()) };
  };
  return new ToolUpdater<ProviderUpdateState>({
    store: options.store,
    name: AGY_CLI,
    keys: { enabled: 'providerUpdate.antigravity.enabled', dismissed: 'providerUpdate.antigravity.dismissed' },
    initial: (o) => ({ ...initialClaudeUpdateState(o), provider: 'antigravity', name: AGY_CLI, channel: null }),
    find,
    latest: (state) => (options.latest ?? fetchAgyLatest)(install?.method ?? state.method),
    env: options.env,
    ready: options.ready,
    onChange: options.onChange,
    log: options.log,
    ...(options.allowUpdate !== undefined ? { allowUpdate: options.allowUpdate } : {}),
    ...(options.run ? { run: options.run } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
}
