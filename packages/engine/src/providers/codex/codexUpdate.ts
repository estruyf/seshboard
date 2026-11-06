import { readFileSync, realpathSync } from 'node:fs';
import { join, posix, win32 } from 'node:path';
import type { LogLevel, ProviderUpdateState } from '@seshboard/protocol';
import type { AppStateStore } from '../../db/appState.ts';
import type { ClaudeInstallInfo } from '../../system/claudeInstall.ts';
import { initialClaudeUpdateState, type FoundInstall } from '../../system/claudeUpdateState.ts';
import { ToolUpdater, type RunCommand } from '../../system/toolUpdater.ts';
import type { CodexBinary } from './appServer.ts';

/** The name About and the toasts give it. */
export const CODEX_CLI = 'Codex CLI';

/** Where Codex itself looks for its newest version (codex-rs/tui/src/updates.rs). */
const LATEST_RELEASE_URL = 'https://api.github.com/repos/openai/codex/releases/latest';
const HOMEBREW_CASK_URL = 'https://formulae.brew.sh/api/cask/codex.json';
const NPM_DIST_TAGS_URL = 'https://registry.npmjs.org/-/package/@openai/codex/dist-tags';
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Works out how `codex` was installed from where it lives (`realPath`: symlinks followed), and so how to update it, the
 * way Codex itself tells installs apart (codex-rs/install-context). Codex's own installer (a release below
 * `<codexHome>/packages/standalone/releases`, linked from `~/.local/bin`) updates with `codex update`, which reruns it;
 * Homebrew and npm with their own command (npm's next to the package, so the same Node install is updated). pnpm, bun,
 * Scoop and WinGet installs, and a binary put somewhere by hand, are left to the person, with the command to run where
 * there is one: `npm install -g` would put a second Codex next to them, and `codex update` doesn't know how to.
 */
export function detectCodexInstall(path: string, realPath: string, options: { codexHome: string; platform?: NodeJS.Platform }): ClaudeInstallInfo {
  const { codexHome, platform = process.platform } = options;
  const windows = platform === 'win32';
  const { join, sep } = windows ? win32 : posix;
  // Windows paths compare without regard to case, as Windows does.
  const same = (a: string) => (windows ? a.toLowerCase() : a);
  const releases = join(codexHome, 'packages', 'standalone', 'releases');
  if (same(realPath).startsWith(same(`${releases}${sep}`))) return { method: 'native', cask: null, command: 'codex update', run: { file: path, args: ['update'] } };
  const manual = (method: ClaudeInstallInfo['method'], command: string): ClaudeInstallInfo => ({ method, cask: null, command, run: null });
  if (/[\\/]\.bun[\\/]install[\\/]global[\\/]/i.test(realPath)) return manual('unknown', 'bun install -g @openai/codex@latest');
  if (/[\\/](?:\.pnpm|pnpm[\\/]global)[\\/]/i.test(realPath)) return manual('unknown', 'pnpm add -g @openai/codex@latest');
  if (windows) {
    if (/\\WinGet\\(?:Packages|Links)\\/i.test(realPath)) return manual('winget', 'winget upgrade OpenAI.Codex');
    if (/\\scoop\\(?:apps|shims)\\/i.test(realPath)) return manual('unknown', 'scoop update codex');
    // npm's `codex.exe` is in the platform package, nested in Codex's or next to it, below npm's prefix.
    const npmPrefix = /^(.*?)\\node_modules\\@openai\\codex(?:-win32-[\w]+)?\\/i.exec(realPath)?.[1];
    if (npmPrefix) {
      return {
        method: 'npm',
        cask: null,
        command: `npm install -g --prefix "${npmPrefix}" @openai/codex@latest`,
        run: { file: 'npm', args: ['install', '-g', '--prefix', npmPrefix, '@openai/codex@latest'] },
        failureHint: 'On Windows, npm can’t replace Codex CLI while it runs: stop your Codex sessions and try again.',
      };
    }
  } else {
    const cask = /^(.*)\/Caskroom\/(codex(?:@[\w.-]+)?)\//.exec(realPath);
    if (cask) return { method: 'homebrew', cask: cask[2]!, command: `brew upgrade --cask ${cask[2]}`, run: { file: join(cask[1]!, 'bin', 'brew'), args: ['upgrade', '--cask', cask[2]!] } };
    const formula = /^(.*)\/Cellar\/(codex(?:@[\w.-]+)?)\//.exec(realPath);
    if (formula) return { method: 'homebrew', cask: null, command: `brew upgrade ${formula[2]}`, run: { file: join(formula[1]!, 'bin', 'brew'), args: ['upgrade', formula[2]!] } };
    // npm's global prefix (`<prefix>/lib/node_modules`), with its own npm in `<prefix>/bin`.
    const npm = /^(.*?)\/lib\/node_modules\/@openai\/codex(?:-[\w-]+)?\//.exec(realPath);
    if (npm) return { method: 'npm', cask: null, command: 'npm install -g @openai/codex@latest', run: { file: join(npm[1]!, 'bin', 'npm'), args: ['install', '-g', '@openai/codex@latest'] } };
    // Some other package manager's folder: which one is unknown, so its command isn't run.
    if (/\/node_modules\/@openai\/codex(?:-[\w-]+)?\//.test(realPath)) return manual('npm', 'npm install -g @openai/codex@latest');
  }
  return manual('unknown', 'codex update');
}

/** A release's tag (`rust-v0.167.0`) → `0.167.0`. */
export const versionFromTag = (tag: string) => /^(?:rust-)?v?(\d+\.\d+\.\d+(?:-[\w.]+)?)$/.exec(tag.trim())?.[1] ?? null;

/** Codex's update check is off in its config (`check_for_update_on_startup = false`): show an update, but don't nag. */
export function codexUpdatesOff(configToml: string | null, env: Record<string, string | undefined>): boolean {
  if (['CI', 'BUILD_NUMBER', 'RUN_ID', 'SYSTEM_COLLECTIONURI'].some((key) => !!env[key])) return true;
  return !!configToml && /^\s*check_for_update_on_startup\s*=\s*false\b/m.test(configToml);
}

/** The newest version for an install method, from where Codex itself looks (the demo and tests answer for it). */
export type CodexLatestVersion = (method: ClaudeInstallInfo['method'], cask: string | null) => Promise<string>;

const getJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
  return response.json();
};

/** Homebrew's cask has its own version (it can lag a release); npm's `latest`; else GitHub's latest release, as Codex does. */
export const fetchCodexLatest: CodexLatestVersion = async (method, cask) => {
  if (method === 'homebrew' && cask === 'codex') {
    const version = ((await getJson(HOMEBREW_CASK_URL)) as { version?: unknown }).version;
    if (typeof version === 'string' && version) return version.split(',')[0]!;
  }
  if (method === 'npm') {
    const latest = ((await getJson(NPM_DIST_TAGS_URL)) as { latest?: unknown }).latest;
    if (typeof latest === 'string' && latest) return latest;
  }
  const tag = ((await getJson(LATEST_RELEASE_URL)) as { tag_name?: unknown }).tag_name;
  const version = typeof tag === 'string' ? versionFromTag(tag) : null;
  if (!version) throw new Error('GitHub didn’t say the latest Codex version');
  return version;
};

const realPath = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

const readText = (path: string) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

export interface CodexUpdaterOptions {
  store: AppStateStore;
  /** The user's `codex`, found again on each check (null: not installed). */
  binary: () => Promise<CodexBinary | null>;
  /** Codex's own folder (`CODEX_HOME` or `~/.codex`), whose `config.toml` may turn its update check off. */
  codexHome: string;
  env: () => Promise<Record<string, string>>;
  ready: Promise<unknown>;
  onChange: (state: ProviderUpdateState) => void;
  log: (level: LogLevel, message: string) => void;
  /** Asks the network unless a test or the demo answers. */
  latest?: CodexLatestVersion;
  allowUpdate?: boolean;
  run?: RunCommand;
  now?: () => number;
}

/**
 * Codex CLI's check: the newest version from where Codex's own update prompt looks for the install method, and the
 * method's command to update it (`codex update` for Codex's own installer).
 */
export function codexUpdater(options: CodexUpdaterOptions): ToolUpdater<ProviderUpdateState> {
  /** How the last check found it installed: the cask decides where the newest version is asked. */
  let install: ClaudeInstallInfo | null = null;
  const find = async (): Promise<FoundInstall<string | null> | null> => {
    const found = await options.binary();
    if (!found) return null;
    const info = detectCodexInstall(found.path, realPath(found.path), { codexHome: realPath(options.codexHome) });
    install = info;
    const quiet = codexUpdatesOff(readText(join(options.codexHome, 'config.toml')), await options.env());
    return { path: found.path, version: found.version, info, channel: null, override: false, quiet };
  };
  return new ToolUpdater<ProviderUpdateState>({
    store: options.store,
    name: CODEX_CLI,
    keys: { enabled: 'providerUpdate.codex.enabled', dismissed: 'providerUpdate.codex.dismissed' },
    initial: (o) => ({ ...initialClaudeUpdateState(o), provider: 'codex', name: CODEX_CLI, channel: null }),
    find,
    latest: (state) => (options.latest ?? fetchCodexLatest)(install?.method ?? state.method, install?.cask ?? null),
    env: options.env,
    ready: options.ready,
    onChange: options.onChange,
    log: options.log,
    ...(options.allowUpdate !== undefined ? { allowUpdate: options.allowUpdate } : {}),
    ...(options.run ? { run: options.run } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
}
