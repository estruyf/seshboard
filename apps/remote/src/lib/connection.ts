import {
  createRpcClient,
  encryptedStream,
  engineSocketUrl,
  generateKeyPair,
  helloFrame,
  initiatorHandshake,
  keyPairFromSecret,
  lineTransport,
  pairingCode,
  pskFromSecret,
  type FrameSocket,
  type HandshakeMode,
  type KeyPair,
  type NoiseSession,
  type RemoteContract,
  type RemoteLink,
  type RemotePairContract,
  type RpcClient,
  appIconKey,
  type AppIconKey,
} from '@seshboard/protocol/remote-client';
import { reconnectDelay, type Paired } from './link.ts';
import { MAX_ATTEMPTS, OPEN_TIMEOUT_MS, offlineReason, type OfflineReason } from './offline.ts';

/** Close codes the engine uses (packages/engine/src/remote/remoteServer.ts). */
const CLOSE = { unknownDevice: 4403, pairingClosed: 4410, refused: 4400, version: 4426 } as const;

export const APP_VERSION = '1';

/** A WebSocket as frames, and the first frame as a promise (the engine's answer to the hello). */
interface OpenSocket {
  ws: WebSocket;
  frames: FrameSocket;
  first: Promise<Uint8Array>;
  closed: Promise<number>;
}

/** A socket that didn't open: refused (after how long), or no answer in time. */
export class SocketFailure extends Error {
  constructor(readonly failure: { kind: 'timeout' } | { kind: 'refused'; elapsedMs: number }) {
    super("Can't reach your computer");
  }
}

function openSocket(address: string): Promise<OpenSocket> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const ws = new WebSocket(engineSocketUrl(address));
    ws.binaryType = 'arraybuffer';
    const listeners = new Set<(frame: Uint8Array) => void>();
    let firstFrame: ((frame: Uint8Array) => void) | null = null;
    const first = new Promise<Uint8Array>((r) => (firstFrame = r));
    const closed = new Promise<number>((r) => ws.addEventListener('close', (event) => r(event.code)));
    // A computer that sleeps doesn't refuse: the socket just hangs, for minutes on some phones.
    const timer = setTimeout(() => {
      reject(new SocketFailure({ kind: 'timeout' }));
      ws.close();
    }, OPEN_TIMEOUT_MS);
    ws.addEventListener('message', (event) => {
      if (!(event.data instanceof ArrayBuffer)) return ws.close();
      const frame = new Uint8Array(event.data);
      if (firstFrame) {
        const take = firstFrame;
        firstFrame = null;
        return take(frame);
      }
      for (const listener of listeners) listener(frame);
    });
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve({
        ws,
        first,
        closed,
        frames: {
          send: (frame) => ws.readyState === WebSocket.OPEN && ws.send(new Uint8Array(frame)),
          onFrame: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
          close: () => ws.close(),
        },
      });
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new SocketFailure({ kind: 'refused', elapsedMs: Date.now() - started }));
    });
  });
}

/** Opens a socket and runs the handshake; rejects with the engine's close code when it refuses. */
async function handshake(address: string, mode: HandshakeMode, device: KeyPair, enginePublicKey: Uint8Array, psk?: Uint8Array): Promise<OpenSocket & { session: NoiseSession }> {
  const socket = await openSocket(address);
  const noise = initiatorHandshake({ mode, staticKey: device, remoteStatic: enginePublicKey, ...(psk ? { psk } : {}) });
  socket.ws.send(new Uint8Array(helloFrame(mode, noise.writeMessage1())));
  const answer = await Promise.race([socket.first, socket.closed]);
  if (typeof answer === 'number') throw new RefusedError(answer);
  try {
    return { ...socket, session: noise.readMessage2(answer).session };
  } catch {
    // The answer doesn't decrypt: this is not the computer from the QR code (or not its pairing secret).
    socket.ws.close();
    throw new RefusedError(CLOSE.refused);
  }
}

