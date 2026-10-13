import { spawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, win32 } from 'node:path';
import { RpcError, type ClaudeInstall, type ClaudeUpdateState, type LogLevel } from '@switchboard/protocol';
import type { AppStateStore } from '../db/appState.ts';
import { autoUpdaterDisabled, claudeChannel, CLAUDE_DIST_TAGS_URL, detectInstall, versionFromDistTags, type ClaudeInstallInfo } from './claudeInstall.ts';
import * as reduce from './claudeUpdateState.ts';
import { findOnPath } from './editors.ts';
import { needsCmd, viaCmd } from './windowsCommand.ts';

/** Well after startup, so the check never competes with the first sessions and transcripts. */
export const FIRST_CHECK_DELAY_MS = 20_000;
export const CHECK_INTERVAL_MS = 4 * 60 * 60_000;
/** Homebrew updates itself first and npm can be slow; still, something that hangs this long is stuck. */
export const UPDATE_TIMEOUT_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 15_000;
/** Output is pushed to the windows at most this often while an update runs. */
const OUTPUT_FLUSH_MS = 150;

const ENABLED_KEY = 'claudeUpdate.enabled';
const DISMISSED_KEY = 'claudeUpdate.dismissed';

export type RunCommand = (file: string, args: string[], env: Record<string, string>, onOutput: (chunk: string) => void) => Promise<{ exitCode: number | null; error?: string }>;

export interface ClaudeUpdaterOptions {
  store: AppStateStore;
  /** Finds `claude` again and reads its version (the engine keeps the result for new sessions). */
  findClaude: () => Promise<ClaudeInstall | null>;
  /** The path is Switchboard's own setting, not a search: Switchboard never updates it. */
  override: boolean;
  /** The built-in profile's config folder, whose settings.json holds `autoUpdatesChannel`. */
  claudeConfigDir: string;
  /** The login shell's environment (PATH for brew and npm). */
  env: () => Promise<Record<string, string>>;
  /** Waited for before the first automatic check (the shell environment and `claude --version`). */
  ready: Promise<unknown>;
  onChange: (state: ClaudeUpdateState) => void;
  log: (level: LogLevel, message: string) => void;
  /** The dist-tags URL. Defaults to $SWITCHBOARD_CLAUDE_REGISTRY, then the npm registry (the smoke test passes a data: URL). */
  registryUrl?: string;
  /** False refuses to run an update command (the smoke test). */
  allowUpdate?: boolean;
  run?: RunCommand;
  home?: string;
  now?: () => number;
}

/** Strips terminal colours and turns carriage-return progress lines into separate lines. */
export function cleanOutput(chunk: string): string {
  // eslint-disable-next-line no-control-regex
  return chunk.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Runs a command without a terminal; output from both streams goes to `onOutput`. */
export const runCommand: RunCommand = (file, args, env, onOutput) =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (result: { exitCode: number | null; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    // On Windows a bare name (`npm`) is found with its command ending, and a `.cmd` runs through cmd.exe.
    const resolved = process.platform === 'win32' && !win32.isAbsolute(file) ? (findOnPath(file, env, 'win32') ?? file) : file;
    const launch = process.platform === 'win32' && needsCmd(resolved) ? viaCmd(resolved, args, env) : { command: resolved, args };
    const child = spawn(launch.command, launch.args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, windowsVerbatimArguments: launch.command !== resolved });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish({ exitCode: null, error: `The update took longer than ${UPDATE_TIMEOUT_MS / 60_000} minutes and was stopped.` });
    }, UPDATE_TIMEOUT_MS);
    child.stdout.setEncoding('utf8').on('data', (data: string) => onOutput(data));
    child.stderr.setEncoding('utf8').on('data', (data: string) => onOutput(data));
    child.on('error', (error) => finish({ exitCode: null, error: `Couldn’t run ${file}: ${error.message}` }));
    child.on('close', (code) => finish({ exitCode: code }));
  });

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

/**
 * Compares the installed Claude Code with the newest release on its channel, shortly after launch and every few
 * hours, and runs the install method's update command on request. One update at a time.
 */
export class ClaudeUpdater {
  private current: ClaudeUpdateState;
  private info: ClaudeInstallInfo | null = null;
  private timers: NodeJS.Timeout[] = [];
  private pendingOutput = '';
  private flushTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(private readonly options: ClaudeUpdaterOptions) {
    const enabled = options.store.get(ENABLED_KEY);
    const dismissed = options.store.get(DISMISSED_KEY);
    this.current = reduce.initialClaudeUpdateState({ enabled: enabled !== false, dismissedVersion: typeof dismissed === 'string' ? dismissed : null });
  }

  get state(): ClaudeUpdateState {
    return this.current;
  }

  /** Looks for `claude` right away (so a missing install shows at launch, also with checks off), then schedules the automatic checks. */
  start(): void {
    void this.options.ready.then(() => {
      if (this.closed) return;
      if (!reduce.isBusy(this.current)) void this.refreshInstall();
      const first = setTimeout(() => this.automatic(), FIRST_CHECK_DELAY_MS);
      const every = setInterval(() => this.automatic(), CHECK_INTERVAL_MS);
      first.unref?.();
      every.unref?.();
      this.timers.push(first, every);
    });
  }

