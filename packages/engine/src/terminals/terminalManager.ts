import { randomUUID } from 'node:crypto';
import { accessSync, chmodSync, constants, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import type { LogLevel, TerminalInfo, TerminalKind } from '@switchboard/protocol';
import { userShell, type UserShell } from '../system/shell.ts';

/** The slice of node-pty's IPty the manager uses (injectable for tests). */
export interface Pty {
  readonly pid: number;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

export type SpawnPty = (
  file: string,
  args: string[],
  options: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> },
) => Pty;

export interface TerminalManagerOptions {
  /** Defaults to node-pty. */
  spawn?: () => Promise<SpawnPty>;
  /** The login-shell environment (PATH, nvm, …). */
  env: () => Promise<Record<string, string>>;
  claudePath: () => Promise<string | undefined>;
  onData: (id: string, data: string) => void;
  onChange: (terminals: TerminalInfo[]) => void;
  log: (level: LogLevel, message: string) => void;
}

/** Output kept per terminal for replay when a window (re)attaches. */
export const REPLAY_LIMIT = 400_000;
const FLUSH_MS = 8;

/** Environment variables of an enclosing Claude Code that must not leak into the user's terminals. */
const STRIP_ENV = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS'];

/** How long Stop waits after ^C before it terminates, then kills, the process. */
export const STOP_GRACE_MS = 3000;

interface Terminal {
  info: TerminalInfo;
  pty: Pty;
  /** What was spawned, so Restart can run it again in the same tab. */
  spawn: { file: string; args: string[]; cwd: string; env: Record<string, string>; command?: string };
  stopTimers: Array<ReturnType<typeof setTimeout>>;
  replay: string[];
  replayLength: number;
  pending: string;
  timer: ReturnType<typeof setTimeout> | undefined;
  exited: Promise<number>;
}

/**
 * node-pty's prebuilt `spawn-helper` can lose its executable bit when npm
 * extracts it, and then every spawn fails with "posix_spawnp failed".
 */
export function ensureSpawnHelperExecutable(): void {
  if (process.platform === 'win32') return;
  let root: string;
  try {
    root = dirname(createRequire(import.meta.url).resolve('node-pty/package.json'));
  } catch {
    return;
  }
  for (const dir of [`prebuilds/${process.platform}-${process.arch}`, 'build/Release']) {
    const helper = join(root, dir, 'spawn-helper').replace('app.asar', 'app.asar.unpacked');
    if (!existsSync(helper)) continue;
    try {
      accessSync(helper, constants.X_OK);
    } catch {
      try {
        chmodSync(helper, 0o755);
      } catch {
        // Read-only install (e.g. a signed app bundle): nothing we can do here.
      }
    }
  }
}

async function loadNodePty(): Promise<SpawnPty> {
  ensureSpawnHelperExecutable();
  const pty = await import('node-pty');
  return (file, args, options) => pty.spawn(file, args, options);
}

/** Terminals for session panels: login shells and the Claude Code TUI. They outlive window switches. */
export class TerminalManager {
  private readonly terminals = new Map<string, Terminal>();
  private readonly closeWaiters = new Map<string, () => void>();
  private spawnPty: Promise<SpawnPty> | undefined;

  constructor(private readonly options: TerminalManagerOptions) {}

  /** The shell terminal tabs and shell actions run in, e.g. to quote values for it. */
  async shell(): Promise<UserShell> {
    return userShell(await this.options.env());
  }

  list(): TerminalInfo[] {
    return [...this.terminals.values()].map((t) => t.info);
  }

  async open(params: {
    sessionId: string | null;
    cwd: string;
    kind: TerminalKind;
    cols: number;
    rows: number;
    fork: boolean;
    /** For `action`: the command line to run in the login shell. */
    command?: string;
    title?: string;
    /** Added to the login-shell environment, e.g. the session's CLAUDE_CONFIG_DIR. */
    env?: Record<string, string>;
  }): Promise<TerminalInfo> {
    if (!existsSync(params.cwd)) throw new Error(`Folder not found: ${params.cwd}`);
    const baseEnv = await this.options.env();
    const env: Record<string, string> = { ...baseEnv, ...params.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Switchboard' };
    for (const key of STRIP_ENV) delete env[key];

    let file: string;
    let args: string[];
    let title: string;
    if (params.kind === 'claude') {
      const claude = await this.options.claudePath();
      if (!claude) throw new Error('Claude Code was not found on your PATH');
      file = claude;
      args = params.sessionId ? ['--resume', params.sessionId, ...(params.fork ? ['--fork-session'] : [])] : [];
      title = params.fork ? 'Claude (fork)' : 'Claude';
    } else if (params.kind === 'action') {
      if (!params.command) throw new Error('No command to run');
      // An interactive login shell, so aliases and nvm from your shell config work in actions too.
      const shell = userShell(env);
      file = shell.file;
      args = shell.run(params.command);
      title = params.title ?? 'Action';
    } else {
      const shell = userShell(env);
      file = shell.file;
      args = shell.interactive;
      title = basename(file).replace(/\.exe$/i, '');
    }

    const terminal = {
      info: {
        id: randomUUID(),
        sessionId: params.sessionId,
        kind: params.kind,
        title,
        cwd: params.cwd,
        pid: 0,
        cols: params.cols,
        rows: params.rows,
        exitCode: null,
        startedAt: Date.now(),
      },
      spawn: { file, args, cwd: params.cwd, env, ...(params.kind === 'action' ? { command: params.command } : {}) },
      stopTimers: [],
      replay: [],
      replayLength: 0,
      pending: '',
      timer: undefined,
    } as Partial<Terminal> as Terminal;
    await this.start(terminal);
    this.terminals.set(terminal.info.id, terminal);
    this.options.log('info', `Opened ${params.kind} terminal in ${params.cwd} (pid ${terminal.pty.pid})`);
    this.changed();
    return terminal.info;
  }

  /**
   * Runs an exited terminal's process again in the same tab, keeping its output above.
   * `command` replaces an action's command line (it may have been edited since).
   */
  async restart(id: string, change: { command?: string; cwd?: string } = {}): Promise<TerminalInfo> {
    const terminal = this.require(id);
    if (terminal.info.exitCode === null) throw new Error('This terminal is still running');
    if (change.command !== undefined && terminal.info.kind === 'action') terminal.spawn = { ...terminal.spawn, args: userShell(terminal.spawn.env).run(change.command), command: change.command };
    if (change.cwd !== undefined) terminal.spawn = { ...terminal.spawn, cwd: change.cwd };
    if (!existsSync(terminal.spawn.cwd)) throw new Error(`Folder not found: ${terminal.spawn.cwd}`);
    this.buffer(terminal, '\r\n\x1b[2m── Restarted ──\x1b[0m\r\n\r\n');
    await this.start(terminal);
    terminal.info = { ...terminal.info, cwd: terminal.spawn.cwd, exitCode: null };
    this.options.log('info', `Restarted ${terminal.info.kind} terminal in ${terminal.spawn.cwd} (pid ${terminal.pty.pid})`);
    this.changed();
    return terminal.info;
  }

  /**
   * Stops the running process like Ctrl+C in a terminal does (SIGINT to the foreground job),
   * then terminates and finally kills it if it ignores that. The tab stays open with the exit code.
   */
  stop(id: string): void {
    const terminal = this.terminals.get(id);
    if (!terminal || terminal.info.exitCode !== null || terminal.stopTimers.length > 0) return;
    const pty = terminal.pty;
    const signal = (name: NodeJS.Signals) => {
      if (terminal.pty !== pty || terminal.info.exitCode !== null) return;
      // Windows has no signals or process groups: node-pty refuses a signal there, and kill() ends the
      // console's processes, the shell and what it started.
      if (process.platform === 'win32') {
        try {
          pty.kill();
        } catch {
          // Already gone.
        }
        return;
      }
      // The pty's process leads its own process group; signal the group so children go too.
      try {
        process.kill(-pty.pid, name);
      } catch {
        // No such group (or not ours): the process itself still gets it below.
      }
      try {
        pty.kill(name);
      } catch {
        // Already gone.
      }
    };
    pty.write('\x03');
    terminal.stopTimers.push(
      setTimeout(() => signal('SIGTERM'), STOP_GRACE_MS),
      setTimeout(() => signal('SIGKILL'), STOP_GRACE_MS * 2),
    );
  }

  /** Spawns the terminal's process and wires its output and exit. */
  private async start(terminal: Terminal): Promise<void> {
    this.spawnPty ??= this.options.spawn ? this.options.spawn() : loadNodePty();
    const { file, args, cwd, env } = terminal.spawn;
    const action = terminal.info.kind === 'action';
    // Show what runs: a quiet command like `git fetch` with nothing new prints nothing, and the tab would look like it never ran.
    if (action) this.buffer(terminal, `\x1b[2m$ ${terminal.spawn.command!.replace(/\r?\n/g, '\r\n')}\x1b[0m\r\n`);
    const pty = (await this.spawnPty)(file, args, { name: 'xterm-256color', cols: terminal.info.cols, rows: terminal.info.rows, cwd, env });
    let resolveExit!: (code: number) => void;
    terminal.exited = new Promise<number>((resolve) => (resolveExit = resolve));
    terminal.pty = pty;
    terminal.info = { ...terminal.info, pid: pty.pid };
    pty.onData((data) => {
      if (terminal.pty === pty) this.buffer(terminal, data);
    });
    pty.onExit(({ exitCode, signal }) => {
      if (terminal.pty !== pty) return;
      terminal.stopTimers.splice(0).forEach(clearTimeout);
      // Killed by a signal: report it the way shells do (Ctrl+C is 130), not as a clean 0.
      const code = signal ? 128 + signal : exitCode;
      if (action) {
        const last = (terminal.pending || terminal.replay.at(-1) || '\n').at(-1);
        this.buffer(terminal, `${last === '\n' ? '' : '\r\n'}\x1b[2m── ${code === 0 ? 'Done' : `Exited with code ${code}`} ──\x1b[0m\r\n`);
      }
      this.flush(terminal);
      terminal.info = { ...terminal.info, exitCode: code };
      resolveExit(code);
      this.changed();
    });
  }

  /** Resolves with the exit code (or -1 when the terminal is closed first). */
  waitForExit(id: string): Promise<number> {
    const terminal = this.terminals.get(id);
    return terminal ? Promise.race([terminal.exited, new Promise<number>((resolve) => this.closeWaiters.set(id, () => resolve(-1)))]) : Promise.resolve(-1);
  }

  /** Recent output, for a window attaching to a running terminal. */
  replay(id: string): { info: TerminalInfo; replay: string } {
    const terminal = this.require(id);
    this.flush(terminal);
    return { info: terminal.info, replay: terminal.replay.join('') };
  }

  /** Keystrokes for a terminal that just closed are dropped, not errors (a closing tab can still send one). */
  write(id: string, data: string): void {
    const terminal = this.terminals.get(id);
    if (terminal && terminal.info.exitCode === null) terminal.pty.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const terminal = this.terminals.get(id);
    if (!terminal || terminal.info.exitCode !== null || (terminal.info.cols === cols && terminal.info.rows === rows)) return;
    terminal.pty.resize(cols, rows);
    terminal.info = { ...terminal.info, cols, rows };
  }

  close(id: string): void {
    const terminal = this.terminals.get(id);
    if (!terminal) return;
    if (terminal.timer) clearTimeout(terminal.timer);
    terminal.stopTimers.splice(0).forEach(clearTimeout);
    if (terminal.info.exitCode === null) {
      try {
        terminal.pty.kill();
      } catch {
        // Already gone.
      }
    }
    this.terminals.delete(id);
    this.closeWaiters.get(id)?.();
    this.closeWaiters.delete(id);
    this.changed();
  }

  closeAll(): void {
    for (const id of [...this.terminals.keys()]) this.close(id);
  }

  private require(id: string): Terminal {
    const terminal = this.terminals.get(id);
    if (!terminal) throw new Error('This terminal is gone');
    return terminal;
  }

  /** Batches output: a busy process writes thousands of tiny chunks; windows get one message per ~8 ms. */
  private buffer(terminal: Terminal, data: string): void {
    terminal.pending += data;
    terminal.timer ??= setTimeout(() => this.flush(terminal), FLUSH_MS);
  }

  private flush(terminal: Terminal): void {
    if (terminal.timer) clearTimeout(terminal.timer);
    terminal.timer = undefined;
    const data = terminal.pending;
    if (!data) return;
    terminal.pending = '';
    terminal.replay.push(data);
    terminal.replayLength += data.length;
    while (terminal.replayLength > REPLAY_LIMIT && terminal.replay.length > 1) {
      terminal.replayLength -= terminal.replay.shift()!.length;
    }
    this.options.onData(terminal.info.id, data);
  }

  private changed(): void {
    this.options.onChange(this.list());
  }
}
