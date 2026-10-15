import { WebSocket } from 'ws';
import {
  createRpcClient,
  encryptedStream,
  engineSocketUrl,
  helloFrame,
  initiatorHandshake,
  lineTransport,
  pairingCode,
  pskFromSecret,
  remoteContract,
  RpcError,
  type FrameSocket,
  type HandshakeMode,
  type KeyPair,
  type NoiseSession,
  type RemoteContract,
  type RemoteLink,
  type RemotePairContract,
  type RpcClient,
} from '@switchboard/protocol';
import { CLOSE } from './remoteServer.ts';

/**
 * This app's side of Remote on another computer: what the remote app does in a phone's browser
 * (apps/remote/src/lib/connection.ts), from Node. The same handshakes, framing and contract; see
 * docs/remote-access.md, "Other computers".
 */

/** A socket to another computer's Remote, open: its frames, the first one (the handshake's answer), and its close code. */
export interface OpenSocket {
  frames: FrameSocket;
  first: Promise<Uint8Array>;
  closed: Promise<number>;
  close(): void;
}

/**
 * Why a socket didn't open or was refused: no answer in time, nothing listening, an HTTP status instead of a socket
 * (403: a Switchboard there from before it took other computers), or a close code from the other engine.
 */
export type LinkFailure = { kind: 'timeout' } | { kind: 'refused' } | { kind: 'http'; status: number } | { kind: 'closed'; code: number } | { kind: 'dropped' };

export class LinkError extends Error {
  constructor(readonly failure: LinkFailure) {
    super(failure.kind === 'closed' ? `Closed with ${failure.code}` : failure.kind === 'http' ? `HTTP ${failure.status}` : failure.kind);
  }
}

/** Opens a socket to an address from `engineAddress`. Tests pass their own. */
export type Dial = (address: string) => Promise<OpenSocket>;

/**
 * Dials with `ws`, sending `origin` (`REMOTE_DESKTOP_ORIGIN`). A ping every `pingMs` notices a computer that went to
 * sleep or a tunnel that dropped the socket without closing it, which otherwise take minutes to show; the pings also
 * keep tunnels from closing an idle socket.
 */
export function dialWebSocket(options: { origin: string; openTimeoutMs?: number; pingMs?: number }): Dial {
  const openTimeoutMs = options.openTimeoutMs ?? 15_000;
  const pingMs = options.pingMs ?? 20_000;
  return (address) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(engineSocketUrl(address), { origin: options.origin, handshakeTimeout: openTimeoutMs, perMessageDeflate: false, maxPayload: 65_535 + 3 });
      const listeners = new Set<(frame: Uint8Array) => void>();
      let takeFirst: ((frame: Uint8Array) => void) | null = null;
      const first = new Promise<Uint8Array>((r) => (takeFirst = r));
      const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
      let settled = false;
      const fail = (failure: LinkFailure) => {
        if (settled) return;
        settled = true;
        reject(new LinkError(failure));
        ws.terminate();
      };
      ws.on('unexpected-response', (_request, response) => fail({ kind: 'http', status: response.statusCode ?? 0 }));
      ws.on('error', (error: NodeJS.ErrnoException) => fail(/timed out/i.test(error.message) ? { kind: 'timeout' } : { kind: 'refused' }));
      ws.on('message', (data, binary) => {
        if (!binary) return ws.close();
        const frame = toBytes(data);
        if (takeFirst) {
          const take = takeFirst;
          takeFirst = null;
          return take(frame);
        }
        for (const listener of listeners) listener(frame);
      });
      ws.on('open', () => {
        settled = true;
        let alive = true;
        ws.on('pong', () => (alive = true));
        const heartbeat = setInterval(() => {
          if (!alive) return ws.terminate();
          alive = false;
          ws.ping();
        }, pingMs);
        heartbeat.unref?.();
        ws.on('close', () => clearInterval(heartbeat));
        resolve({
          first,
          closed,
          close: () => ws.close(),
          frames: {
            send: (frame) => ws.readyState === WebSocket.OPEN && ws.send(frame),
            onFrame: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
            close: () => ws.close(),
          },
        });
      });
    });
}

function toBytes(data: unknown): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data as Buffer[]));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  const buffer = data as Buffer;
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

/** Opens a socket and runs the handshake; rejects with a `closed` failure when the other engine refuses. */
async function handshake(dial: Dial, address: string, mode: HandshakeMode, device: KeyPair, enginePublicKey: Uint8Array, psk?: Uint8Array): Promise<OpenSocket & { session: NoiseSession }> {
  const socket = await dial(address);
  const noise = initiatorHandshake({ mode, staticKey: device, remoteStatic: enginePublicKey, ...(psk ? { psk } : {}) });
  socket.frames.send(helloFrame(mode, noise.writeMessage1()));
  const answer = await Promise.race([socket.first, socket.closed]);
  if (typeof answer === 'number') throw new LinkError({ kind: 'closed', code: answer });
  try {
    return { ...socket, session: noise.readMessage2(answer).session };
  } catch {
    // The answer doesn't decrypt: not the computer whose key the link has (or not its pairing secret).
    socket.close();
    throw new LinkError({ kind: 'closed', code: CLOSE.refused });
  }
}

/**
 * Pairs with the computer in a pair link: the handshake with its secret, then `pair.request` with this computer's
 * name, which waits for Allow there. `onCode` gets the 6 digits both computers show meanwhile. `signal` stops it.
 */
