import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  encryptedStream,
  lineTransport,
  pairingCode,
  parseHello,
  remoteContract,
  remotePairContract,
  responderHandshake,
  RpcError,
  serveRpc,
  type FrameSocket,
  type Handlers,
  type KeyPair,
  type NoiseSession,
  type RemoteContract,
  type RpcServer,
  REMOTE_DESKTOP_ORIGIN,
  REMOTE_FEATURE_ATTACHMENTS,
  REMOTE_FEATURE_BRANCHES,
  REMOTE_FEATURE_USAGE_TOKENS,
} from '@switchboard/protocol';
import { computerName } from './computerName.ts';
import type { DeviceKind, DeviceStore, RemoteDevice } from './devices.ts';
import type { Pairing } from './pairing.ts';

/** A paired phone connected now. */
export interface RemoteConnection {
  deviceId: string;
  name: string;
  since: number;
}

/** Every remote request but `hello`, which the server answers; `device` is the phone that asks. */
export type RemoteHandlers = (device: RemoteDevice) => Omit<Handlers<RemoteContract>, 'hello'>;

export interface RemoteServerOptions {
  /** The engine's identity key, the one in the QR code. */
  identity(): KeyPair;
  devices: DeviceStore;
  pairing: Pairing;
  handlers: RemoteHandlers;
  appVersion: string;
  /** What the phone calls this computer ("Elio's iMac"); asked once, at the first connection. */
  computerName?: () => string;
  /**
   * The remote app's origins: a socket from a page anywhere else is refused. Browsers always send `Origin` on a
   * WebSocket and a page can't fake it, so another site open on the phone or this computer can't reach the engine.
   */
  origins: readonly string[];
  /** The engine's public address now, kept with each device that connects (to tell when a new one hasn't reached it). */
  address?: () => string | null;
  /** The tunnel is Cloudflare's, which sets `CF-Connecting-IP` itself (other tunnels pass it on from the client). */
  cloudflare?: () => boolean;
  log(level: 'info' | 'warn' | 'error', message: string): void;
  /** A phone connected or went away. */
  onConnections?(connections: RemoteConnection[]): void;
  /** How long a new socket may take to send its first frame (default 5 s). */
  helloTimeoutMs?: number;
  /** Failed handshakes per address (tests pass their own). */
  backoff?: Backoff;
}

/** The longest line a phone may send: a prompt at its longest, with room for the JSON around it. */
const MAX_LINE = 4 * 1024 * 1024;
/** One frame: a Noise message at its largest, and the 3 bytes of the hello frame's header. */
const MAX_FRAME = 65_535 + 3;
/** WebSocket close codes the remote app understands. */
export const CLOSE = { unknownDevice: 4403, pairingClosed: 4410, refused: 4400, tooMany: 4429, version: 4426 } as const;

/**
 * Failed handshakes per address: after three, each new attempt waits twice as long (up to five minutes), so nobody
 * can try keys or pairing secrets quickly.
 */
