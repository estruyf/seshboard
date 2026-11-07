import { readFileSync, realpathSync } from 'node:fs';
import { join, posix, win32 } from 'node:path';
import type { LogLevel, ProviderUpdateState } from '@seshboard/protocol';
import type { AppStateStore } from '../../db/appState.ts';
import type { ClaudeInstallInfo } from '../../system/claudeInstall.ts';
import { initialClaudeUpdateState, type FoundInstall } from '../../system/claudeUpdateState.ts';
import { ToolUpdater, type RunCommand } from '../../system/toolUpdater.ts';
import type { GeminiBinary } from './geminiBinary.ts';

/** The name About and the toasts give it. */
export const GEMINI_CLI = 'Gemini CLI';

const HOMEBREW_FORMULA_URL = 'https://formulae.brew.sh/api/formula/gemini-cli.json';
const NPM_DIST_TAGS_URL = 'https://registry.npmjs.org/-/package/@google/gemini-cli/dist-tags';
const FETCH_TIMEOUT_MS = 15_000;
const NPM_LATEST = '@google/gemini-cli@latest';

/**
 * Works out how `gemini` was installed from where it lives (`realPath`: symlinks followed), and so how to update it:
 * Homebrew's formula with `brew upgrade gemini-cli`, npm's global install with npm next to it (so the same Node install
 * is updated). pnpm, bun and a copy put somewhere by hand are left to the person, with the command to run where there
 * is one: `npm install -g` would put a second Gemini CLI next to them.
 */
export function detectGeminiInstall(realPath: string, platform: NodeJS.Platform = process.platform): ClaudeInstallInfo {
  const windows = platform === 'win32';
  const { join } = windows ? win32 : posix;
  const manual = (method: ClaudeInstallInfo['method'], command: string): ClaudeInstallInfo => ({ method, cask: null, command, run: null });
  if (/[\\/]\.bun[\\/]install[\\/]global[\\/]/i.test(realPath)) return manual('unknown', `bun install -g ${NPM_LATEST}`);
  if (/[\\/](?:\.pnpm|pnpm[\\/]global)[\\/]/i.test(realPath)) return manual('unknown', `pnpm add -g ${NPM_LATEST}`);
  if (windows) {
    // npm's script, run by `node` (`npmGemini`): the package is below npm's prefix.
    const npmPrefix = /^(.*?)\\node_modules\\@google\\gemini-cli\\/i.exec(realPath)?.[1];
    if (npmPrefix) {
      return {
        method: 'npm',
        cask: null,
        command: `npm install -g --prefix "${npmPrefix}" ${NPM_LATEST}`,
        run: { file: 'npm', args: ['install', '-g', '--prefix', npmPrefix, NPM_LATEST] },
        failureHint: 'On Windows, npm can’t replace Gemini CLI while it runs: stop your Gemini sessions and try again.',
      };
    }
  } else {
    const formula = /^(.*)\/Cellar\/(gemini-cli(?:@[\w.-]+)?)\//.exec(realPath);
    if (formula) return { method: 'homebrew', cask: null, command: `brew upgrade ${formula[2]}`, run: { file: join(formula[1]!, 'bin', 'brew'), args: ['upgrade', formula[2]!] } };
    const npm = /^(.*?)\/lib\/node_modules\/@google\/gemini-cli\//.exec(realPath);
    if (npm) return { method: 'npm', cask: null, command: `npm install -g ${NPM_LATEST}`, run: { file: join(npm[1]!, 'bin', 'npm'), args: ['install', '-g', NPM_LATEST] } };
    if (/\/node_modules\/@google\/gemini-cli\//.test(realPath)) return manual('npm', `npm install -g ${NPM_LATEST}`);
  }
  return manual('unknown', `npm install -g ${NPM_LATEST}`);
}

/**
 * Gemini CLI's own update nag is off in its settings (`general.disableUpdateNag`, or the older top-level
 * `disableUpdateNag`): show an update, but don't nag. CI never nags.
 */
export function geminiUpdatesOff(settingsJson: string | null, env: Record<string, string | undefined>): boolean {
  if (['CI', 'BUILD_NUMBER', 'RUN_ID', 'SYSTEM_COLLECTIONURI'].some((key) => !!env[key])) return true;
  if (!settingsJson) return false;
  try {
    const settings = JSON.parse(settingsJson) as { disableUpdateNag?: unknown; general?: { disableUpdateNag?: unknown } };
    return settings.general?.disableUpdateNag === true || settings.disableUpdateNag === true;
  } catch {
    return false;
  }
}

/** The newest version for an install method (the demo and tests answer for it). */
export type GeminiLatestVersion = (method: ClaudeInstallInfo['method']) => Promise<string>;

const getJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
  return response.json();
};

/** Homebrew's formula has its own version (it can lag a release); everything else npm's `latest`. */
export const fetchGeminiLatest: GeminiLatestVersion = async (method) => {
  if (method === 'homebrew') {
    const version = ((await getJson(HOMEBREW_FORMULA_URL)) as { versions?: { stable?: unknown } }).versions?.stable;
    if (typeof version === 'string' && version) return version;
  }
  const latest = ((await getJson(NPM_DIST_TAGS_URL)) as { latest?: unknown }).latest;
  if (typeof latest === 'string' && latest) return latest;
  throw new Error('npm didn’t say the latest Gemini CLI version');
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

export interface GeminiUpdaterOptions {
  store: AppStateStore;
  /** The user's `gemini`, found again on each check (null: not installed). */
  binary: () => Promise<GeminiBinary | null>;
  /** Gemini's own folder (`~/.gemini`), whose `settings.json` may turn its update nag off. */
  geminiDir: string;
  env: () => Promise<Record<string, string>>;
  ready: Promise<unknown>;
  onChange: (state: ProviderUpdateState) => void;
  log: (level: LogLevel, message: string) => void;
  latest?: GeminiLatestVersion;
  allowUpdate?: boolean;
  run?: RunCommand;
  now?: () => number;
}

/** Gemini CLI's check: the newest version where its install method gets it from, and that method's command to update. */
export function geminiUpdater(options: GeminiUpdaterOptions): ToolUpdater<ProviderUpdateState> {
  let install: ClaudeInstallInfo | null = null;
  const find = async (): Promise<FoundInstall<string | null> | null> => {
    const found = await options.binary();
    if (!found) return null;
    // On Windows the script `node` runs is what tells the install apart.
    const where = found.args?.[0] ?? found.path;
    const info = detectGeminiInstall(realPath(where));
    install = info;
    const quiet = geminiUpdatesOff(readText(join(options.geminiDir, 'settings.json')), await options.env());
    return { path: found.path, version: found.version, info, channel: null, override: false, quiet };
  };
  return new ToolUpdater<ProviderUpdateState>({
    store: options.store,
    name: GEMINI_CLI,
    keys: { enabled: 'providerUpdate.gemini.enabled', dismissed: 'providerUpdate.gemini.dismissed' },
    initial: (o) => ({ ...initialClaudeUpdateState(o), provider: 'gemini', name: GEMINI_CLI, channel: null }),
    find,
    latest: (state) => (options.latest ?? fetchGeminiLatest)(install?.method ?? state.method),
    env: options.env,
    ready: options.ready,
    onChange: options.onChange,
    log: options.log,
    ...(options.allowUpdate !== undefined ? { allowUpdate: options.allowUpdate } : {}),
    ...(options.run ? { run: options.run } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
}
