import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  COMPANION_INFO_FILE,
  COMPANION_PROTOCOL,
  companionContract,
  lineTransport,
  serveRpc,
  type CompanionContract,
  type CompanionInfo,
  type Handlers,
  type RpcServer,
  type TextStream,
  type Transport,
} from '@switchboard/protocol';

/** Every companion request but `hello`, which the server answers itself once the token checks out. */
export type CompanionHandlers = Omit<Handlers<CompanionContract>, 'hello'>;

export interface CompanionServerOptions {
  /** Where `engine.json` goes (created `0700`). */
  infoDir: string;
  appVersion: string;
  handlers: CompanionHandlers;
  log(level: 'info' | 'warn' | 'error', message: string): void;
  /** Where the socket's own `0700` folder is made. Defaults to the system's temporary folder, whose paths are short. */
  socketParent?: string;
  /** How long a new connection may take to say `hello` (default 5 s). */
  helloTimeoutMs?: number;
}

/** A socket as the line transport needs it. */
function socketStream(socket: Socket): TextStream {
  socket.setEncoding('utf8');
  return {
    write: (text) => {
      if (!socket.destroyed) socket.write(text);
    },
    onData(listener) {
      socket.on('data', listener);
      return () => socket.off('data', listener);
    },
    close: () => socket.end(() => socket.destroy()),
  };
}

const sameToken = (given: unknown, token: string) => {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * The engine's end of the VS Code companion: a Unix socket in a folder only you can open (a named pipe on Windows), and `engine.json` (readable
 * only by you) saying where it is and the token to connect with, the way Claude Code's own editor connection works
 * (`~/.claude/ide/<port>.lock`). A connection that doesn't start with `hello` and the token is closed; every message
 * after that is validated against the companion contract.
 */
export class CompanionServer {
  private server: Server | null = null;
  private socketDir: string | null = null;
  private readonly token = randomBytes(32).toString('hex');
  private readonly sockets = new Set<Socket>();
  private readonly rpcs = new Set<RpcServer<CompanionContract>>();
  private failure: string | null = null;

  constructor(private readonly options: CompanionServerOptions) {}

  /** Editors connected now (past `hello`). */
  get clients(): number {
    return this.rpcs.size;
  }

  get listening(): boolean {
    return this.server?.listening ?? false;
  }

  /** Why it isn't listening, when starting failed. */
  get error(): string | null {
    return this.failure;
  }

  get infoFile(): string {
    return join(this.options.infoDir, COMPANION_INFO_FILE);
  }

  async start(): Promise<void> {
    try {
      this.removeStale();
      // Windows has no Unix sockets: a named pipe, with a name nobody can guess, and the token as the gate
      // (engine.json lives in the user's own AppData, which others can't read).
      let socketPath: string;
      if (windows) {
        socketPath = `\\\\.\\pipe\\switchboard-${randomBytes(16).toString('hex')}`;
      } else {
        this.socketDir = mkdtempSync(join(this.options.socketParent ?? tmpdir(), 'switchboard-'));
        chmodSync(this.socketDir, 0o700);
        socketPath = join(this.socketDir, 'engine.sock');
      }
      const server = createServer((socket) => this.accept(socket));
      this.server = server;
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(socketPath, () => {
          server.off('error', reject);
          resolve();
        });
      });
      server.on('error', (error) => this.options.log('warn', `Companion socket: ${error.message}`));
      if (!windows) chmodSync(socketPath, 0o600);
      this.writeInfo({ protocol: COMPANION_PROTOCOL, socket: socketPath, token: this.token, pid: process.pid, startedAt: Date.now(), appVersion: this.options.appVersion });
      this.failure = null;
    } catch (error) {
      this.failure = (error as Error).message;
      this.options.log('warn', `The VS Code companion can't connect: ${this.failure}`);
      this.stop();
    }
  }

  stop(): void {
    for (const rpc of this.rpcs) rpc.dispose();
    this.rpcs.clear();
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    this.server?.close();
    this.server = null;
    // Only our own file: another engine (a second build on the same data folder) may have written it since.
    try {
      const info = JSON.parse(readFileSync(this.infoFile, 'utf8')) as Partial<CompanionInfo>;
      if (info.token === this.token) rmSync(this.infoFile, { force: true });
    } catch {
      // Not there, or not ours to read.
    }
    if (this.socketDir) rmSync(this.socketDir, { recursive: true, force: true });
    this.socketDir = null;
  }

  private writeInfo(info: CompanionInfo): void {
    mkdirSync(this.options.infoDir, { recursive: true, mode: 0o700 });
    chmodSync(this.options.infoDir, 0o700);
    // Written aside and renamed, so a reader never sees half a file.
    const temporary = `${this.infoFile}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, this.infoFile);
  }

  /** The socket folder of an engine that crashed without cleaning up (its process is gone). */
  private removeStale(): void {
    if (!existsSync(this.infoFile)) return;
    try {
      const info = JSON.parse(readFileSync(this.infoFile, 'utf8')) as Partial<CompanionInfo>;
      if (typeof info.pid === 'number' && info.pid !== process.pid && alive(info.pid)) return;
      const dir = typeof info.socket === 'string' ? dirname(info.socket) : null;
      if (dir && basename(dir).startsWith('switchboard-')) rmSync(dir, { recursive: true, force: true });
    } catch {
      // Unreadable: it is about to be replaced anyway.
    }
  }

  private accept(socket: Socket): void {
    this.sockets.add(socket);
    const stream = socketStream(socket);
    const raw = lineTransport(stream, { onProtocolError: (reason) => this.options.log('warn', `Companion connection closed: ${reason}`) });
    let rpc: RpcServer<CompanionContract> | null = null;
    let authorised = false;
    const timer = setTimeout(() => !authorised && socket.destroy(), this.options.helloTimeoutMs ?? 5_000);
    // Until `hello` with the token, nothing reaches the handlers; a wrong first message ends the connection.
    const gated: Transport = {
      send: raw.send,
      onMessage: (listener) =>
        raw.onMessage((message) => {
          if (authorised) return listener(message);
          const params = message.kind === 'request' ? (message.params as { token?: unknown } | null) : null;
          if (message.kind === 'request' && message.method === 'hello' && sameToken(params?.token, this.token)) {
            authorised = true;
            clearTimeout(timer);
            if (rpc) this.rpcs.add(rpc);
            return listener(message);
          }
          if (message.kind === 'request') raw.send({ kind: 'response', id: message.id, ok: false, error: { code: 'UNAUTHORIZED', message: 'Say hello with the token from engine.json first' } });
          stream.close();
        }),
      close: raw.close,
    };
    rpc = serveRpc(
      companionContract,
      gated,
      {
        ...this.options.handlers,
        hello: () => ({ protocol: COMPANION_PROTOCOL, app: { version: this.options.appVersion } }),
      },
      { onUnexpectedError: (method, error) => this.options.log('error', `Companion ${method} failed: ${error instanceof Error ? error.message : String(error)}`) },
    );
    const done = () => {
      clearTimeout(timer);
      this.sockets.delete(socket);
      if (rpc) {
        this.rpcs.delete(rpc);
        rpc.dispose();
      }
    };
    socket.on('close', done);
    socket.on('error', () => socket.destroy());
  }
}

const windows = process.platform === 'win32';

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
