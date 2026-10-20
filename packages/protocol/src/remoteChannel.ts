import type { TextStream } from './lineTransport.ts';
import { KEY_LENGTH, NoiseError, PAIRING_SECRET_LENGTH, REMOTE_PROTOCOL, type HandshakeMode, type NoiseSession } from './remoteNoise.ts';

/**
 * How Remote's messages travel over a WebSocket (or, later, a relay): the phone's first frame opens the handshake,
 * the engine answers with the second, and every frame after that is one encrypted chunk of the RPC's text lines.
 * Shared by the engine and the remote app; see docs/remote-access.md.
 */

/** A binary message socket: a WebSocket in the browser, `ws` in the engine, a pair of queues in tests. */
export interface FrameSocket {
  send(frame: Uint8Array): void;
  /** Registers a listener for incoming frames; returns a function that removes it. */
  onFrame(listener: (frame: Uint8Array) => void): () => void;
  close(): void;
}

/** The most text one encrypted frame carries. Longer lines are split; the line transport puts them back together. */
export const MAX_FRAME_TEXT = 60_000;
/** The first byte of a hello frame, so a stray client is told apart from an older or newer phone. */
const MAGIC = 0x53;
const MODES: Record<HandshakeMode, number> = { pair: 1, connect: 2 };

/** The phone's first frame: magic, protocol version, mode, then Noise's first message. */
export function helloFrame(mode: HandshakeMode, message1: Uint8Array): Uint8Array {
  const frame = new Uint8Array(3 + message1.length);
  frame.set([MAGIC, REMOTE_PROTOCOL, MODES[mode]]);
  frame.set(message1, 3);
  return frame;
}

export type ParsedHello = { ok: true; mode: HandshakeMode; message1: Uint8Array } | { ok: false; reason: 'not-remote' | 'version' };

export function parseHello(frame: Uint8Array): ParsedHello {
  if (frame.length < 3 || frame[0] !== MAGIC) return { ok: false, reason: 'not-remote' };
  if (frame[1] !== REMOTE_PROTOCOL) return { ok: false, reason: 'version' };
  const mode = frame[2] === MODES.pair ? 'pair' : frame[2] === MODES.connect ? 'connect' : null;
  if (!mode) return { ok: false, reason: 'not-remote' };
  return { ok: true, mode, message1: frame.subarray(3) };
}

export interface EncryptedStreamOptions {
  /** A frame that didn't decrypt or wasn't text. The socket is closed right after. */
  onError?(reason: string): void;
  /** Called once, after the first frame from the other side decrypted (in `pair`, the proof the phone knows the secret). */
  onFirstFrame?(): void;
}

/**
 * The line transport's text stream over an encrypted channel. Every frame is checked: the first that doesn't
 * decrypt (tampered, replayed, reordered, or from someone without the keys) closes the socket.
 */
export function encryptedStream(socket: FrameSocket, session: NoiseSession, options: EncryptedStreamOptions = {}): TextStream {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const listeners = new Set<(chunk: string) => void>();
  let closed = false;
  let seen = false;
  const close = () => {
    if (closed) return;
    closed = true;
    socket.close();
  };
  socket.onFrame((frame) => {
    if (closed) return;
    let text: string;
    try {
      text = decoder.decode(session.receive.decrypt(frame), { stream: true });
    } catch (error) {
      options.onError?.(error instanceof NoiseError ? error.message : 'A message was not text');
      return close();
    }
    if (!seen) {
      seen = true;
      options.onFirstFrame?.();
    }
    for (const listener of listeners) listener(text);
  });
  return {
    write(text) {
      if (closed) return;
      const bytes = encoder.encode(text);
      for (let at = 0; at < bytes.length; at += MAX_FRAME_TEXT) socket.send(session.send.encrypt(bytes.subarray(at, at + MAX_FRAME_TEXT)));
    },
    onData(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close,
  };
}

// ---------------------------------------------------------------------------
// The pairing link in the QR code
// ---------------------------------------------------------------------------

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * Where the engine is, as the phone connects to it: an `https://` origin (a tunnel, `tailscale serve`, your own
 * address), or `http://` on this computer only (development). The socket is `/ws` there, over `wss://` or `ws://`.
 */
export function engineAddress(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) return null;
  if (parsed.username || parsed.password || (parsed.pathname !== '/' && parsed.pathname !== '') || parsed.search || parsed.hash) return null;
  return parsed.origin;
}

/** The engine's socket for an address from `engineAddress`. */
export const engineSocketUrl = (address: string) => `${address.replace(/^http/, 'ws')}/ws`;

/**
 * What the remote app's link carries, after `#`. A fragment is never sent in a request, so the website that serves
 * the app never sees the engine's address, its key or the pairing secret.
 *  - `p.<engine key>.<secret>.<engine address>`: Pair a device (the QR code in Settings › Remote);
 *  - `c.<engine key>.<engine address>`: a paired phone learns the engine's new address (a tunnel that restarted).
 */
export type RemoteLink =
  | { kind: 'pair'; enginePublicKey: Uint8Array; secret: Uint8Array; address: string }
  | { kind: 'connect'; enginePublicKey: Uint8Array; address: string };

const encodeText = (text: string) => toBase64Url(new TextEncoder().encode(text));
const decodeText = (text: string) => {
  const bytes = fromBase64Url(text);
  if (!bytes) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
};

export function remoteLinkFragment(link: RemoteLink): string {
  const key = toBase64Url(link.enginePublicKey);
  const address = encodeText(link.address);
  return link.kind === 'pair' ? `p.${key}.${toBase64Url(link.secret)}.${address}` : `c.${key}.${address}`;
}

export function parseRemoteLink(fragment: string): RemoteLink | null {
  const parts = fragment.replace(/^#/, '').split('.');
  const kind = parts[0];
  const enginePublicKey = parts[1] ? fromBase64Url(parts[1]) : null;
  if (enginePublicKey?.length !== KEY_LENGTH) return null;
  if (kind === 'p' && parts.length === 4) {
    const secret = fromBase64Url(parts[2]!);
    const address = engineAddress(decodeText(parts[3]!) ?? '');
    if (secret?.length !== PAIRING_SECRET_LENGTH || !address) return null;
    return { kind: 'pair', enginePublicKey, secret, address };
  }
  if (kind === 'c' && parts.length === 3) {
    const address = engineAddress(decodeText(parts[2]!) ?? '');
    return address ? { kind: 'connect', enginePublicKey, address } : null;
  }
  return null;
}
