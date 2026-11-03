import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import type { LogLevel, ProviderUpdateState } from '@seshboard/protocol';
import type { AppStateStore } from '../../db/appState.ts';
import type { ClaudeInstallInfo } from '../../system/claudeInstall.ts';
import { initialClaudeUpdateState, type FoundInstall } from '../../system/claudeUpdateState.ts';
import { ToolUpdater, type RunCommand } from '../../system/toolUpdater.ts';

/** The name About and the toasts give it. */
export const COPILOT_CLI = 'GitHub Copilot CLI';

/** `copilot version` asks GitHub's releases; it waits on the network. */
const VERSION_TIMEOUT_MS = 30_000;

/**
 * Works out how `copilot` was installed from where it lives, and so how to update it. `path` is what runs, `args`
 * what goes before (on Windows, npm's install runs as `node <its script>`), and `realPath` the binary or script with
 * symlinks followed. Copilot's own installer (a standalone binary, in `~/.local/bin` or elsewhere) updates with
 * `copilot update`, which keeps to the channel Copilot was set to.
 */
export function detectCopilotInstall(path: string, args: readonly string[], realPath: string, platform: NodeJS.Platform = process.platform): ClaudeInstallInfo {
  const windows = platform === 'win32';
  if (windows) {
    // WinGet should update what it installed, and may ask for permission: Seshboard shows the command.
    if (/\\WinGet\\Packages\\/i.test(realPath)) return { method: 'winget', cask: null, command: 'winget upgrade GitHub.Copilot', run: null };
    // npm's package below its prefix. The prefix is named, so another npm first on PATH doesn't update its own instead.
    const npmPrefix = /^(.*)\\node_modules\\@github\\copilot\\/i.exec(realPath)?.[1];
    if (npmPrefix) {
      return {
        method: 'npm',
        cask: null,
        command: `npm install -g --prefix "${npmPrefix}" @github/copilot@latest`,
        run: { file: 'npm', args: ['install', '-g', '--prefix', npmPrefix, '@github/copilot@latest'] },
        failureHint: 'On Windows, npm can’t replace Copilot CLI while it runs: stop your Copilot sessions and try again.',
      };
    }
  } else {
    const { join } = posix;
    const cask = /^(.*)\/Caskroom\/(copilot-cli(?:@[\w.-]+)?)\//.exec(realPath);
    if (cask) return { method: 'homebrew', cask: cask[2]!, command: `brew upgrade --cask ${cask[2]}`, run: { file: join(cask[1]!, 'bin', 'brew'), args: ['upgrade', '--cask', cask[2]!] } };
    const formula = /^(.*)\/Cellar\/(copilot-cli(?:@[\w.-]+)?)\//.exec(realPath);
    if (formula) return { method: 'homebrew', cask: null, command: `brew upgrade ${formula[2]}`, run: { file: join(formula[1]!, 'bin', 'brew'), args: ['upgrade', formula[2]!] } };
    const npm = /^(.*)\/lib\/node_modules\/@github\/copilot\//.exec(realPath) ?? /^(.*)\/node_modules\/@github\/copilot\//.exec(realPath);
    if (npm) {
      // The npm next to the package, so the same Node install (nvm, Homebrew node…) is updated.
      const prefix = realPath.includes('/lib/node_modules/') ? npm[1]! : null;
      return { method: 'npm', cask: null, command: 'npm install -g @github/copilot@latest', run: { file: prefix ? join(prefix, 'bin', 'npm') : 'npm', args: ['install', '-g', '@github/copilot@latest'] } };
    }
  }
  return { method: 'native', cask: null, command: 'copilot update', run: { file: path, args: [...args, 'update'] } };
}

/**
 * What `copilot version` says: the version that runs (`GitHub Copilot CLI 1.0.90-0`) and, when its channel has a
 * newer one, that one (`Update available: 1.0.106-2`).
 */
