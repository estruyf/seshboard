import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * The Noise handshakes behind Remote (docs/remote-access.md), shared by the engine and the phone's remote app.
 * Pure JavaScript on audited primitives (X25519, ChaCha20-Poly1305, SHA-256): the remote app is served over plain
 * HTTP on the local network, where the browser has no WebCrypto. `crypto.getRandomValues`, which `randomBytes`
 * uses, works there.
 *
 * Two patterns, both with the engine as the responder whose static key the phone knows from the QR code:
 *  - `pair`: Noise_IKpsk2_25519_ChaChaPoly_SHA256, the pairing secret from the QR code as the pre-shared key;
 *  - `connect`: Noise_IK_25519_ChaChaPoly_SHA256, a paired phone proving it holds its device key.
 */

export type HandshakeMode = 'pair' | 'connect';

export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/** Bumped when the handshake or the framing changes in a way an older phone or engine can't follow. */
export const REMOTE_PROTOCOL = 1;
export const KEY_LENGTH = 32;
/** The largest Noise message, ciphertext and tag included. */
export const MAX_NOISE_MESSAGE = 65_535;
const TAG_LENGTH = 16;

const PROTOCOL_NAMES: Record<HandshakeMode, string> = {
  pair: 'Noise_IKpsk2_25519_ChaChaPoly_SHA256',
  connect: 'Noise_IK_25519_ChaChaPoly_SHA256',
};

/** Binds the handshake to Seshboard, the protocol version and the mode, so a message can't be reused across them. */
const prologue = (mode: HandshakeMode) => utf8ToBytes(`switchboard-remote/${REMOTE_PROTOCOL}/${mode}`);

export function generateKeyPair(): KeyPair {
  return keyPairFromSecret(x25519.utils.randomSecretKey());
}

export function keyPairFromSecret(secretKey: Uint8Array): KeyPair {
  if (secretKey.length !== KEY_LENGTH) throw new Error('A key is 32 bytes');
  return { secretKey: secretKey.slice(), publicKey: x25519.getPublicKey(secretKey) };
}

/** Thrown for anything that doesn't check out: a bad tag, a wrong key, a message of the wrong size. */
export class NoiseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoiseError';
  }
}

function dh(secretKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  try {
    // Refuses low-order points, whose shared secret would be known to anyone.
    return x25519.getSharedSecret(secretKey, publicKey);
  } catch {
    throw new NoiseError('Bad public key');
  }
}

function hkdf(chainingKey: Uint8Array, input: Uint8Array, outputs: 2 | 3): Uint8Array[] {
  const temp = hmac(sha256, chainingKey, input);
  const out1 = hmac(sha256, temp, Uint8Array.of(1));
  const out2 = hmac(sha256, temp, concatBytes(out1, Uint8Array.of(2)));
  if (outputs === 2) return [out1, out2];
  return [out1, out2, hmac(sha256, temp, concatBytes(out2, Uint8Array.of(3)))];
}

/** ChaChaPoly's nonce for a Noise counter: 32 bits of zeros, then the counter as 64-bit little-endian. */
function nonceFor(counter: number): Uint8Array {
  const nonce = new Uint8Array(12);
  new DataView(nonce.buffer).setBigUint64(4, BigInt(counter), true);
  return nonce;
}

/**
 * One direction of an encrypted channel. The nonce is a counter that never repeats and isn't sent: a message that
 * was dropped, replayed or reordered fails to decrypt, and the channel must then be closed.
 */
export class CipherState {
  private counter = 0;
  private broken = false;

  constructor(private readonly key: Uint8Array) {}

  /** Messages sent or received so far. */
  get count(): number {
    return this.counter;
  }

  encrypt(plaintext: Uint8Array, ad: Uint8Array = new Uint8Array(0)): Uint8Array {
    this.check();
    const out = chacha20poly1305(this.key, nonceFor(this.counter), ad).encrypt(plaintext);
    this.counter++;
    return out;
  }

  decrypt(ciphertext: Uint8Array, ad: Uint8Array = new Uint8Array(0)): Uint8Array {
    this.check();
    try {
      const out = chacha20poly1305(this.key, nonceFor(this.counter), ad).decrypt(ciphertext);
      this.counter++;
      return out;
    } catch {
      // A channel that saw one bad message is never trusted again.
      this.broken = true;
      throw new NoiseError('A message did not decrypt');
    }
  }

  private check(): void {
    if (this.broken) throw new NoiseError('The channel is closed');
    if (this.counter >= Number.MAX_SAFE_INTEGER) throw new NoiseError('The channel ran out of nonces');
  }
}