export class Backoff {
  private readonly failures = new Map<string, { count: number; until: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  allowed(address: string): boolean {
    const entry = this.failures.get(address);
    return !entry || this.now() >= entry.until;
  }

  failed(address: string): void {
    const count = (this.failures.get(address)?.count ?? 0) + 1;
    const wait = count < 3 ? 0 : Math.min(1_000 * 2 ** (count - 3), 5 * 60_000);
    this.failures.set(address, { count, until: this.now() + wait });
  }

  succeeded(address: string): void {
    this.failures.delete(address);
  }
}

/**
 * Remote's server: a WebSocket (`/ws`) on `127.0.0.1` only, which the tunnel forwards to; the remote app itself comes
 * from its own site. A socket must open with a Noise handshake (pair or connect, see docs/remote-access.md) before
 * anything it sends is read: an unknown or revoked device is refused at once, and every frame after the handshake is
 * encrypted, so the tunnel carries nothing it can read or change.
 */
export class RemoteServer {
  private server: Server | null = null;
  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME, perMessageDeflate: false });
  private readonly connections = new Map<WebSocket, RemoteConnection & { rpc: RpcServer<RemoteContract> }>();
  private readonly pending = new Set<WebSocket>();
  private readonly backoff: Backoff;
  private name: string | null = null;

  constructor(private readonly options: RemoteServerOptions) {
    this.backoff = options.backoff ?? new Backoff();
  }

  private computerName(): string {
    return (this.name ??= this.options.computerName?.() ?? computerName());
  }

  /** Listens on `127.0.0.1:port` (0: any free port, for tests). Rejects with EADDRINUSE when the port is taken. */
  async start(port: number): Promise<{ port: number }> {
    this.stop();
    const server = createServer((request, response) => this.serve(request, response));
    server.on('upgrade', (request, socket, head) => this.upgrade(request, socket, head));
    server.on('clientError', (_error, socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
        server.off('error', reject);
        resolve();
      });
    });
    server.on('error', (error) => this.options.log('warn', `Remote server: ${error.message}`));
    this.server = server;
    return { port: (server.address() as { port: number }).port };
  }

  stop(): void {
    for (const socket of [...this.connections.keys(), ...this.pending]) socket.terminate();
    this.pending.clear();
    const had = this.connections.size > 0;
    for (const connection of this.connections.values()) connection.rpc.dispose();
    this.connections.clear();
    this.server?.close();
    this.server?.closeAllConnections();
    this.server = null;
    if (had) this.connectionsChanged();
  }

  get listening(): boolean {
    return this.server !== null;
  }

  /** Phones connected now. */
  list(): RemoteConnection[] {
    return [...this.connections.values()].map(({ deviceId, name, since }) => ({ deviceId, name, since }));
  }

  /** Closes every connection of a device (it was revoked). */
  disconnect(deviceId: string): void {
    for (const [socket, connection] of this.connections) if (connection.deviceId === deviceId) socket.terminate();
  }

  /** Sends an event to every connected phone (the hub decides what each may see). */
  each(fn: (rpc: RpcServer<RemoteContract>, deviceId: string) => void): void {
    for (const connection of this.connections.values()) fn(connection.rpc, connection.deviceId);
  }

  /** Only the socket lives here: the app's page comes from its own site. */
  private serve(_request: IncomingMessage, response: ServerResponse): void {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    response.end('Switchboard Remote: open the remote app on your phone.');
  }

  private upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const address = clientAddress(request, this.options.cloudflare?.() ?? false);
    const origin = request.headers.origin ?? '';
    if (decodePath(request.url ?? '') !== '/ws' || !this.options.origins.includes(origin)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    if (!this.backoff.allowed(address)) {
      socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
      return;
    }
    this.sockets.handleUpgrade(request, socket, head, (ws) => this.accept(ws, address, deviceKind(origin, request.headers['user-agent'])));
  }

  /** `kind`: what pairs, from the socket's origin; only a label in Settings › Remote, never what lets it in. */
  private accept(ws: WebSocket, address: string, kind: DeviceKind): void {
    this.pending.add(ws);
    const timer = setTimeout(() => ws.terminate(), this.options.helloTimeoutMs ?? 5_000);
    ws.on('close', () => {
      clearTimeout(timer);
      this.pending.delete(ws);
    });
    ws.once('message', (data, binary) => {
      clearTimeout(timer);
      const hello = binary ? parseHello(toBytes(data)) : ({ ok: false, reason: 'not-remote' } as const);
      if (!hello.ok) {
        if (hello.reason !== 'version') this.backoff.failed(address);
        return ws.close(hello.reason === 'version' ? CLOSE.version : CLOSE.refused);
      }
      if (hello.mode === 'pair') this.pair(ws, address, hello.message1, kind);
      else this.connect(ws, address, hello.message1);
    });
  }

  private connect(ws: WebSocket, address: string, message1: Uint8Array): void {
    const handshake = responderHandshake({ mode: 'connect', staticKey: this.options.identity() });
    let device: RemoteDevice | null;
    let session: NoiseSession;
    let phoneKey: Uint8Array;
    try {
      phoneKey = handshake.readMessage1(message1).remoteStatic;
      device = this.options.devices.find(phoneKey);
      if (!device) {
        this.backoff.failed(address);
        return ws.close(CLOSE.unknownDevice);
      }
      const reply = handshake.writeMessage2();
      session = reply.session;
      ws.send(reply.message);
    } catch {
      this.backoff.failed(address);
      return ws.close(CLOSE.refused);
    }
    const known = device;
    const stream = encryptedStream(frameSocket(ws), session, {
      onError: () => this.backoff.failed(address),
      // The phone holds the device key only once a frame from it decrypts: until then it is nobody.
      onFirstFrame: () => {
        // Revoked between the handshake and now: Revoke only closes connections it can see, which this wasn't yet.
        if (!this.options.devices.find(phoneKey)) return ws.close(CLOSE.unknownDevice);
        this.backoff.succeeded(address);
        this.options.devices.touch(known.id, this.options.address?.() ?? null);
        this.pending.delete(ws);
        this.connections.set(ws, { deviceId: known.id, name: known.name, since: Date.now(), rpc });
        this.connectionsChanged();
      },
    });
    const transport = lineTransport(stream, { maxLineLength: MAX_LINE, onProtocolError: (reason) => this.options.log('warn', `Remote connection closed: ${reason}`) });
    const rpc = serveRpc(
      remoteContract,
      transport,
      {
        ...this.options.handlers(known),
        hello: () => ({ app: { version: this.options.appVersion }, device: { id: known.id, name: known.name }, computer: { name: this.computerName() }, features: [REMOTE_FEATURE_ATTACHMENTS, REMOTE_FEATURE_USAGE_TOKENS, REMOTE_FEATURE_BRANCHES] }),
      },
      { onUnexpectedError: (method, error) => this.options.log('error', `Remote ${method} failed: ${error instanceof Error ? error.message : String(error)}`) },
    );
    ws.on('close', () => {
      rpc.dispose();
      if (this.connections.delete(ws)) this.connectionsChanged();
    });
  }

  private pair(ws: WebSocket, address: string, message1: Uint8Array, kind: DeviceKind): void {
    const pairing = this.options.pairing;
    const psk = pairing.psk();
    if (!psk) return ws.close(CLOSE.pairingClosed);
    const handshake = responderHandshake({ mode: 'pair', staticKey: this.options.identity(), psk });
    let phoneKey: Uint8Array;
    let session: NoiseSession;
    const refuse = () => {
      pairing.failed();
      this.backoff.failed(address);
      ws.close(CLOSE.refused);
    };
    try {
      phoneKey = handshake.readMessage1(message1).remoteStatic;
      const reply = handshake.writeMessage2();
      session = reply.session;
      ws.send(reply.message);
    } catch {
      return refuse();
    }
    // A pairing connection lives as long as the Mac waits for Allow, and a little more.
    const limit = setTimeout(() => ws.terminate(), 90_000);
    let claimed = false;
    const stream = encryptedStream(frameSocket(ws), session, {
      onError: () => !claimed && refuse(),
      onFirstFrame: () => {
        claimed = pairing.claim();
        if (claimed) this.backoff.succeeded(address);
        else ws.close(CLOSE.pairingClosed);
      },
    });
    let asked = false;
    const rpc = serveRpc(remotePairContract, lineTransport(stream, { maxLineLength: 4096 }), {
      'pair.request': async ({ name }) => {
        if (!claimed || asked) throw new RpcError('DENIED', 'Pairing is closed');
        asked = true;
        const allowed = await pairing.ask(name, pairingCode(session.handshakeHash));
        if (!allowed) throw new RpcError('DENIED', 'Pairing was not allowed on the computer');
        const device = this.options.devices.add(name, phoneKey, kind);
        this.options.log('info', `Remote: paired ${name}`);
        return { deviceId: device.id };
      },
    });
    ws.on('close', () => {
      clearTimeout(limit);
      rpc.dispose();
      // A phone that goes away while the Mac asks: the question goes too.
      const waiting = pairing.state().request;
      if (asked && waiting) pairing.decide(waiting.id, false);
    });
  }

  private connectionsChanged(): void {
    this.options.onConnections?.(this.list());
  }
}

