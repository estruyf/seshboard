import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { needsCmd, viaCmd } from '../../system/windowsCommand.ts';
import type { InitializeParams, ReadMethods } from './protocol.ts';

/** Where `codex` is, and how to start it (an npm install on Windows runs its script with `node`). */
export interface CodexBinary {
  path: string;
  args?: string[];
  version: string | null;
}

export interface AppServerOptions {
  /** Found again until found: installing Codex works without restarting Seshboard. Null when it isn't installed. */
  binary: () => Promise<CodexBinary | null>;
  /** The environment `codex app-server` runs with, `CODEX_HOME` set to the profile's folder. */
  env: () => Promise<Record<string, string | undefined>>;
  /** Stops the process after this long without a request (it is started again on the next one). */
  idleMs?: number;
  /** How long one request may take before it fails. */
  timeoutMs?: number;
  /** Seshboard's version, sent in `initialize`'s `clientInfo` (Codex puts it in its user agent). */
  clientVersion?: string;
}

/**
 * One `codex app-server` for one profile, spoken to over JSON-RPC on stdio (one JSON object per line). Started on the
 * first request, with `initialize` (`clientInfo.name: 'seshboard'`) and `initialized`, and stopped when idle. A crash
 * fails the requests in flight and the next request starts it again. Never throws from an event handler: a broken
 * Codex can't take the engine down.
 */
export interface AppServer {
  request<M extends keyof ReadMethods>(method: M, params: ReadMethods[M]['params']): Promise<ReadMethods[M]['result']>;
  /** The process's pid while it runs (its own locks don't mean a session is open elsewhere). */
  pid(): number | null;
  dispose(): Promise<void>;
}

/**
 * Why a request failed: Codex isn't installed, it didn't answer in time, the process ended, Codex answered with an
 * error (`rpcCode` is its JSON-RPC code), or the server was disposed.
 */
export class AppServerError extends Error {
  constructor(
    message: string,
    readonly code: 'notInstalled' | 'timeout' | 'exited' | 'rpc' | 'disposed',
    readonly rpcCode?: number,
  ) {
    super(message);
    this.name = 'AppServerError';
  }
}

const disposedError = () => new AppServerError('Codex app-server was disposed.', 'disposed');

const DEFAULT_IDLE_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 30_000;
/** How much of stderr is kept for the message when the process ends. */
const STDERR_TAIL = 4096;
/** How long `dispose` waits for the process to end before it kills it outright. */
const KILL_GRACE_MS = 2000;

interface Pending {
  method: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface Running {
  child: ChildProcessWithoutNullStreams;
  pending: Map<number, Pending>;
  stderr: string;
  exited: boolean;
  /** Resolves when the process has ended. */
  done: Promise<void>;
}

/** Codex's tracing colours its log lines; the message reads better without them. */
const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

export function createAppServer(options: AppServerOptions): AppServer {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let nextId = 1;
  let disposed = false;
  /** The process requests go to, once it answered `initialize`; null while none runs. */
  let ready: Promise<Running> | null = null;
  /** The newest process, from its spawn on: its exit is the one that clears `ready`. */
  let latest: Running | null = null;
  /** Requests waiting for the process or its answer: the idle timer only runs at zero. */
  let inFlight = 0;
  let idleTimer: NodeJS.Timeout | null = null;

  const clearIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  };