/** Both directions of a channel after the handshake. */
export interface NoiseSession {
  send: CipherState;
  receive: CipherState;
  /** The handshake hash: unique to this handshake, the same on both sides. */
  handshakeHash: Uint8Array;
}

/** Noise's SymmetricState, with the CipherState it carries during the handshake. */
class SymmetricState {
  private h: Uint8Array;
  private ck: Uint8Array;
  private k: Uint8Array | null = null;
  private n = 0;

  constructor(protocolName: string) {
    const name = utf8ToBytes(protocolName);
    this.h = name.length <= 32 ? concatBytes(name, new Uint8Array(32 - name.length)) : sha256(name);
    this.ck = this.h;
  }

  get hash(): Uint8Array {
    return this.h;
  }

  mixHash(data: Uint8Array): void {
    this.h = sha256(concatBytes(this.h, data));
  }

  mixKey(input: Uint8Array): void {
    const [ck, k] = hkdf(this.ck, input, 2);
    this.ck = ck!;
    this.k = k!;
    this.n = 0;
  }

  mixKeyAndHash(input: Uint8Array): void {
    const [ck, h, k] = hkdf(this.ck, input, 3);
    this.ck = ck!;
    this.mixHash(h!);
    this.k = k!;
    this.n = 0;
  }

  encryptAndHash(plaintext: Uint8Array): Uint8Array {
    const out = this.k ? chacha20poly1305(this.k, nonceFor(this.n++), this.h).encrypt(plaintext) : plaintext;
    this.mixHash(out);
    return out;
  }

  decryptAndHash(ciphertext: Uint8Array): Uint8Array {
    let out = ciphertext;
    if (this.k) {
      try {
        out = chacha20poly1305(this.k, nonceFor(this.n++), this.h).decrypt(ciphertext);
      } catch {
        throw new NoiseError('A handshake message did not decrypt');
      }
    }
    this.mixHash(ciphertext);
    return out;
  }

  /** The two transport keys: initiator to responder, then responder to initiator. */
  split(): [Uint8Array, Uint8Array] {
    const [k1, k2] = hkdf(this.ck, new Uint8Array(0), 2);
    return [k1!, k2!];
  }
}

function readSlice(message: Uint8Array, at: number, length: number): Uint8Array {
  if (message.length < at + length) throw new NoiseError('A handshake message was too short');
  return message.subarray(at, at + length);
}

function checkPsk(mode: HandshakeMode, psk: Uint8Array | undefined): Uint8Array | null {
  if (mode === 'connect') return null;
  if (!psk || psk.length !== KEY_LENGTH) throw new NoiseError('Pairing needs a 32-byte secret');
  return psk;
}

export interface InitiatorOptions {
  mode: HandshakeMode;
  /** The phone's device key. */
  staticKey: KeyPair;
  /** The engine's public key, from the QR code. */
  remoteStatic: Uint8Array;
  /** The pairing secret (`pair` only). */
  psk?: Uint8Array;
  /** A fixed ephemeral key and prologue, for the Noise test vectors only. */
  ephemeral?: KeyPair;
  prologue?: Uint8Array;
}

/** The phone's side: `writeMessage1`, then `readMessage2` with the engine's answer. */
export function initiatorHandshake(options: InitiatorOptions) {
  const psk = checkPsk(options.mode, options.psk);
  const state = new SymmetricState(PROTOCOL_NAMES[options.mode]);
  state.mixHash(options.prologue ?? prologue(options.mode));
  state.mixHash(options.remoteStatic);
  const e = options.ephemeral ?? generateKeyPair();
  let step = 0;
  return {
    /** -> e, es, s, ss, with `payload` encrypted. */
    writeMessage1(payload: Uint8Array = new Uint8Array(0)): Uint8Array {
      if (step++ !== 0) throw new NoiseError('Out of order');
      state.mixHash(e.publicKey);
      if (psk) state.mixKey(e.publicKey);
      state.mixKey(dh(e.secretKey, options.remoteStatic));
      const s = state.encryptAndHash(options.staticKey.publicKey);
      state.mixKey(dh(options.staticKey.secretKey, options.remoteStatic));
      return concatBytes(e.publicKey, s, state.encryptAndHash(payload));
    },
    /** <- e, ee, se (, psk), and the engine's payload. Throws when the engine doesn't hold the key from the QR code. */
    readMessage2(message: Uint8Array): { payload: Uint8Array; session: NoiseSession } {
      if (step++ !== 1) throw new NoiseError('Out of order');
      if (message.length > MAX_NOISE_MESSAGE) throw new NoiseError('A handshake message was too long');
      const re = readSlice(message, 0, KEY_LENGTH);
      state.mixHash(re);
      if (psk) state.mixKey(re);
      state.mixKey(dh(e.secretKey, re));
      state.mixKey(dh(options.staticKey.secretKey, re));
      if (psk) state.mixKeyAndHash(psk);
      const payload = state.decryptAndHash(readSlice(message, KEY_LENGTH, message.length - KEY_LENGTH));
      const [toResponder, toInitiator] = state.split();
      return { payload, session: { send: new CipherState(toResponder), receive: new CipherState(toInitiator), handshakeHash: state.hash } };
    },
  };
}