export class RefusedError extends Error {
  constructor(readonly code: number) {
    super(
      code === CLOSE.unknownDevice
        ? 'Your computer no longer knows this phone. Pair it again.'
        : code === CLOSE.pairingClosed
          ? 'This QR code was used or has expired. Click Pair a device on your computer again.'
          : code === CLOSE.version
            ? 'Seshboard on your computer and this page are different versions. Update Seshboard.'
            : 'Your computer refused the connection.',
    );
  }
}

/**
 * Pairs this phone: a fresh device key, the pairing handshake with the secret from the QR code, then `pair.request`
 * with the phone's name, which waits for Allow on the computer. `onCode` gets the 6 digits to compare meanwhile.
 */
export async function pairPhone(link: Extract<RemoteLink, { kind: 'pair' }>, name: string, onCode: (code: string) => void): Promise<Paired> {
  const device = generateKeyPair();
  const socket = await handshake(link.address, 'pair', device, link.enginePublicKey, pskFromSecret(link.secret));
  onCode(pairingCode(socket.session.handshakeHash));
  const client = createRpcClient<RemotePairContract>(lineTransport(encryptedStream(socket.frames, socket.session)), { timeoutMs: 75_000 });
  try {
    const { deviceId } = await client.call('pair.request', { name });
    return { deviceSecret: device.secretKey, enginePublicKey: link.enginePublicKey, address: link.address, deviceId, name, pairedAt: Date.now() };
  } finally {
    client.dispose();
    socket.ws.close();
  }
}

export type ConnectionState =
  /** `attempt` 0 is the first try; later ones are reconnects. */
  | { kind: 'connecting'; attempt: number }
  /** `since`: when this connection was made, for "Connected for 2h". */
  /** `appIcon`: the computer's app icon colourway for this app's icons (its hello, then `app.icon`); Graphite from an older one. */
  | { kind: 'connected'; client: RpcClient<RemoteContract>; appVersion: string; computerName: string; features: string[]; appIcon: AppIconKey; since: number }
  /** `retryAt` null: it gave up trying by itself (Try again, or the page coming back to the front, starts over). */
  | { kind: 'offline'; retryAt: number | null; message: string; reason: OfflineReason; attempt: number }
  /** You chose Disconnect: nothing reconnects by itself, only Connect. The pairing stays. */
  | { kind: 'disconnected' }
  | { kind: 'unpaired'; message: string };

/** An open, shaken-hands socket to the computer: what `Connection` needs of one. Tests pass their own. */
export interface Dialed {
  frames: FrameSocket;
  session: NoiseSession;
  closed: Promise<number>;
  close: () => void;
}

/** Opens the socket and runs the connect handshake; throws a `RefusedError` or a `SocketFailure`. */
export type Dial = (address: string, device: KeyPair, enginePublicKey: Uint8Array) => Promise<Dialed>;

const dialSocket: Dial = async (address, device, enginePublicKey) => {
  const socket = await handshake(address, 'connect', device, enginePublicKey);
  return { frames: socket.frames, session: socket.session, closed: socket.closed, close: () => socket.ws.close() };
};

/**
 * The connection to the paired computer: connects, says hello, and reconnects with backoff when it drops (also at
 * once when the page comes back to the front or the network comes back). After a few tries it stops until then. A
 * refused device key ends it: the phone must pair again. Disconnect closes it until Connect, keeping the pairing.
 */
export class Connection {
  private state: ConnectionState = { kind: 'connecting', attempt: 0 };
  private readonly listeners = new Set<(state: ConnectionState) => void>();
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private close: (() => void) | null = null;
  private stopped = false;
  /** Disconnect was chosen: a socket that closes, the page coming back or the network coming back don't reconnect. */
  private held = false;
  /** Counts connects, so one that Disconnect overtook doesn't report in afterwards. */
  private run = 0;
  private readonly device: KeyPair;
  private readonly dial: Dial;

  constructor(
    private readonly paired: Paired,
    options: { dial?: Dial } = {},
  ) {
    this.device = keyPairFromSecret(paired.deviceSecret);
    this.dial = options.dial ?? dialSocket;
  }

