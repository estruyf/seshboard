import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ClaudeInstall, ClaudeUpdateState, LogLevel } from '@seshboard/protocol';
import type { AppStateStore } from '../db/appState.ts';
import { autoUpdaterDisabled, claudeChannel, CLAUDE_DIST_TAGS_URL, detectInstall, versionFromDistTags } from './claudeInstall.ts';
import * as reduce from './claudeUpdateState.ts';
import { ToolUpdater, type RunCommand } from './toolUpdater.ts';

export { CHECK_INTERVAL_MS, cleanOutput, FIRST_CHECK_DELAY_MS, runCommand, UPDATE_TIMEOUT_MS, type RunCommand } from './toolUpdater.ts';

const FETCH_TIMEOUT_MS = 15_000;

export interface ClaudeUpdaterOptions {
  store: AppStateStore;
  /** Finds `claude` again and reads its version (the engine keeps the result for new sessions). */
  findClaude: () => Promise<ClaudeInstall | null>;
  /** The path is Seshboard's own setting, not a search: Seshboard never updates it. */
  override: boolean;
  /** The built-in profile's config folder, whose settings.json holds `autoUpdatesChannel`. */
  claudeConfigDir: string;
  /** The login shell's environment (PATH for brew and npm). */
  env: () => Promise<Record<string, string>>;
  /** Waited for before the first automatic check (the shell environment and `claude --version`). */
  ready: Promise<unknown>;
  onChange: (state: ClaudeUpdateState) => void;
  log: (level: LogLevel, message: string) => void;
  /** The dist-tags URL. Defaults to $SESHBOARD_CLAUDE_REGISTRY, then the npm registry (the smoke test passes a data: URL). */
  registryUrl?: string;
  /** False refuses to run an update command (the smoke test). */
  allowUpdate?: boolean;
  run?: RunCommand;
  home?: string;
  now?: () => number;
}

function readSettings(configDir: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(configDir, 'settings.json'), 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** The installed `claude`, how it was installed and its channel (the cask's, else Claude's settings). */
async function findInstall(options: ClaudeUpdaterOptions): Promise<reduce.FoundInstall | null> {
  const found = await options.findClaude().catch(() => null);
  if (!found) return null;
  const env = await options.env();
  const settings = readSettings(options.claudeConfigDir);
  // Symlinks followed on both sides, as the binary's path is.
  const home = realPath(options.home ?? homedir());
  // The cask decides the channel, and the channel the npm command: detect once to find the cask, then again.
  const probe = detectInstall(found.path, realPath(found.path), { home, channel: 'latest' });
  const channel = claudeChannel(settings, probe.cask);
  const info = detectInstall(found.path, realPath(found.path), { home, channel });
  return { path: found.path, version: found.version, info, channel, override: options.override, quiet: autoUpdaterDisabled(env, settings) };
}

async function fetchLatest(url: string, channel: ClaudeUpdateState['channel']): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`the registry answered ${response.status}`);
  const latest = versionFromDistTags(await response.json(), channel);
  if (!latest) throw new Error(`the registry has no ${channel} version`);
  return latest;
}

/**
 * Compares the installed Claude Code with the newest release on its channel (npm's dist-tags), shortly after launch
 * and every few hours, and runs the install method's update command on request.
 */
export class ClaudeUpdater extends ToolUpdater<ClaudeUpdateState> {
  constructor(options: ClaudeUpdaterOptions) {
    super({
      store: options.store,
      name: 'Claude Code',
      keys: { enabled: 'claudeUpdate.enabled', dismissed: 'claudeUpdate.dismissed' },
      initial: reduce.initialClaudeUpdateState,
      find: () => findInstall(options),
      latest: (state) => fetchLatest(options.registryUrl ?? process.env.SESHBOARD_CLAUDE_REGISTRY ?? CLAUDE_DIST_TAGS_URL, state.channel),
      env: options.env,
      ready: options.ready,
      onChange: options.onChange,
      log: options.log,
      ...(options.allowUpdate !== undefined ? { allowUpdate: options.allowUpdate } : {}),
      ...(options.run ? { run: options.run } : {}),
      ...(options.now ? { now: options.now } : {}),
    });
  }
}