export interface ResponderOptions {
  mode: HandshakeMode;
  /** The engine's identity key. */
  staticKey: KeyPair;
  /** The pairing secret (`pair` only). */
  psk?: Uint8Array;
  ephemeral?: KeyPair;
  prologue?: Uint8Array;
}

/**
 * The engine's side: `readMessage1` says which device key is calling (check it before going on), then
 * `writeMessage2`. In `pair`, the phone's knowledge of the secret only shows once its first transport message
 * decrypts: until then, nothing about the phone may be trusted.
 */
export function responderHandshake(options: ResponderOptions) {
  const psk = checkPsk(options.mode, options.psk);
  const state = new SymmetricState(PROTOCOL_NAMES[options.mode]);
  state.mixHash(options.prologue ?? prologue(options.mode));
  state.mixHash(options.staticKey.publicKey);
  const e = options.ephemeral ?? generateKeyPair();
  let step = 0;
  let re: Uint8Array | null = null;
  let rs: Uint8Array | null = null;
  return {
    readMessage1(message: Uint8Array): { remoteStatic: Uint8Array; payload: Uint8Array } {
      if (step++ !== 0) throw new NoiseError('Out of order');
      if (message.length > MAX_NOISE_MESSAGE) throw new NoiseError('A handshake message was too long');
      re = readSlice(message, 0, KEY_LENGTH).slice();
      state.mixHash(re);
      if (psk) state.mixKey(re);
      state.mixKey(dh(options.staticKey.secretKey, re));
      rs = state.decryptAndHash(readSlice(message, KEY_LENGTH, KEY_LENGTH + TAG_LENGTH)).slice();
      state.mixKey(dh(options.staticKey.secretKey, rs));
      const payload = state.decryptAndHash(readSlice(message, 2 * KEY_LENGTH + TAG_LENGTH, message.length - 2 * KEY_LENGTH - TAG_LENGTH));
      return { remoteStatic: rs, payload };
    },
    writeMessage2(payload: Uint8Array = new Uint8Array(0)): { message: Uint8Array; session: NoiseSession } {
      if (step++ !== 1 || !re || !rs) throw new NoiseError('Out of order');
      state.mixHash(e.publicKey);
      if (psk) state.mixKey(e.publicKey);
      state.mixKey(dh(e.secretKey, re));
      state.mixKey(dh(e.secretKey, rs));
      if (psk) state.mixKeyAndHash(psk);
      const message = concatBytes(e.publicKey, state.encryptAndHash(payload));
      const [toResponder, toInitiator] = state.split();
      return { message, session: { send: new CipherState(toInitiator), receive: new CipherState(toResponder), handshakeHash: state.hash } };
    },
  };
}

/**
 * The 6 digits both sides show while pairing. They come from the handshake hash, so they only match when the phone
 * and the Mac took part in the same handshake: someone in the middle would see other digits.
 */
export function pairingCode(handshakeHash: Uint8Array): string {
  const digest = sha256(concatBytes(utf8ToBytes('switchboard-remote pairing code'), handshakeHash));
  const value = new DataView(digest.buffer, digest.byteOffset, 4).getUint32(0, false);
  return String(value % 1_000_000).padStart(6, '0');
}

/** The pairing secret in the QR code: 128 bits, used once, for two minutes. */
export const PAIRING_SECRET_LENGTH = 16;

export const newPairingSecret = (): Uint8Array => randomBytes(PAIRING_SECRET_LENGTH);

/** The 32-byte pre-shared key Noise takes, from the shorter secret that fits a QR code comfortably. */
export function pskFromSecret(secret: Uint8Array): Uint8Array {
  if (secret.length !== PAIRING_SECRET_LENGTH) throw new NoiseError('A pairing secret is 16 bytes');
  return sha256(concatBytes(utf8ToBytes('switchboard-remote pairing psk'), secret));
}