function frameSocket(ws: WebSocket): FrameSocket {
  return {
    send: (frame) => {
      if (ws.readyState === ws.OPEN) ws.send(frame);
    },
    onFrame(listener) {
      const handler = (data: unknown, binary: boolean) => {
        if (!binary) return ws.close(CLOSE.refused);
        listener(toBytes(data));
      };
      ws.on('message', handler);
      return () => ws.off('message', handler);
    },
    close: () => ws.close(),
  };
}

function toBytes(data: unknown): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data as Buffer[]));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  const buffer = data as Buffer;
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

/** What pairs, for its icon: Switchboard on another computer, a phone's browser, or a computer's browser. */
export function deviceKind(origin: string, userAgent: string | undefined): DeviceKind {
  if (origin === REMOTE_DESKTOP_ORIGIN) return 'computer';
  return /Mobi|iPhone|iPad|iPod|Android/i.test(userAgent ?? '') ? 'phone' : 'browser';
}

/** The path of a request, without its query, or null when it can't be read or climbs out (`..`). */
export function decodePath(url: string): string | null {
  try {
    const path = decodeURIComponent(new URL(url, 'http://x').pathname);
    if (path.includes('\0') || path.split(/[\\/]/).includes('..')) return null;
    return path;
  } catch {
    return null;
  }
}

/**
 * Who is asking, for the backoff. Behind a tunnel every socket comes from `127.0.0.1`, so the tunnel's own header
 * says: Cloudflare's `CF-Connecting-IP` behind a Cloudflare tunnel, else the last `X-Forwarded-For` entry (the one the tunnel added; the ones
 * before it are whatever the client sent).
 */
export function clientAddress(request: Pick<IncomingMessage, 'headers' | 'socket'>, cloudflare: boolean): string {
  const connecting = request.headers['cf-connecting-ip'];
  if (cloudflare && typeof connecting === 'string' && connecting) return connecting;
  const forwarded = request.headers['x-forwarded-for'];
  const last = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded ?? '').split(',').map((a) => a.trim()).filter(Boolean).at(-1);
  return last ?? request.socket.remoteAddress ?? 'unknown';
}
