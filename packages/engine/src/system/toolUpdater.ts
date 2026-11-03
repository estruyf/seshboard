import { spawn } from 'node:child_process';
import { win32 } from 'node:path';
import { RpcError, type LogLevel } from '@seshboard/protocol';
import type { AppStateStore } from '../db/appState.ts';
import type { ClaudeInstallInfo } from './claudeInstall.ts';
import * as reduce from './claudeUpdateState.ts';
import { findOnPath } from './editors.ts';
import { needsCmd, viaCmd } from './windowsCommand.ts';

/** Well after startup, so the check never competes with the first sessions and transcripts. */
export const FIRST_CHECK_DELAY_MS = 20_000;
export const CHECK_INTERVAL_MS = 4 * 60 * 60_000;
/** Homebrew updates itself first and npm can be slow; still, something that hangs this long is stuck. */
export const UPDATE_TIMEOUT_MS = 10 * 60_000;
/** Output is pushed to the windows at most this often while an update runs. */
const OUTPUT_FLUSH_MS = 150;

export type RunCommand = (file: string, args: string[], env: Record<string, string>, onOutput: (chunk: string) => void) => Promise<{ exitCode: number | null; error?: string }>;

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

export interface ToolUpdaterOptions<S extends reduce.UpdateState> {
  store: AppStateStore;
  /** The CLI's name in messages and the log ("Claude Code"). */
  name: string;
  /** Where the store keeps whether checks are on, and the version dismissed. */
  keys: { enabled: string; dismissed: string };
  initial(options: { enabled: boolean; dismissedVersion: string | null }): S;
  /** Finds the CLI again and works out how it was installed; null when it isn't. */
  find(): Promise<reduce.FoundInstall<S['channel']> | null>;
  /** The newest version on offer for the install `state` describes. */
  latest(state: S): Promise<string>;
  /** The login shell's environment (PATH for brew and npm). */
  env: () => Promise<Record<string, string>>;
  /** Waited for before the first automatic check. */
  ready: Promise<unknown>;
  onChange: (state: S) => void;
  log: (level: LogLevel, message: string) => void;
  /** False refuses to run an update command (the smoke test). */
  allowUpdate?: boolean;
  run?: RunCommand;
  now?: () => number;
}

/**
 * Compares an installed CLI with the newest release, shortly after launch and every few hours, and runs its install
 * method's update command on request. One update at a time. Claude Code's (`ClaudeUpdater`) and the providers' CLIs.
 */
export class ToolUpdater<S extends reduce.UpdateState> {
  private current: S;
  private info: ClaudeInstallInfo | null = null;
  private timers: NodeJS.Timeout[] = [];
  private pendingOutput = '';
  private flushTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(private readonly options: ToolUpdaterOptions<S>) {
    const enabled = options.store.get(options.keys.enabled);
    const dismissed = options.store.get(options.keys.dismissed);
    this.current = options.initial({ enabled: enabled !== false, dismissedVersion: typeof dismissed === 'string' ? dismissed : null });
  }

  get state(): S {
    return this.current;
  }

  /** Looks for the CLI right away (so a missing install shows at launch, also with checks off), then schedules the automatic checks. */
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

  /** Looks at the installed CLI again and asks for the newest version. Failures end up in the state. */
  async check(): Promise<void> {
    if (reduce.isBusy(this.current)) return;
    // Show "Checking…" right away; finding the CLI runs it for its version, which takes a moment.
    this.set(reduce.checking(this.current));
    await this.refreshInstall();
    if (this.current.status === 'missing') return;
    if (this.current.status !== 'checking') this.set(reduce.checking(this.current));
    try {
      const latest = await this.options.latest(this.current);
      this.set(reduce.checked(this.current, latest, this.now()));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.log('warn', `${this.options.name} update check failed: ${message}`);
      this.set(reduce.failed(this.current, `Couldn’t check for ${this.options.name} updates: ${message}`));
    }
  }

  /**
   * Runs the update command, then finds the CLI again. Throws right away when it can't start (busy, or not an
   * install Seshboard updates); the returned promise resolves when the update has finished or failed.
   */
  update(): Promise<void> {
    const { name } = this.options;
    if (reduce.isBusy(this.current)) throw new RpcError('BUSY', `${name} is already being checked or updated`);
    const run = this.info?.run;
    if (!this.current.canUpdate || !run) throw new RpcError('UNSUPPORTED', this.current.manualReason ?? `Seshboard can’t update this ${name}`);
    if (this.options.allowUpdate === false) throw new RpcError('UNSUPPORTED', `Updating ${name} is turned off in this run`);
    this.set(reduce.updating(this.current));
    this.options.log('info', `Updating ${name}: ${this.current.command}`);
    return this.runUpdate(run);
  }

  private async runUpdate(run: { file: string; args: string[] }): Promise<void> {
    const { name } = this.options;
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
    const found = await this.options.find().catch(() => null);
    this.set(reduce.updateFinished(this.current, { ...result, version: found?.version ?? null }, name));
    this.applyInstall(found);
    const state = this.current;
    this.options.log(state.status === 'error' ? 'warn' : 'info', state.status === 'error' ? `${name} update failed: ${state.error}` : `${name} updated to v${state.installedVersion}`);
  }

  dismiss(): void {
    this.set(reduce.dismiss(this.current));
    this.options.store.set(this.options.keys.dismissed, this.current.dismissedVersion);
  }

  setEnabled(enabled: boolean): void {
    this.options.store.set(this.options.keys.enabled, enabled);
    const wasOff = !this.current.enabled;
    this.set(reduce.setEnabled(this.current, enabled));
    // Turned back on: check now rather than in a few hours.
    if (enabled && wasOff) void this.check();
  }

  private automatic(): void {
    if (this.current.enabled) void this.check();
  }

  private async refreshInstall(): Promise<void> {
    this.applyInstall(await this.options.find().catch(() => null));
  }

  private applyInstall(found: reduce.FoundInstall<S['channel']> | null): void {
    this.info = found?.info ?? null;
    this.set(reduce.installFound(this.current, found, this.options.name));
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

  private set(next: S): void {
    if (next === this.current) return;
    this.current = next;
    this.options.onChange(next);
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}