export function parseCopilotVersionOutput(output: string): { installed: string | null; available: string | null } {
  const version = (pattern: RegExp) => pattern.exec(output)?.[1]?.replace(/\.$/, '') ?? null;
  return { installed: version(/Copilot CLI v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/i), available: version(/Update available:\s*v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/i) };
}

const FALSY = (value: string | undefined) => value !== undefined && ['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase());

/** Copilot CLI's own updates are turned off (`COPILOT_AUTO_UPDATE=false`, or a CI): show an update, but don't nag. */
export const copilotUpdatesOff = (env: Record<string, string | undefined>): boolean => FALSY(env.COPILOT_AUTO_UPDATE) || ['CI', 'BUILD_NUMBER', 'RUN_ID', 'SYSTEM_COLLECTIONURI'].some((key) => !!env[key]);

/** Runs `copilot version` and returns what it printed (the demo and tests answer for it). */
export type CopilotVersionCommand = (binary: { path: string; args?: string[] }, env: Record<string, string>) => Promise<string>;

const runVersion: CopilotVersionCommand = (binary, env) =>
  new Promise((resolve, reject) =>
    execFile(binary.path, [...(binary.args ?? []), 'version'], { env, timeout: VERSION_TIMEOUT_MS }, (error, stdout, stderr) => (error ? reject(new Error(stderr.trim() || error.message)) : resolve(`${stdout}\n${stderr}`))),
  );

const realPath = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

export interface CopilotUpdaterOptions {
  store: AppStateStore;
  /** The user's `copilot`, found again on each check (null: not installed). */
  binary: () => Promise<{ path: string; args?: string[]; version: string | null } | null>;
  env: () => Promise<Record<string, string>>;
  ready: Promise<unknown>;
  onChange: (state: ProviderUpdateState) => void;
  log: (level: LogLevel, message: string) => void;
  /** `copilot version`, run for real unless a test or the demo answers. */
  version?: CopilotVersionCommand;
  allowUpdate?: boolean;
  run?: RunCommand;
  now?: () => number;
}

/**
 * GitHub Copilot CLI's check: `copilot version` says whether its channel (stable or prerelease, Copilot's own setting)
 * has a newer version, and the install method's command updates it (`copilot update` for Copilot's installer). Asking
 * doesn't download anything.
 */
export function copilotUpdater(options: CopilotUpdaterOptions): ToolUpdater<ProviderUpdateState> {
  let binary: { path: string; args?: string[] } | null = null;
  const find = async (): Promise<FoundInstall<string | null> | null> => {
    const found = await options.binary();
    binary = found;
    if (!found) return null;
    const script = found.args?.[0];
    const info = detectCopilotInstall(found.path, found.args ?? [], realPath(script ?? found.path));
    return { path: script ?? found.path, version: found.version, info, channel: null, override: false, quiet: copilotUpdatesOff(await options.env()) };
  };
  return new ToolUpdater<ProviderUpdateState>({
    store: options.store,
    name: COPILOT_CLI,
    keys: { enabled: 'providerUpdate.copilot.enabled', dismissed: 'providerUpdate.copilot.dismissed' },
    initial: (o) => ({ ...initialClaudeUpdateState(o), provider: 'copilot', name: COPILOT_CLI, channel: null }),
    find,
    latest: async (state) => {
      if (!binary) throw new Error('Copilot CLI isn’t installed');
      const { installed, available } = parseCopilotVersionOutput(await (options.version ?? runVersion)(binary, await options.env()));
      // No newer version: the one installed is the newest on its channel.
      const latest = available ?? installed ?? state.installedVersion;
      if (!latest) throw new Error('Copilot CLI didn’t say its version');
      return latest;
    },
    env: options.env,
    ready: options.ready,
    onChange: options.onChange,
    log: options.log,
    ...(options.allowUpdate !== undefined ? { allowUpdate: options.allowUpdate } : {}),
    ...(options.run ? { run: options.run } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
}