export async function pairComputer(options: {
  link: Extract<RemoteLink, { kind: 'pair' }>;
  device: KeyPair;
  name: string;
  dial: Dial;
  onCode(code: string): void;
  signal?: AbortSignal;
}): Promise<{ deviceId: string }> {
  const { link, device, signal } = options;
  const socket = await handshake(options.dial, link.address, 'pair', device, link.enginePublicKey, pskFromSecret(link.secret));
  const abort = () => socket.close();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  options.onCode(pairingCode(socket.session.handshakeHash));
  const client = createRpcClient<RemotePairContract>(lineTransport(encryptedStream(socket.frames, socket.session)), { timeoutMs: 75_000 });
  try {
    // The other side closing (Deny, its dialog closed, `signal`) ends the wait at once, rather than at the timeout.
    const closed = socket.closed.then((code) => Promise.reject(new LinkError({ kind: 'closed', code })));
    // It closes after an answer too: nobody waits for it then.
    closed.catch(() => {});
    return await Promise.race([client.call('pair.request', { name: options.name }), closed]);
  } finally {
    signal?.removeEventListener('abort', abort);
    client.dispose();
    socket.close();
  }
}

/** The client version this app says in `hello`, as the remote app does. */
const CLIENT_VERSION = '1';

export type LinkState =
  | { kind: 'connecting' }
  | { kind: 'connected'; name: string; version: string; features: string[] }
  /** `retryAt`: when it tries again by itself. */
  | { kind: 'offline'; failure: LinkFailure; retryAt: number }
  /** That computer no longer knows this one: it stops trying until it is paired again. */
  | { kind: 'unpaired' };

/** Waits before trying again: longer each time, up to a minute, and never giving up (the other computer may wake). */
export function retryDelay(attempt: number): number {
  return [1_000, 2_000, 5_000, 10_000, 30_000][attempt] ?? 60_000;
}

export interface ComputerLinkOptions {
  address: string;
  enginePublicKey: Uint8Array;
  device: KeyPair;
  dial: Dial;
  onState(state: LinkState): void;
  /** An event of the remote contract from the other computer. */
  onEvent(name: string, payload: unknown): void;
  now?: () => number;
}

/**
 * The connection to one paired computer: connects, says hello, and reconnects with backoff when it drops. A refused
 * device key ends it (`unpaired`). Requests go through `call` while it is connected.
 */
export class ComputerLink {
  private state: LinkState = { kind: 'connecting' };
  private client: RpcClient<RemoteContract> | null = null;
  private socket: OpenSocket | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  /** Bumped by each connect, so a connect that was overtaken (an address changed meanwhile) stands down. */
  private generation = 0;

  constructor(private options: ComputerLinkOptions) {}

  get current(): LinkState {
    return this.state;
  }

  start(): void {
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.generation++;
    this.drop();
  }

  /** Tries again now, from the start of the backoff (Try again, a new address). */
  retryNow(): void {
    if (this.stopped || this.state.kind === 'connected' || this.state.kind === 'connecting') return;
    clearTimeout(this.timer);
    this.attempt = 0;
    void this.connect();
  }

  /** The computer is at a new address: connect there. */
  setAddress(address: string): void {
    this.options = { ...this.options, address };
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.attempt = 0;
    this.drop();
    void this.connect();
  }

  async call(method: string, params: unknown): Promise<unknown> {
    if (!this.client) throw new RpcError('UNAVAILABLE', 'Not connected to this computer');
    return (this.client as unknown as { call(method: string, params: unknown): Promise<unknown> }).call(method, params);
  }

  private set(state: LinkState): void {
    this.state = state;
    this.options.onState(state);
  }

  private drop(): void {
    this.client?.dispose();
    this.client = null;
    this.socket?.close();
    this.socket = null;
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const generation = ++this.generation;
    const current = () => !this.stopped && generation === this.generation;
    this.set({ kind: 'connecting' });
    try {
      const { address, enginePublicKey, device, dial } = this.options;
      const socket = await handshake(dial, address, 'connect', device, enginePublicKey);
      if (!current()) return socket.close();
      const client = createRpcClient<RemoteContract>(lineTransport(encryptedStream(socket.frames, socket.session)), { timeoutMs: 30_000 });
      this.socket = socket;
      this.client = client;
      for (const name of Object.keys(remoteContract.events)) client.on(name as keyof RemoteContract['events'], (payload) => this.options.onEvent(name, payload));
      const hello = await client.call('hello', { client: { version: CLIENT_VERSION } });
      if (!current()) return;
      this.attempt = 0;
      // An older Switchboard there says no features.
      this.set({ kind: 'connected', name: hello.computer.name, version: hello.app.version, features: hello.features ?? [] });
      const code = await socket.closed;
      if (!current()) return;
      this.drop();
      if (code === CLOSE.unknownDevice) return this.set({ kind: 'unpaired' });
      this.retry({ kind: 'dropped' });
    } catch (error) {
      if (!current()) return;
      this.drop();
      const failure: LinkFailure = error instanceof LinkError ? error.failure : { kind: 'dropped' };
      if (failure.kind === 'closed' && failure.code === CLOSE.unknownDevice) return this.set({ kind: 'unpaired' });
      this.retry(failure);
    }
  }

  private retry(failure: LinkFailure): void {
    if (this.stopped) return;
    const wait = retryDelay(this.attempt++);
    this.set({ kind: 'offline', failure, retryAt: (this.options.now ?? Date.now)() + wait });
    this.timer = setTimeout(() => void this.connect(), wait);
    this.timer.unref?.();
  }
}