  const scheduleIdle = () => {
    clearIdle();
    // Past setTimeout's limit (about 24 days) it would fire at once: that long means never.
    if (disposed || inFlight > 0 || !latest || !(idleMs <= 0x7fffffff)) return;
    const running = latest;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (latest === running && inFlight === 0) stop(running);
    }, idleMs);
    idleTimer.unref();
  };

  /** Forgets the process (the next request starts another) and ends it. */
  const stop = (running: Running) => {
    if (latest === running) {
      latest = null;
      ready = null;
    }
    end(running);
  };

  const end = (running: Running) => {
    if (running.exited) return;
    try {
      running.child.stdin.end();
    } catch {}
    try {
      running.child.kill();
    } catch {}
  };

  const failAll = (running: Running, error: () => Error) => {
    for (const [id, entry] of running.pending) {
      clearTimeout(entry.timer);
      running.pending.delete(id);
      entry.reject(error());
    }
  };

  const write = (running: Running, message: object) => {
    if (running.exited) return;
    try {
      running.child.stdin.write(`${JSON.stringify(message)}\n`);
    } catch {}
  };

  const send = (running: Running, method: string, params: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (running.exited) {
        reject(exitError(running, null, null));
        return;
      }
      const id = nextId++;
      const timer = setTimeout(() => {
        running.pending.delete(id);
        reject(new AppServerError(`Codex didn't answer ${method} within ${Math.round(timeoutMs / 1000)}s.`, 'timeout'));
      }, timeoutMs);
      running.pending.set(id, { method, resolve, reject, timer });
      // Codex accepts `jsonrpc: '2.0'` but doesn't need it, and leaves it out of its own messages.
      write(running, { id, method, params });
    });

  const onMessage = (running: Running, line: string) => {
    let message: { id?: unknown; method?: unknown; result?: unknown; error?: { code?: unknown; message?: unknown } };
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') return;
    if (typeof message.method === 'string') {
      // A request of Codex's own (an approval, a question): Phase 1 starts no turns, so it never takes one.
      if (message.id !== undefined && message.id !== null) {
        write(running, { id: message.id, error: { code: -32601, message: 'Seshboard does not handle this request.' } });
      }
      // Anything else is a notification, which reading needs none of.
      return;
    }
    if (typeof message.id !== 'number') return;
    const entry = running.pending.get(message.id);
    if (!entry) return;
    running.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) {
      const text = typeof message.error.message === 'string' ? message.error.message : 'unknown error';
      entry.reject(new AppServerError(`Codex ${entry.method}: ${text}`, 'rpc', typeof message.error.code === 'number' ? message.error.code : undefined));
    } else {
      entry.resolve(message.result);
    }
  };

  const exitError = (running: Running, code: number | null, signal: NodeJS.Signals | null) => {
    const how = code !== null ? `with code ${code}` : signal ? `on ${signal}` : '';
    const tail = stripAnsi(running.stderr).trim().split('\n').slice(-3).join('\n');
    return new AppServerError(`Codex app-server stopped${how ? ` ${how}` : ''}.${tail ? `\n${tail}` : ''}`, 'exited');
  };

  const launch = async (): Promise<Running> => {
    const binary = await options.binary();
    if (!binary) throw new AppServerError("Codex CLI isn't installed.", 'notInstalled');
    const env = await options.env();
    if (disposed) throw disposedError();
    const args = [...(binary.args ?? []), 'app-server'];
    // `findCodex` never returns a `.cmd`, but a path from elsewhere might be one, which Node won't start without a shell.
    const command = process.platform === 'win32' && needsCmd(binary.path) ? { ...viaCmd(binary.path, args, env), verbatim: true } : { command: binary.path, args, verbatim: false };
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(command.command, command.args, { env: env as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, windowsVerbatimArguments: command.verbatim });
    } catch (error) {
      throw notStarted(error);
    }
    let markDone: () => void = () => {};
    const running: Running = { child, pending: new Map(), stderr: '', exited: false, done: new Promise((resolve) => (markDone = resolve)) };
    latest = running;

    let spawnError: Error | null = null;
    child.on('error', (error) => {
      // ENOENT and EACCES arrive here, asynchronously; 'exit' may not follow, so this ends the process's life too.
      spawnError = notStarted(error);
      finish(null, null);
    });
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (running.exited) return;
      running.exited = true;
      if (latest === running) {
        latest = null;
        ready = null;
        clearIdle();
      }
      failAll(running, () => spawnError ?? (disposed ? disposedError() : exitError(running, code, signal)));
      markDone();
    };
    child.on('exit', (code, signal) => finish(code, signal));
    child.stdin.on('error', () => {});
    child.stdout.on('error', () => {});
    child.stderr.on('error', () => {});
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      running.stderr = (running.stderr + chunk).slice(-STDERR_TAIL);
    });
    child.stdout.setEncoding('utf8');
    let buffer = '';
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
          onMessage(running, line);
        } catch {}
      }
    });

    try {
      const init: InitializeParams = { clientInfo: { name: 'seshboard', title: 'Seshboard', version: options.clientVersion ?? '0' }, capabilities: null };
      await send(running, 'initialize', init);
      write(running, { method: 'initialized' });
    } catch (error) {
      // One that won't start properly is ended, so the next request starts afresh.
      stop(running);
      throw error;
    }
    return running;
  };

  const notStarted = (error: unknown) => {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENOENT') return new AppServerError("Codex CLI isn't installed.", 'notInstalled');
    return new AppServerError(`Couldn't start Codex: ${error instanceof Error ? error.message : String(error)}`, 'exited');
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
    async request(method, params) {
      inFlight++;
      clearIdle();
      try {
        const running = await started();
        // Disposed while the start's answer was on its way.
        if (disposed) throw disposedError();
        return (await send(running, method, params)) as never;
      } finally {
        inFlight--;
        scheduleIdle();
      }
    },
    pid() {
      return latest && !latest.exited ? (latest.child.pid ?? null) : null;
    },
    async dispose() {
      disposed = true;
      clearIdle();
      const starting = ready;
      ready = null;
      // A start still under way is waited for, so its process is ended too.
      const running = latest ?? (await starting?.catch(() => null)) ?? null;
      latest = null;
      if (!running || running.exited) return;
      failAll(running, () => disposedError());
      end(running);
      const grace = setTimeout(() => {
        try {
          running.child.kill('SIGKILL');
        } catch {}
      }, KILL_GRACE_MS);
      await running.done;
      clearTimeout(grace);
    },
  };
}
