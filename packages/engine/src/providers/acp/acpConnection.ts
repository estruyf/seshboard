import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { needsCmd, viaCmd } from '../../system/windowsCommand.ts';
import type { AcpInitializeResponse } from './acpTypes.ts';

/** The command that starts an agent's ACP side (`gemini --acp`): its path and its arguments. */
export interface AcpCommand {
  path: string;
  args: string[];
}

export interface AcpConnectionOptions {
  /** Who the agent is, in its errors ("Gemini CLI isn't installed."). */
  agentName: string;
  /** Found again until found: installing the agent works without restarting Seshboard. Null when it isn't installed. */
  command: () => Promise<AcpCommand | null>;
  /** The environment the agent runs with (its profile's folder set). */
  env: () => Promise<Record<string, string | undefined>>;
  /** Stops the process after this long with nothing to do (it is started again on the next request). */
  idleMs?: number;
  /** How long a request may take before it fails, unless it says otherwise (`session/prompt` waits for the whole turn). */
  timeoutMs?: number;
  /** Seshboard's version, sent in `initialize`'s `clientInfo`. */
  clientVersion?: string;
  /** How long a stopped process gets to end before it is killed outright. */
  killGraceMs?: number;
}

/**
 * One agent process that speaks the Agent Client Protocol (https://agentclientprotocol.com) on stdio: JSON-RPC 2.0,
 * one message per line. Started on the first request with `initialize` (protocol version 1, no file system or terminal
 * of Seshboard's offered: the agent reads and writes files and runs commands itself), and stopped when idle. A crash
 * fails the requests in flight and the next request starts it again. Never throws from an event handler: a broken
 * agent can't take the engine down.
 */
export interface AcpConnection {
  /** `timeoutMs: null` waits as long as it takes (a turn). */
  request<T = unknown>(method: string, params: unknown, options?: { timeoutMs?: number | null }): Promise<T>;
  /** Sends a notification (`session/cancel`); nothing when no process runs. */
  notify(method: string, params: unknown): void;
  /** What the running process answered `initialize` with; null before one started. */
  initialized(): AcpInitializeResponse | null;
  /** Every notification the agent sends (`session/update`). Returns the function that stops listening. */
  onNotification(listener: (method: string, params: unknown) => void): () => void;
  /**
   * The one handler of the agent's own requests (`session/request_permission`); its result, or its error, goes back.
   * With none, they are refused. `signal` aborts when the process ended and nobody waits for the answer.
   */
  handleRequests(handler: AcpRequestHandler | null): void;
  /** Keeps the process from its idle stop while a session lives in it. Returns the function that lets go. */
  hold(): () => void;
  /** Called when a process ends while held: its sessions are gone, and must be loaded again in the next one. */
  onExit(listener: () => void): () => void;
  pid(): number | null;
  dispose(): Promise<void>;
}

export type AcpRequestHandler = (method: string, params: unknown, signal: AbortSignal) => Promise<unknown>;

/**
 * Why a request failed: the agent isn't installed, it didn't answer in time, the process ended, it answered with an
 * error (`rpcCode` is its JSON-RPC code: ACP's `-32000` is "authentication required"), or the connection was disposed.
 */
export class AcpError extends Error {
  constructor(
    message: string,
    readonly code: 'notInstalled' | 'timeout' | 'exited' | 'rpc' | 'disposed',
    readonly rpcCode?: number,
  ) {
    super(message);
    this.name = 'AcpError';
  }
}

/** ACP's error for a session that can't start until the agent is signed in. */
export const AUTH_REQUIRED = -32000;

const DEFAULT_IDLE_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 60_000;
const STDERR_TAIL = 4096;
const KILL_GRACE_MS = 2000;
/** How long after the process ended its output may still be read: a child of the agent's can hold the pipe open. */
const CLOSE_GRACE_MS = 1000;

interface Pending {
  method: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout | null;
}

interface Running {
  child: ChildProcessWithoutNullStreams;
  pending: Map<number, Pending>;
  stderr: string;
  exited: boolean;
  holds: Set<symbol>;
  served: Map<number | string, AbortController>;
  init: AcpInitializeResponse | null;
  killTimer: NodeJS.Timeout | null;
  done: Promise<void>;
}

const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

