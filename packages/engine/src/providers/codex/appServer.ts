import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { needsCmd, viaCmd } from '../../system/windowsCommand.ts';
import type { InitializeParams, Methods, ServerNotification, ServerRequest } from './protocol.ts';

/** Where `codex` is, and what goes before `app-server` on its command line (`-c` overrides). */
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
  /** How long a stopped process gets to end before it is killed outright (tests shorten or lengthen it). */
  killGraceMs?: number;
  /** Opts into Codex's experimental API in `initialize` (`turn/start`'s `collaborationMode`, for Plan mode). */
  experimentalApi?: boolean;
}

/**
 * One `codex app-server` for one profile, spoken to over JSON-RPC on stdio (one JSON object per line). Started on the
 * first request, with `initialize` (`clientInfo.name: 'seshboard'`) and `initialized`, and stopped when idle. A crash
 * fails the requests in flight and the next request starts it again. Never throws from an event handler: a broken
 * Codex can't take the engine down.
 */
export interface AppServer {
  request<M extends keyof Methods>(method: M, params: Methods[M]['params']): Promise<Methods[M]['result']>;
  /** Every notification Codex sends, from any process this server starts. Returns the function that stops listening. */
  onNotification(listener: (notification: ServerNotification) => void): () => void;
  /**
   * The one handler of Codex's own requests (approvals, questions); its result, or its error, goes back to Codex. With
   * none, they are refused. `signal` aborts when the request no longer needs an answer: Codex resolved it itself
   * (`serverRequest/resolved`, the turn was interrupted) or its process ended. The handler then drops its card; what it
   * returns after that is not sent.
   */
  handleRequests(handler: RequestHandler | null): void;
  /**
   * Keeps the process from its idle stop while something needs it (a thread loaded here, which a new process would not
   * have). Returns the function that lets go.
   */
  hold(): () => void;
  /** Called when a process ends while held: its loaded threads are gone, and must be resumed in the next one. */
  onExit(listener: () => void): () => void;
  /** The process's pid while it runs (its own locks don't mean a session is open elsewhere). */
  pid(): number | null;
  dispose(): Promise<void>;
}

/** Answers one of Codex's requests; `signal` aborts when the answer is no longer wanted (see `handleRequests`). */
export type RequestHandler = (request: ServerRequest, signal: AbortSignal) => Promise<unknown>;

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
/** How long a stopped process gets to end before it is killed outright. */
const KILL_GRACE_MS = 2000;
/** How long after the process ended its output may still be read: a child of Codex's can hold the pipe open. */
const CLOSE_GRACE_MS = 1000;
/** Timeouts in a row after which a process that still has requests waiting is taken as stuck. */
const STUCK_AFTER_TIMEOUTS = 2;

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
  /** Requests that timed out since it last said anything. */
  timeouts: number;
  /** Holds taken while this process ran: its loaded threads, which end with it. */
  holds: Set<symbol>;
  /** Codex's requests waiting for the handler, by their id. */
  served: Map<number | string, AbortController>;
  /** Why it was stopped, when that wasn't dispose: what its waiting requests fail with. */
  stopReason: (() => Error) | null;
  killTimer: NodeJS.Timeout | null;
  /** Resolves when the process has ended. */
  done: Promise<void>;
}

/** Codex's tracing colours its log lines; the message reads better without them. */
const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

