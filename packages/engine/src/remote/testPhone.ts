import { WebSocket } from 'ws';
import {
  createRpcClient,
  encryptedStream,
  helloFrame,
  initiatorHandshake,
  lineTransport,
  type FrameSocket,
  type KeyPair,
  type NoiseSession,
  type RemoteContract,
  type RemotePairContract,
} from '@switchboard/protocol';

/**
 * A phone, for the tests: what the remote app does over its WebSocket, from Node. Not a test file itself, so the
 * server's and the hub's tests share it, and the app's smoke run connects one (Connected to this Mac).
 */

/** The remote app's origin in tests. */
export const APP_ORIGIN = 'https://app.example';

/** The phone's side of a socket: a WebSocket from the remote app's origin, its frames as a FrameSocket. */
export function open(port: number, origin = APP_ORIGIN): Promise<{ ws: WebSocket; frames: FrameSocket; next: () => Promise<Uint8Array>; closed: Promise<number> }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin });
  const queue: Uint8Array[] = [];
  const waiters: Array<(frame: Uint8Array) => void> = [];
  const listeners = new Set<(frame: Uint8Array) => void>();
  ws.on('message', (data: Buffer) => {
    const frame = new Uint8Array(data);
    if (listeners.size) for (const listener of listeners) listener(frame);
    else if (waiters.length) waiters.shift()!(frame);
    else queue.push(frame);
  });
  const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
  return new Promise((resolve, reject) => {
    ws.on('open', () =>
      resolve({
        ws,
        closed,
        next: () => (queue.length ? Promise.resolve(queue.shift()!) : new Promise((r) => waiters.push(r))),
        frames: {
          send: (frame) => ws.send(frame),
          onFrame: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
          close: () => ws.close(),
        },
      }),
    );
    ws.on('unexpected-response', (_request, response) => reject(new Error(`HTTP ${response.statusCode}`)));
    ws.on('error', reject);
  });
}

/** The handshake of a phone; `origin` is the remote app's (the app's smoke run connects with the real one's). */
export async function handshake(port: number, mode: 'pair' | 'connect', phone: KeyPair, engineKey: Uint8Array, psk?: Uint8Array, origin = APP_ORIGIN) {
  const socket = await open(port, origin);
  const noise = initiatorHandshake({ mode, staticKey: phone, remoteStatic: engineKey, ...(psk ? { psk } : {}) });
  socket.ws.send(helloFrame(mode, noise.writeMessage1()));
  const reply = await Promise.race([socket.next(), socket.closed.then((code) => code)]);
  if (typeof reply === 'number') return { ...socket, code: reply, session: null };
  try {
    return { ...socket, code: null, session: noise.readMessage2(reply).session };
  } catch {
    // The engine's answer doesn't decrypt: it has another pairing secret, or isn't the engine from the QR code.
    return { ...socket, code: null, session: null };
  }
}

export function client<C extends RemoteContract | RemotePairContract>(frames: FrameSocket, session: NoiseSession) {
  return createRpcClient<C>(lineTransport(encryptedStream(frames, session)), { timeoutMs: 5_000 });
}