  get current(): ConnectionState {
    return this.state;
  }

  subscribe(listener: (state: ConnectionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Starts connecting, or with `disconnected` waits for `reconnect` (a reload after Disconnect stays disconnected). */
  start(options: { disconnected?: boolean } = {}): void {
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('online', this.retryNow);
    if (options.disconnected) {
      this.held = true;
      this.set({ kind: 'disconnected' });
    } else void this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('online', this.retryNow);
    this.close?.();
  }

  /** Disconnect: closes the connection (or stops trying) and stays closed until `reconnect`. */
  disconnect(): void {
    if (this.stopped || this.state.kind === 'unpaired') return;
    this.held = true;
    this.run++;
    clearTimeout(this.timer);
    this.close?.();
    this.close = null;
    this.set({ kind: 'disconnected' });
  }

  /** Connect, after Disconnect: the normal connection, from the start of the backoff. */
  reconnect(): void {
    if (this.stopped || !this.held) return;
    this.held = false;
    this.attempt = 0;
    void this.connect();
  }

  /** Try again now, from the start of the backoff: Try again, the network coming back. */
  readonly retryNow = () => {
    if (this.stopped || this.held || this.state.kind !== 'offline') return;
    clearTimeout(this.timer);
    this.attempt = 0;
    void this.connect();
  };

  /** Back in front: a phone that slept has a dead socket more often than not. */
  private readonly onVisible = () => {
    if (document.visibilityState === 'visible') this.retryNow();
  };

  private set(state: ConnectionState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.held) return;
    const run = ++this.run;
    /** Stopped, or Disconnect (or another connect) came meanwhile: this one is over. */
    const over = () => this.stopped || run !== this.run;
    this.set({ kind: 'connecting', attempt: this.attempt });
    try {
      const socket = await this.dial(this.paired.address, this.device, this.paired.enginePublicKey);
      if (over()) return socket.close();
      this.close = socket.close;
      const client = createRpcClient<RemoteContract>(lineTransport(encryptedStream(socket.frames, socket.session)), { timeoutMs: 30_000 });
      const hello = await client.call('hello', { client: { version: APP_VERSION } });
      if (over()) return client.dispose();
      this.attempt = 0;
      // An engine from before the computer's name was sent.
      this.set({ kind: 'connected', client, appVersion: hello.app.version, computerName: hello.computer?.name ?? this.paired.computerName ?? '', features: hello.features ?? [], appIcon: appIconKey(hello.appIcon), since: Date.now() });
      client.on('app.icon', ({ key }) => {
        if (this.state.kind === 'connected' && this.state.client === client) this.set({ ...this.state, appIcon: appIconKey(key) });
      });
      const code = await socket.closed;
      client.dispose();
      if (over()) return;
      this.close = null;
      if (code === CLOSE.unknownDevice) return this.set({ kind: 'unpaired', message: new RefusedError(code).message });
      this.retry('Lost the connection to your computer.', { kind: 'dropped' });
    } catch (error) {
      if (over()) return;
      if (error instanceof RefusedError && error.code === CLOSE.unknownDevice) return this.set({ kind: 'unpaired', message: error.message });
      this.retry(error instanceof Error ? error.message : "Can't reach your computer.", error instanceof SocketFailure ? error.failure : { kind: 'dropped' });
    }
  }

  private retry(message: string, failure: Parameters<typeof offlineReason>[0]['failure']): void {
    if (this.stopped || this.held) return;
    const reason = offlineReason({ online: navigator.onLine, address: this.paired.address, failure });
    const attempt = ++this.attempt;
    if (attempt >= MAX_ATTEMPTS) return this.set({ kind: 'offline', retryAt: null, message, reason, attempt });
    const wait = reconnectDelay(attempt - 1);
    this.set({ kind: 'offline', retryAt: Date.now() + wait, message, reason, attempt });
    this.timer = setTimeout(() => void this.connect(), wait);
  }
}
