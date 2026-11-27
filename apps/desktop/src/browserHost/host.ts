import type { BrowserHostMessage, CompanionInfo, WireMessage } from '@seshboard/protocol/companion-client';
import { encodeFrame, lineSplitter, MAX_FRAME_TO_BROWSER } from './frames.ts';

// Type-only imports above: this file is bundled on its own (browser-host.js) and copied out of the app, so it takes no
// code from the other bundles. These two values are checked against the protocol's in host.test.ts.
/** `COMPANION_PROTOCOL`. */
export const HOST_PROTOCOL = 1;
/** The name the engine counts browsers by (`BROWSER_CLIENT`). */
export const HOST_CLIENT_NAME = 'browser';

/** What Seshboard writes next to the host when it installs it (`host.json`). */
export interface HostConfig {
  /** The `engine.json` files to try, this app's own first. */
  infoFiles: string[];
  /** How to open Seshboard when it isn't running; null for a development build. */
  launch: { command: string; args: string[] } | null;
  /** The app's version, said in `hello`. */
  version: string;
}

/** A connection to the engine's socket, as the host needs it (a `net.Socket`). */
export interface HostSocket {
  write(text: string): void;
  destroy(): void;
  on(event: 'connect', listener: () => void): void;
  on(event: 'data', listener: (chunk: string) => void): void;
  on(event: 'close' | 'error', listener: () => void): void;
}

export interface HostIo {
  /** Writes one framed message to stdout. */
  write(frame: Buffer): void;
  readFile(path: string): string | null;
  alive(pid: number): boolean;
  connect(socketPath: string): HostSocket;
  launch(command: string, args: string[]): void;
  /** How often to look for Seshboard again while it isn't there (default 2 s). */
  retryMs?: number;
}

type Status = Extract<BrowserHostMessage, { type: 'status' }>;

const HELLO_ID = 0;

/**
 * The browser extension's native messaging host. The browser starts it for the extension and talks to it over
 * stdin and stdout. It finds Seshboard's `engine.json`, connects to the engine's socket and says `hello` with the
 * token (which never reaches the browser), then passes companion messages both ways. While Seshboard isn't running it
 * answers requests with NOT_RUNNING and keeps looking, so the extension notices when it starts.
 */
export class BrowserHost {
  private socket: HostSocket | null = null;
  private connected = false;
  private status: Status = { type: 'status', state: 'connecting' };
  /** Requests sent to the engine and not answered yet: they fail when the connection drops. */
  private readonly pending = new Set<number>();
  private retry: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(
    private readonly config: HostConfig,
    private readonly io: HostIo,
  ) {}

  start(): void {
    this.send(this.status);
    this.tryConnect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.retry);
    this.socket?.destroy();
  }

  /** A message from the extension. */
  receive(message: unknown): void {
    const m = message as Partial<BrowserHostMessage> | null;
    if (m?.type === 'launch') {
      if (this.connected) return;
      if (this.config.launch) this.io.launch(this.config.launch.command, this.config.launch.args);
      this.tryConnect();
      return;
    }
    if (m?.type !== 'wire' || !m.message || typeof m.message !== 'object') return;
    const wire = m.message as WireMessage;
    if (wire.kind !== 'request' || typeof wire.id !== 'number' || wire.id === HELLO_ID) return;
    // The extension never says hello itself: the host already did, with the token.
    if (wire.method === 'hello') return this.reply(wire.id, 'INVALID_PARAMS', 'The host says hello for the extension');
    if (!this.connected || !this.socket) return this.reply(wire.id, 'NOT_RUNNING', 'Seshboard is not running');
    this.pending.add(wire.id);
    this.socket.write(`${JSON.stringify(wire)}\n`);
  }

  private tryConnect(): void {
    clearTimeout(this.retry);
    if (this.stopped || this.socket) return;
    const info = this.findEngine();
    if (info === 'incompatible') return this.offline({ type: 'status', state: 'incompatible', detail: 'Update Seshboard and the extension to the same version' });
    if (!info) return this.offline({ type: 'status', state: 'not-running', canLaunch: !!this.config.launch });
    const socket = this.io.connect(info.socket);
    this.socket = socket;
    const onLine = lineSplitter((line) => this.fromEngine(line, info));
    socket.on('connect', () => {
      const hello: WireMessage = { kind: 'request', id: HELLO_ID, method: 'hello', params: { token: info.token, protocol: HOST_PROTOCOL, client: { name: HOST_CLIENT_NAME, version: this.config.version } } };
      socket.write(`${JSON.stringify(hello)}\n`);
    });
    socket.on('data', onLine);
    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.connected = false;
      for (const id of this.pending) this.reply(id, 'DISCONNECTED', 'Seshboard closed the connection');
      this.pending.clear();
      if (this.status.state !== 'incompatible') this.offline({ type: 'status', state: 'not-running', canLaunch: !!this.config.launch });
      else this.scheduleRetry();
    });
  }

  private fromEngine(line: string, info: CompanionInfo): void {
    let message: WireMessage;
    try {
      message = JSON.parse(line) as WireMessage;
    } catch {
      return;
    }
    if (message.kind === 'response' && message.id === HELLO_ID) {
      if (message.ok) {
        this.connected = true;
        const appVersion = (message.result as { app?: { version?: string } } | null)?.app?.version ?? info.appVersion;
        this.setStatus({ type: 'status', state: 'connected', appVersion });
      } else {
        this.setStatus({ type: 'status', state: 'incompatible', detail: message.error.message });
        this.socket?.destroy();
      }
      return;
    }
    if (message.kind === 'response') this.pending.delete(message.id);
    const frame = encodeFrame({ type: 'wire', message } satisfies BrowserHostMessage);
    if (frame.length <= MAX_FRAME_TO_BROWSER) return this.io.write(frame);
    // Chrome drops a host over this size: a response says so instead, and a large event is left out.
    if (message.kind === 'response') this.reply(message.id, 'TOO_LARGE', 'The answer is too large for the browser');
  }

  /** The first `engine.json` whose engine is running; `incompatible` when the only running one speaks another protocol. */
  private findEngine(): CompanionInfo | 'incompatible' | null {
    let incompatible = false;
    for (const file of this.config.infoFiles) {
      const text = this.io.readFile(file);
      if (!text) continue;
      try {
        const info = JSON.parse(text) as Partial<CompanionInfo>;
        if (typeof info.socket !== 'string' || typeof info.token !== 'string' || typeof info.pid !== 'number') continue;
        if (!this.io.alive(info.pid)) continue;
        if (info.protocol === HOST_PROTOCOL) return info as CompanionInfo;
        incompatible = true;
      } catch {
        // A file half written or from another version: the next one may do.
      }
    }
    return incompatible ? 'incompatible' : null;
  }

  private offline(status: Status): void {
    this.setStatus(status);
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    clearTimeout(this.retry);
    this.retry = setTimeout(() => this.tryConnect(), this.io.retryMs ?? 2_000);
  }

  private setStatus(status: Status): void {
    const same = JSON.stringify(status) === JSON.stringify(this.status);
    this.status = status;
    if (!same) this.send(status);
  }

  private reply(id: number, code: string, message: string): void {
    this.send({ type: 'wire', message: { kind: 'response', id, ok: false, error: { code, message } } });
  }

  private send(message: BrowserHostMessage): void {
    this.io.write(encodeFrame(message));
  }
}