export function createAcpConnection(options: AcpConnectionOptions): AcpConnection {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const killGraceMs = options.killGraceMs ?? KILL_GRACE_MS;
  const name = options.agentName;
  const disposedError = () => new AcpError(`${name} was stopped.`, 'disposed');
  const notInstalled = () => new AcpError(`${name} isn't installed.`, 'notInstalled');
  let nextId = 1;
  let disposed = false;
  let ready: Promise<Running> | null = null;
  let latest: Running | null = null;
  let inFlight = 0;
  let idleTimer: NodeJS.Timeout | null = null;
  const notificationListeners = new Set<(method: string, params: unknown) => void>();
  const exitListeners = new Set<() => void>();
  let requestHandler: AcpRequestHandler | null = null;
  let nextHolds = new Set<symbol>();

  const idle = (running: Running) => inFlight === 0 && running.holds.size === 0 && running.served.size === 0;
  const clearIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  };
  const scheduleIdle = () => {
    clearIdle();
    if (disposed || !latest || !idle(latest) || !(idleMs <= 0x7fffffff)) return;
    const running = latest;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (latest === running && idle(running)) stop(running);
    }, idleMs);
    idleTimer.unref();
  };

  const stop = (running: Running) => {
    if (latest === running) {
      latest = null;
      ready = null;
    }
    end(running);
  };

  /** Asks the process to end (an ACP agent ends when its stdin closes), and kills it if it hasn't after a grace period. */
  const end = (running: Running) => {
    if (running.exited || running.killTimer) return;
    try {
      running.child.stdin.end();
    } catch {}
    try {
      running.child.kill();
    } catch {}
    running.killTimer = setTimeout(() => {
      try {
        running.child.kill('SIGKILL');
      } catch {}
    }, killGraceMs);
    running.killTimer.unref();
  };

  const failAll = (running: Running, error: () => Error) => {
    for (const [id, entry] of running.pending) {
      if (entry.timer) clearTimeout(entry.timer);
      running.pending.delete(id);
      entry.reject(error());
    }
  };

  const write = (running: Running, message: object) => {
    if (running.exited) return;
    try {
      running.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
    } catch {}
  };

  const send = (running: Running, method: string, params: unknown, wait: number | null): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (running.exited) {
        reject(exitError(running, null, null));
        return;
      }
      const id = nextId++;
      const timer =
        wait === null
          ? null
          : setTimeout(() => {
              running.pending.delete(id);
              reject(new AcpError(`${name} didn't answer ${method} within ${Math.round(wait / 1000)}s.`, 'timeout'));
              // Nothing else waits on it and no session lives in it: a fresh process answers the next request.
              if (running.pending.size === 0 && running.holds.size === 0) stop(running);
            }, wait);
      running.pending.set(id, { method, resolve, reject, timer });
      write(running, { id, method, params });
    });

  const onMessage = (running: Running, line: string) => {
    let message: { id?: unknown; method?: unknown; params?: unknown; result?: unknown; error?: { code?: unknown; message?: unknown } };
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') return;
    if (typeof message.method === 'string') {
      if (message.id !== undefined && message.id !== null) serve(running, message.id as number | string, message.method, message.params);
      else for (const listener of [...notificationListeners]) {
        try {
          listener(message.method, message.params);
        } catch {}
      }
      return;
    }
    if (typeof message.id !== 'number') return;
    const entry = running.pending.get(message.id);
    if (!entry) return;
    running.pending.delete(message.id);
    if (entry.timer) clearTimeout(entry.timer);
    if (message.error) {
      const text = typeof message.error.message === 'string' ? message.error.message : 'unknown error';
      entry.reject(new AcpError(text, 'rpc', typeof message.error.code === 'number' ? message.error.code : undefined));
    } else entry.resolve(message.result);
  };

  /** Answers one of the agent's requests with the handler's result. No timeout: it may wait for a person at a card. */
  const serve = (running: Running, id: number | string, method: string, params: unknown) => {
    const handler = requestHandler;
    if (!handler) {
      write(running, { id, error: { code: -32601, message: 'Seshboard does not handle this request.' } });
      return;
    }
    const controller = new AbortController();
    running.served.set(id, controller);
    clearIdle();
    const answer = (message: object) => {
      if (controller.signal.aborted) return;
      write(running, { id, ...message });
    };
    void Promise.resolve()
      .then(() => handler(method, params, controller.signal))
      .then(
        (result) => answer({ result: result ?? null }),
        (error: unknown) => {
          const code = (error as { rpcCode?: unknown } | null)?.rpcCode;
          answer({ error: { code: typeof code === 'number' ? code : -32603, message: error instanceof Error ? error.message : String(error) } });
        },
      )
      .catch(() => {})
      .finally(() => {
        if (running.served.get(id) === controller) running.served.delete(id);
        scheduleIdle();
      });
  };

  const exitError = (running: Running, code: number | null, signal: NodeJS.Signals | null) => {
    const how = code !== null ? `with code ${code}` : signal ? `on ${signal}` : '';
    const tail = stripAnsi(running.stderr).trim().split('\n').slice(-3).join('\n');
    return new AcpError(`${name} stopped${how ? ` ${how}` : ''}.${tail ? `\n${tail}` : ''}`, 'exited');
  };

  const notStarted = (error: unknown) => {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return notInstalled();
    return new AcpError(`Couldn't start ${name}: ${error instanceof Error ? error.message : String(error)}`, 'exited');
  };

  const launch = async (): Promise<Running> => {
    const found = await options.command();
    if (!found) throw notInstalled();
    const env = await options.env();
    if (disposed) throw disposedError();
    // A path from elsewhere may be a `.cmd`, which Node won't start without a shell.
    const command = process.platform === 'win32' && needsCmd(found.path) ? { ...viaCmd(found.path, found.args, env), verbatim: true } : { command: found.path, args: found.args, verbatim: false };
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(command.command, command.args, { env: env as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, windowsVerbatimArguments: command.verbatim });
    } catch (error) {
      throw notStarted(error);
    }
    let markDone: () => void = () => {};
    const running: Running = { child, pending: new Map(), stderr: '', exited: false, holds: nextHolds, served: new Map(), init: null, killTimer: null, done: new Promise((resolve) => (markDone = resolve)) };
    latest = running;
    nextHolds = new Set();

    let spawnError: Error | null = null;
    let closeTimer: NodeJS.Timeout | null = null;
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (running.exited) return;
      running.exited = true;
      if (running.killTimer) clearTimeout(running.killTimer);
      if (closeTimer) clearTimeout(closeTimer);
      if (latest === running) {
        latest = null;
        ready = null;
        clearIdle();
      }
      failAll(running, () => spawnError ?? (disposed ? disposedError() : exitError(running, code, signal)));
      for (const controller of running.served.values()) controller.abort();
      running.served.clear();
      const wasHeld = running.holds.size > 0;
      running.holds.clear();
      if (wasHeld && !disposed) {
        for (const listener of [...exitListeners]) {
          try {
            listener();
          } catch {}
        }
      }
      markDone();
    };
    child.on('error', (error) => {
      spawnError = notStarted(error);
      finish(null, null);
    });
    child.on('close', (code, signal) => finish(code, signal));
    child.on('exit', (code, signal) => {
      closeTimer = setTimeout(() => finish(code, signal), CLOSE_GRACE_MS);
      closeTimer.unref();
    });
    child.stdin.on('error', () => {});
    child.stdout.on('error', () => {});
    child.stderr.on('error', () => {});
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      running.stderr = (running.stderr + chunk).slice(-STDERR_TAIL);
    });
    child.stdout.setEncoding('utf8');
    let partial: string[] = [];
    child.stdout.on('data', (chunk: string) => {
      let from = 0;
      let newline: number;
      while ((newline = chunk.indexOf('\n', from)) >= 0) {
        const piece = chunk.slice(from, newline);
        const line = (partial.length ? partial.join('') + piece : piece).trim();
        partial = [];
        from = newline + 1;
        if (!line) continue;
        try {
          onMessage(running, line);
        } catch {}
      }
      if (from < chunk.length) partial.push(chunk.slice(from));
    });

    try {
      running.init = (await send(
        running,
        'initialize',
        {
          protocolVersion: 1,
          // The agent works on the files and runs the commands itself, as in its own CLI: Seshboard offers neither.
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: { name: 'seshboard', title: 'Seshboard', version: options.clientVersion ?? '0' },
        },
        timeoutMs,
      )) as AcpInitializeResponse;
    } catch (error) {
      stop(running);
      throw error;
    }
    return running;
  };

  const started = (): Promise<Running> => {
    if (disposed) return Promise.reject(disposedError());
    if (!ready) {
      const starting: Promise<Running> = launch().catch((error: unknown) => {
        if (ready === starting) ready = null;
        throw error;
      });
      ready = starting;
    }
    return ready;
  };

  return {
    async request(method, params, requestOptions) {
      inFlight++;
      clearIdle();
      try {
        const running = await started();
        if (disposed) throw disposedError();
        return (await send(running, method, params, requestOptions?.timeoutMs === undefined ? timeoutMs : requestOptions.timeoutMs)) as never;
      } finally {
        inFlight--;
        scheduleIdle();
      }
    },
    notify(method, params) {
      if (latest && !latest.exited) write(latest, { method, params });
    },
    initialized: () => (latest && !latest.exited ? latest.init : null),
    pid: () => (latest && !latest.exited ? (latest.child.pid ?? null) : null),
    onNotification(listener) {
      notificationListeners.add(listener);
      return () => {
        notificationListeners.delete(listener);
      };
    },
    handleRequests(handler) {
      requestHandler = handler;
    },
    hold() {
      const token = Symbol('hold');
      const set = latest && !latest.exited ? latest.holds : nextHolds;
      set.add(token);
      clearIdle();
      return () => {
        if (set.delete(token)) scheduleIdle();
      };
    },
    onExit(listener) {
      const wrapped = () => listener();
      exitListeners.add(wrapped);
      return () => {
        exitListeners.delete(wrapped);
      };
    },
    async dispose() {
      disposed = true;
      clearIdle();
      const starting = ready;
      ready = null;
      const running = latest ?? (await starting?.catch(() => null)) ?? null;
      latest = null;
      if (!running || running.exited) return;
      failAll(running, () => disposedError());
      end(running);
      await running.done;
    },
  };
}