export function createAppServer(options: AppServerOptions): AppServer {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const killGraceMs = options.killGraceMs ?? KILL_GRACE_MS;
  let nextId = 1;
  let disposed = false;
  /** The process requests go to, once it answered `initialize`; null while none runs. */
  let ready: Promise<Running> | null = null;
  /** The newest process, from its spawn on: its exit is the one that clears `ready`. */
  let latest: Running | null = null;
  /** Requests waiting for the process or its answer: the idle timer only runs at zero. */
  let inFlight = 0;
  let idleTimer: NodeJS.Timeout | null = null;
  const notificationListeners = new Set<(notification: ServerNotification) => void>();
  const exitListeners = new Set<() => void>();
  let requestHandler: RequestHandler | null = null;
  /**
   * Holds taken while no process runs (or one is being stopped): the next process takes them on. A hold belongs to one
   * process, so one that ends never lets go of another's.
   */
  let nextHolds = new Set<symbol>();

  /** Whether the process may stop for being idle: nothing waits on it, and nothing holds it. */
  const idle = (running: Running) => inFlight === 0 && running.holds.size === 0 && running.served.size === 0;

  const clearIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  };

  const scheduleIdle = () => {
    clearIdle();
    // Past setTimeout's limit (about 24 days) it would fire at once: that long means never.
    if (disposed || !latest || !idle(latest) || !(idleMs <= 0x7fffffff)) return;
    const running = latest;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (latest === running && idle(running)) stop(running);
    }, idleMs);
    idleTimer.unref();
  };

  /** Forgets the process (the next request starts another) and ends it. */
  const stop = (running: Running, reason?: () => Error) => {
    if (latest === running) {
      latest = null;
      ready = null;
    }
    running.stopReason ??= reason ?? null;
    // Stopped for being stuck: what still waits fails now, not when the process is gone (it may take the grace period).
    if (reason) failAll(running, reason);
    end(running);
  };

  /** Asks the process to end (Codex ends when its stdin closes), and kills it if it hasn't after a grace period. */
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
        // A process that answers nothing would make every later request wait out its timeout too: with nothing else
        // waiting, or after timeouts in a row with no word from it between, it is stopped and the next request starts a
        // fresh one. A held one has threads loaded (a turn may be running) that a slow request alone is no reason to
        // lose: only timeouts in a row stop it.
        running.timeouts++;
        if ((running.pending.size === 0 && running.holds.size === 0) || running.timeouts >= STUCK_AFTER_TIMEOUTS) {
          stop(running, () => new AppServerError('Codex app-server stopped answering and was stopped.', 'exited'));
        }
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
    // Any word from it means it isn't stuck.
    running.timeouts = 0;
    if (typeof message.method === 'string') {
      const params = (message as { params?: unknown }).params;
      if (message.id !== undefined && message.id !== null) {
        serve(running, { id: message.id as number | string, method: message.method, params });
        return;
      }
      if (message.method === 'serverRequest/resolved') {
        const id = (params as { requestId?: unknown } | null)?.requestId;
        if (typeof id === 'number' || typeof id === 'string') unserve(running, id);
      }
      notify({ method: message.method, params });
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

  const notify = (notification: ServerNotification) => {
    for (const listener of [...notificationListeners]) {
      try {
        listener(notification);
      } catch {}
    }
  };

  /**
   * Answers a request of Codex's own (an approval, a question) with the handler's result, back to the process that
   * asked. No timeout: it may wait for a person at a permission card. Without a handler it is refused.
   */
  const serve = (running: Running, request: ServerRequest) => {
    const handler = requestHandler;
    if (!handler) {
      write(running, { id: request.id, error: { code: -32601, message: 'Seshboard does not handle this request.' } });
      return;
    }
    unserve(running, request.id);
    const controller = new AbortController();
    running.served.set(request.id, controller);
    clearIdle();
    const answer = (message: object) => {
      // Codex resolved it itself, or the process ended: nobody waits for this answer.
      if (controller.signal.aborted) return;
      write(running, { id: request.id, ...message });
    };
    void Promise.resolve()
      .then(() => handler(request, controller.signal))
      .then(
        (result) => answer({ result: result ?? null }),
        (error: unknown) => {
          const code = (error as { rpcCode?: unknown; code?: unknown } | null)?.rpcCode ?? (error as { code?: unknown } | null)?.code;
          answer({ error: { code: typeof code === 'number' ? code : -32603, message: error instanceof Error ? error.message : String(error) } });
        },
      )
      .catch(() => {})
      .finally(() => {
        if (running.served.get(request.id) === controller) running.served.delete(request.id);
        scheduleIdle();
      });
  };

  /** A request of Codex's that no longer needs an answer: its handler is told, and it stops keeping the process. */
  const unserve = (running: Running, id: number | string) => {
    const controller = running.served.get(id);
    if (!controller) return;
    running.served.delete(id);
    controller.abort();
    scheduleIdle();
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
    const running: Running = {
      child,
      pending: new Map(),
      stderr: '',
      exited: false,
      timeouts: 0,
      // Holds taken before it started (while it was being looked for) are its own.
      holds: nextHolds,
      served: new Map(),
      stopReason: null,
      killTimer: null,
      done: new Promise((resolve) => (markDone = resolve)),
    };
    latest = running;
    nextHolds = new Set();

    let spawnError: Error | null = null;
    child.on('error', (error) => {
      // ENOENT and EACCES arrive here, asynchronously; 'close' may not follow, so this ends the process's life too.
      spawnError = notStarted(error);
      finish(null, null);
    });
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
      failAll(running, () => spawnError ?? running.stopReason?.() ?? (disposed ? disposedError() : exitError(running, code, signal)));
      for (const controller of running.served.values()) controller.abort();
      running.served.clear();
      // Its loaded threads went with it: whoever held it is told, unless Seshboard ended it (dispose). Holds on a newer
      // process are that one's.
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
    // 'close' comes once stdout is read to the end, so an answer written just before the process ended still counts.
    // A child of Codex's that kept the pipe could hold it back, so 'exit' ends it all a moment later anyway.
    let closeTimer: NodeJS.Timeout | null = null;
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
    // The start of a line that hasn't ended yet, in pieces: a long answer (a big thread's turns) comes in many chunks,
    // and only each new chunk is searched for its end.
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
      const init: InitializeParams = {
        clientInfo: { name: 'seshboard', title: 'Seshboard', version: options.clientVersion ?? '0' },
        capabilities: options.experimentalApi ? { experimentalApi: true } : null,
      };
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
      // The running process's, or the next one's when none runs or this one is being stopped.
      const set = latest && !latest.exited ? latest.holds : nextHolds;
      set.add(token);
      clearIdle();
      return () => {
        // A hold on a process that ended was cleared with it, so letting go of it changes nothing.
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
      // A start still under way is waited for, so its process is ended too.
      const running = latest ?? (await starting?.catch(() => null)) ?? null;
      latest = null;
      if (!running || running.exited) return;
      failAll(running, () => disposedError());
      end(running);
      await running.done;
    },
  };
}
