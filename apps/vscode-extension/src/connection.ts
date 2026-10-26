import { readFile } from 'node:fs/promises';
import { createConnection, type Socket } from 'node:net';
import { homedir } from 'node:os';
import { COMPANION_PROTOCOL, createRpcClient, lineTransport, type CompanionContract, type RpcClient } from '@seshboard/protocol/companion-client';
import { infoFiles, pickInfo } from './discovery.ts';

export type CompanionClient = RpcClient<CompanionContract>;

export type ConnectionState =
  | { kind: 'connected'; client: CompanionClient; appVersion: string }
  | { kind: 'offline'; reason: 'not-running' | 'incompatible' | 'failed'; detail: string };

export interface ConnectionOptions {
  /** `switchboard.appDataFolder`: where to look for `engine.json` instead of the usual places. */
  appDataFolder(): string;
  version: string;
  log(message: string): void;
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/**
 * The connection to Seshboard's engine: finds `engine.json`, connects to its Unix socket and says hello with the
 * token. While Seshboard isn't running it looks again every few seconds, so the status bar notices it starting.
 */
export class SeshboardConnection {
  private current: ConnectionState = { kind: 'offline', reason: 'not-running', detail: 'Not connected yet' };
  private attempt: Promise<CompanionClient | null> | null = null;
  private socket: Socket | null = null;
  private retry: ReturnType<typeof setInterval> | null = null;
  private readonly listeners = new Set<(state: ConnectionState) => void>();
  private disposed = false;

  constructor(private readonly options: ConnectionOptions) {}

  get state(): ConnectionState {
    return this.current;
  }

  get client(): CompanionClient | null {
    return this.current.kind === 'connected' ? this.current.client : null;
  }

  onChange(listener: (state: ConnectionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The client, connecting first when needed; null when Seshboard isn't running (or can't be reached). */
  connect(): Promise<CompanionClient | null> {
    if (this.current.kind === 'connected') return Promise.resolve(this.current.client);
    this.attempt ??= this.open().finally(() => (this.attempt = null));
    return this.attempt;
  }

  /** Drops the connection and finds Seshboard again (it may have restarted, or the settings changed). */
  reconnect(): Promise<CompanionClient | null> {
    this.socket?.destroy();
    return this.connect();
  }

  /** Waits (up to `timeoutMs`) for Seshboard to come up, after asking macOS to open it. */
  async waitForStart(timeoutMs = 20_000): Promise<CompanionClient | null> {
    const deadline = Date.now() + timeoutMs;
    while (!this.disposed && Date.now() < deadline) {
      const client = await this.connect();
      if (client) return client;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return null;
  }

  dispose(): void {
    this.disposed = true;
    if (this.retry) clearInterval(this.retry);
    this.socket?.destroy();
    this.listeners.clear();
  }

  private set(state: ConnectionState): void {
    // Offline, keep looking for it; connected, the socket closing says when it goes away.
    if (state.kind === 'offline' && !this.retry && !this.disposed) this.retry = setInterval(() => void this.connect(), 5_000);
    if (state.kind === 'connected' && this.retry) {
      clearInterval(this.retry);
      this.retry = null;
    }
    const same = state.kind === 'offline' && this.current.kind === 'offline' && state.reason === this.current.reason && state.detail === this.current.detail;
    this.current = state;
    if (!same) for (const listener of this.listeners) listener(state);
  }

  private async open(): Promise<CompanionClient | null> {
    const files = infoFiles(homedir(), this.options.appDataFolder());
    const read = await Promise.all(files.map(async (file) => ({ file, text: await readFile(file, 'utf8').catch(() => null) })));
    const found = pickInfo(read, alive);
    if (found.kind === 'none') {
      this.set({ kind: 'offline', reason: 'not-running', detail: "Seshboard isn't running" });
      return null;
    }
    if (found.kind === 'incompatible') {
      const newer = found.info.protocol > COMPANION_PROTOCOL;
      this.set({ kind: 'offline', reason: 'incompatible', detail: newer ? 'Seshboard is newer than this extension: update the extension.' : 'This extension is newer than Seshboard: update Seshboard.' });
      return null;
    }
    const { info } = found;
    let opened: Socket | undefined;
    try {
      const socket = await new Promise<Socket>((resolve, reject) => {
        const s = createConnection(info.socket);
        s.once('connect', () => resolve(s));
        s.once('error', reject);
      });
      opened = socket;
      socket.setEncoding('utf8');
      const transport = lineTransport(
        {
          write: (text) => void (!socket.destroyed && socket.write(text)),
          onData(listener) {
            socket.on('data', listener);
            return () => socket.off('data', listener);
          },
          close: () => socket.destroy(),
        },
        { onProtocolError: (reason) => this.options.log(`Connection closed: ${reason}`) },
      );
      const client = createRpcClient<CompanionContract>(transport, { timeoutMs: 15_000 });
      const hello = await client.call('hello', { token: info.token, protocol: COMPANION_PROTOCOL, client: { name: 'vscode', version: this.options.version } });
      this.socket = socket;
      socket.on('error', () => socket.destroy());
      socket.on('close', () => {
        client.dispose();
        if (this.socket === socket) this.socket = null;
        this.options.log('Seshboard closed the connection');
        if (!this.disposed) this.set({ kind: 'offline', reason: 'not-running', detail: "Seshboard isn't running" });
      });
      this.options.log(`Connected to Seshboard ${hello.app.version}`);
      this.set({ kind: 'connected', client, appVersion: hello.app.version });
      return client;
    } catch (error) {
      opened?.destroy();
      this.options.log(`Couldn't connect to Seshboard: ${(error as Error).message}`);
      this.set({ kind: 'offline', reason: 'failed', detail: (error as Error).message });
      return null;
    }
  }
}