  close(): void {
    this.closed = true;
    for (const timer of this.timers) clearTimeout(timer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
  }

  /** Looks at the installed `claude` again and compares it with the registry. Failures end up in the state. */
  async check(): Promise<void> {
    if (reduce.isBusy(this.current)) return;
    // Show "Checking…" right away; finding `claude` runs `claude --version`, which takes a moment.
    this.set(reduce.checking(this.current));
    await this.refreshInstall();
    if (this.current.status === 'missing') return;
    if (this.current.status !== 'checking') this.set(reduce.checking(this.current));
    try {
      const latest = await this.fetchLatest();
      this.set(reduce.checked(this.current, latest, this.now()));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.log('warn', `Claude Code update check failed: ${message}`);
      this.set(reduce.failed(this.current, `Couldn’t check for Claude Code updates: ${message}`));
    }
  }

  /**
   * Runs the update command, then finds `claude` again. Throws right away when it can't start (busy, or not an
   * install Switchboard updates); the returned promise resolves when the update has finished or failed.
   */
  update(): Promise<void> {
    if (reduce.isBusy(this.current)) throw new RpcError('BUSY', 'Claude Code is already being checked or updated');
    const run = this.info?.run;
    if (!this.current.canUpdate || !run) throw new RpcError('UNSUPPORTED', this.current.manualReason ?? 'Switchboard can’t update this Claude Code');
    if (this.options.allowUpdate === false) throw new RpcError('UNSUPPORTED', 'Updating Claude Code is turned off in this run');
    this.set(reduce.updating(this.current));
    this.options.log('info', `Updating Claude Code: ${this.current.command}`);
    return this.runUpdate(run);
  }

  private async runUpdate(run: { file: string; args: string[] }): Promise<void> {
    let result: { exitCode: number | null; error?: string };
    try {
      const env = { ...(await this.options.env()), NONINTERACTIVE: '1', HOMEBREW_NO_ENV_HINTS: '1', NO_COLOR: '1' };
      result = await (this.options.run ?? runCommand)(run.file, run.args, env, (chunk) => this.output(chunk));
    } catch (error) {
      result = { exitCode: null, error: error instanceof Error ? error.message : String(error) };
    }
    this.flush();
    const hint = this.info?.failureHint;
    if (hint && (result.error || result.exitCode !== 0)) {
      result = { ...result, error: `${result.error ?? `The update command exited with ${result.exitCode === null ? 'a signal' : `code ${result.exitCode}`}.`} ${hint}` };
    }
    const found = await this.options.findClaude().catch(() => null);
    this.set(reduce.updateFinished(this.current, { ...result, version: found?.version ?? null }));
    this.applyInstall(found, await this.options.env());
    const state = this.current;
    this.options.log(state.status === 'error' ? 'warn' : 'info', state.status === 'error' ? `Claude Code update failed: ${state.error}` : `Claude Code updated to v${state.installedVersion}`);
  }

  dismiss(): void {
    this.set(reduce.dismiss(this.current));
    this.options.store.set(DISMISSED_KEY, this.current.dismissedVersion);
  }

  setEnabled(enabled: boolean): void {
    this.options.store.set(ENABLED_KEY, enabled);
    const wasOff = !this.current.enabled;
    this.set(reduce.setEnabled(this.current, enabled));
    // Turned back on: check now rather than in a few hours.
    if (enabled && wasOff) void this.check();
  }

  private automatic(): void {
    if (this.current.enabled) void this.check();
  }

  private async refreshInstall(): Promise<void> {
    const found = await this.options.findClaude().catch(() => null);
    this.applyInstall(found, await this.options.env());
  }

  private applyInstall(found: ClaudeInstall | null, env: Record<string, string>): void {
    if (!found) {
      this.info = null;
      this.set(reduce.installFound(this.current, null));
      return;
    }
    const settings = readSettings(this.options.claudeConfigDir);
    // Symlinks followed on both sides, as the binary's path is.
    const home = realPath(this.options.home ?? homedir());
    // The cask decides the channel, and the channel the npm command: detect once to find the cask, then again.
    const probe = detectInstall(found.path, realPath(found.path), { home, channel: 'latest' });
    const channel = claudeChannel(settings, probe.cask);
    const info = detectInstall(found.path, realPath(found.path), { home, channel });
    this.info = info;
    this.set(
      reduce.installFound(this.current, {
        path: found.path,
        version: found.version,
        info,
        channel,
        override: this.options.override,
        quiet: autoUpdaterDisabled(env, settings),
      }),
    );
  }

  private async fetchLatest(): Promise<string> {
    const url = this.options.registryUrl ?? process.env.SWITCHBOARD_CLAUDE_REGISTRY ?? CLAUDE_DIST_TAGS_URL;
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`the registry answered ${response.status}`);
    const latest = versionFromDistTags(await response.json(), this.current.channel);
    if (!latest) throw new Error(`the registry has no ${this.current.channel} version`);
    return latest;
  }

  /** Batches output, so a chatty command doesn't push a state per line. */
  private output(chunk: string): void {
    this.pendingOutput += cleanOutput(chunk);
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), OUTPUT_FLUSH_MS);
  }

  private flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (!this.pendingOutput) return;
    const chunk = this.pendingOutput;
    this.pendingOutput = '';
    this.set(reduce.appendOutput(this.current, chunk));
  }

  private set(next: ClaudeUpdateState): void {
    if (next === this.current) return;
    this.current = next;
    this.options.onChange(next);
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}
