import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import vectors from './remoteNoise.vectors.json' with { type: 'json' };
import { lineTransport } from './lineTransport.ts';
import { encryptedStream, engineAddress, engineSocketUrl, helloFrame, parseHello, parseRemoteLink, remoteLinkFragment, type FrameSocket } from './remoteChannel.ts';
import {
  CipherState,
  generateKeyPair,
  initiatorHandshake,
  keyPairFromSecret,
  newPairingSecret,
  NoiseError,
  pairingCode,
  pskFromSecret,
  responderHandshake,
  type HandshakeMode,
  type KeyPair,
} from './remoteNoise.ts';

const generateKeyPairFrom = (hex: string) => keyPairFromSecret(hexToBytes(hex)).publicKey;
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const bytes = (value: string) => new TextEncoder().encode(value);

function handshake(mode: HandshakeMode, options: { engine: KeyPair; phone: KeyPair; phoneKnows?: Uint8Array; enginePsk?: Uint8Array; phonePsk?: Uint8Array }) {
  const phone = initiatorHandshake({ mode, staticKey: options.phone, remoteStatic: options.phoneKnows ?? options.engine.publicKey, ...(options.phonePsk ? { psk: options.phonePsk } : {}) });
  const engine = responderHandshake({ mode, staticKey: options.engine, ...(options.enginePsk ? { psk: options.enginePsk } : {}) });
  const first = engine.readMessage1(phone.writeMessage1(bytes('hi')));
  const second = engine.writeMessage2(bytes('welcome'));
  const done = phone.readMessage2(second.message);
  return { first, engineSession: second.session, phoneSession: done.session, payload: done.payload };
}

describe('Noise handshakes', () => {
  it('connects a known device: both sides learn who the other is and share keys', () => {
    const engine = generateKeyPair();
    const phone = generateKeyPair();
    const { first, engineSession, phoneSession, payload } = handshake('connect', { engine, phone });
    expect(first.remoteStatic).toEqual(phone.publicKey);
    expect(text(first.payload)).toBe('hi');
    expect(text(payload)).toBe('welcome');
    expect(engineSession.handshakeHash).toEqual(phoneSession.handshakeHash);
    expect(text(engineSession.receive.decrypt(phoneSession.send.encrypt(bytes('ping'))))).toBe('ping');
    expect(text(phoneSession.receive.decrypt(engineSession.send.encrypt(bytes('pong'))))).toBe('pong');
  });

  it('gives fresh keys on every connection', () => {
    const engine = generateKeyPair();
    const phone = generateKeyPair();
    const a = handshake('connect', { engine, phone });
    const b = handshake('connect', { engine, phone });
    expect(a.engineSession.handshakeHash).not.toEqual(b.engineSession.handshakeHash);
    // A frame from one connection is worthless on another.
    expect(() => b.engineSession.receive.decrypt(a.phoneSession.send.encrypt(bytes('ping')))).toThrow(NoiseError);
  });

  it('pairs with the secret from the QR code, and both sides show the same code', () => {
    const engine = generateKeyPair();
    const phone = generateKeyPair();
    const psk = pskFromSecret(newPairingSecret());
    const { engineSession, phoneSession } = handshake('pair', { engine, phone, enginePsk: psk, phonePsk: psk });
    expect(pairingCode(engineSession.handshakeHash)).toMatch(/^\d{6}$/);
    expect(pairingCode(engineSession.handshakeHash)).toBe(pairingCode(phoneSession.handshakeHash));
  });

  it('refuses a phone with the wrong pairing secret at its first frame', () => {
    const engine = generateKeyPair();
    const phone = generateKeyPair();
    const phoneP = initiatorHandshake({ mode: 'pair', staticKey: phone, remoteStatic: engine.publicKey, psk: pskFromSecret(newPairingSecret()) });
    const engineP = responderHandshake({ mode: 'pair', staticKey: engine, psk: pskFromSecret(newPairingSecret()) });
    engineP.readMessage1(phoneP.writeMessage1());
    const { message, session } = engineP.writeMessage2();
    // The phone notices the engine has another secret...
    expect(() => phoneP.readMessage2(message)).toThrow(NoiseError);
    // ...and whatever a phone without the secret sends never decrypts on the engine.
    expect(() => session.receive.decrypt(new CipherState(new Uint8Array(32)).encrypt(bytes('pair me')))).toThrow(NoiseError);
  });

  it('refuses an engine that does not hold the key from the QR code', () => {
    const engine = generateKeyPair();
    const impostor = generateKeyPair();
    const phone = generateKeyPair();
    const phoneSide = initiatorHandshake({ mode: 'connect', staticKey: phone, remoteStatic: engine.publicKey });
    const impostorSide = responderHandshake({ mode: 'connect', staticKey: impostor });
    expect(() => impostorSide.readMessage1(phoneSide.writeMessage1())).toThrow(NoiseError);
  });

  it('refuses a handshake message that was changed on the way', () => {
    const engine = generateKeyPair();
    const phone = initiatorHandshake({ mode: 'connect', staticKey: generateKeyPair(), remoteStatic: engine.publicKey });
    const message = phone.writeMessage1(bytes('hi'));
    message[40]! ^= 1;
    expect(() => responderHandshake({ mode: 'connect', staticKey: engine }).readMessage1(message)).toThrow(NoiseError);
  });

  it('keeps a pair handshake and a connect handshake apart', () => {
    const engine = generateKeyPair();
    const psk = pskFromSecret(newPairingSecret());
    const phone = initiatorHandshake({ mode: 'pair', staticKey: generateKeyPair(), remoteStatic: engine.publicKey, psk });
    expect(() => responderHandshake({ mode: 'connect', staticKey: engine }).readMessage1(phone.writeMessage1())).toThrow(NoiseError);
  });

  it('refuses a low-order public key', () => {
    const engine = generateKeyPair();
    const message = new Uint8Array(32 + 48 + 16);
    expect(() => responderHandshake({ mode: 'connect', staticKey: engine }).readMessage1(message)).toThrow(NoiseError);
  });

  it('refuses replayed, reordered and tampered frames, and stays closed after one', () => {
    const engine = generateKeyPair();
    const { engineSession, phoneSession } = handshake('connect', { engine, phone: generateKeyPair() });
    const one = phoneSession.send.encrypt(bytes('one'));
    const two = phoneSession.send.encrypt(bytes('two'));
    expect(text(engineSession.receive.decrypt(one))).toBe('one');
    expect(() => engineSession.receive.decrypt(one)).toThrow(NoiseError);
    expect(() => engineSession.receive.decrypt(two)).toThrow('The channel is closed');

    const fresh = handshake('connect', { engine, phone: generateKeyPair() });
    const a = fresh.phoneSession.send.encrypt(bytes('a'));
    const b = fresh.phoneSession.send.encrypt(bytes('b'));
    expect(() => fresh.engineSession.receive.decrypt(b)).toThrow(NoiseError);
    void a;

    const third = handshake('connect', { engine, phone: generateKeyPair() });
    const frame = third.phoneSession.send.encrypt(bytes('hello'));
    frame[0]! ^= 1;
    expect(() => third.engineSession.receive.decrypt(frame)).toThrow(NoiseError);
  });
});

describe('the Noise test vectors (cacophony)', () => {
  // The handshakes must be Noise exactly, not only agree with themselves: these vectors come from an independent
  // implementation. Messages 3 and on are transport messages, alternating from the initiator.
  for (const vector of vectors) {
    it(vector.protocol_name, () => {
      const mode = vector.protocol_name.includes('psk2') ? 'pair' : 'connect';
      const psk = 'init_psks' in vector ? hexToBytes(vector.init_psks![0]!) : undefined;
      const key = (hex: string) => ({ secretKey: hexToBytes(hex), publicKey: generateKeyPairFrom(hex) });
      const phone = initiatorHandshake({ mode, staticKey: key(vector.init_static), remoteStatic: hexToBytes(vector.init_remote_static), ephemeral: key(vector.init_ephemeral), prologue: hexToBytes(vector.init_prologue), ...(psk ? { psk } : {}) });
      const engine = responderHandshake({ mode, staticKey: key(vector.resp_static), ephemeral: key(vector.resp_ephemeral), prologue: hexToBytes(vector.resp_prologue), ...(psk ? { psk } : {}) });
      const [m1, m2, ...transport] = vector.messages;
      const first = phone.writeMessage1(hexToBytes(m1!.payload));
      expect(bytesToHex(first)).toBe(m1!.ciphertext);
      expect(bytesToHex(engine.readMessage1(first).payload)).toBe(m1!.payload);
      const second = engine.writeMessage2(hexToBytes(m2!.payload));
      expect(bytesToHex(second.message)).toBe(m2!.ciphertext);
      const done = phone.readMessage2(second.message);
      expect(bytesToHex(done.session.handshakeHash)).toBe(vector.handshake_hash);
      transport.forEach((message, index) => {
        const [from, to] = index % 2 === 0 ? [done.session, second.session] : [second.session, done.session];
        const sealed = from.send.encrypt(hexToBytes(message.payload));
        expect(bytesToHex(sealed)).toBe(message.ciphertext);
        expect(bytesToHex(to.receive.decrypt(sealed))).toBe(message.payload);
      });
    });
  }
});

describe('the remote app\'s links', () => {
  it('round-trip a pairing and a new address', () => {
    const key = generateKeyPair().publicKey;
    const secret = newPairingSecret();
    const pair = remoteLinkFragment({ kind: 'pair', enginePublicKey: key, secret, address: 'https://abc.trycloudflare.com' });
    expect(pair).toMatch(/^p\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(parseRemoteLink(`#${pair}`)).toEqual({ kind: 'pair', enginePublicKey: key, secret, address: 'https://abc.trycloudflare.com' });
    const connect = remoteLinkFragment({ kind: 'connect', enginePublicKey: key, address: 'https://mac.tail1.ts.net' });
    expect(parseRemoteLink(connect)).toEqual({ kind: 'connect', enginePublicKey: key, address: 'https://mac.tail1.ts.net' });
  });

  it('refuse anything else', () => {
    const key = generateKeyPair().publicKey;
    const link = (address: string) => remoteLinkFragment({ kind: 'connect', enginePublicKey: key, address });
    expect(parseRemoteLink('')).toBeNull();
    expect(parseRemoteLink('c.abc.def')).toBeNull();
    expect(parseRemoteLink('x.a.b.c')).toBeNull();
    expect(parseRemoteLink(link('http://evil.example'))).toBeNull();
    expect(parseRemoteLink(link('https://a.example/path'))).toBeNull();
    expect(parseRemoteLink(link('javascript:alert(1)'))).toBeNull();
  });

  it('take https anywhere, and http only on this computer', () => {
    expect(engineAddress('https://abc.trycloudflare.com/')).toBe('https://abc.trycloudflare.com');
    expect(engineAddress('http://127.0.0.1:47615')).toBe('http://127.0.0.1:47615');
    expect(engineAddress('http://192.168.1.2:47615')).toBeNull();
    expect(engineAddress('https://user:pw@a.example')).toBeNull();
    expect(engineSocketUrl('https://abc.trycloudflare.com')).toBe('wss://abc.trycloudflare.com/ws');
    expect(engineSocketUrl('http://127.0.0.1:1')).toBe('ws://127.0.0.1:1/ws');
  });
});

describe('the encrypted channel', () => {
  function socketPair(): [FrameSocket & { sent: Uint8Array[] }, FrameSocket & { sent: Uint8Array[] }, { closed: number }] {
    const state = { closed: 0 };
    const make = () => {
      const listeners = new Set<(frame: Uint8Array) => void>();
      return {
        sent: [] as Uint8Array[],
        listeners,
        send(frame: Uint8Array) {
          this.sent.push(frame);
          for (const listener of other(this).listeners) listener(frame);
        },
        onFrame(listener: (frame: Uint8Array) => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        close: () => void state.closed++,
      };
    };
    const a = make();
    const b = make();
    const other = (s: object) => (s === a ? b : a);
    return [a, b, state];
  }

  it('carries the RPC lines, long ones split over frames', () => {
    expect(parseHello(helloFrame('connect', bytes('x')))).toEqual({ ok: true, mode: 'connect', message1: bytes('x') });
    expect(parseHello(Uint8Array.of(1, 2, 3))).toEqual({ ok: false, reason: 'not-remote' });
    expect(parseHello(Uint8Array.of(0x53, 99, 1))).toEqual({ ok: false, reason: 'version' });

    const { engineSession, phoneSession } = handshake('connect', { engine: generateKeyPair(), phone: generateKeyPair() });
    const [phoneSocket, engineSocket] = socketPair();
    const received: unknown[] = [];
    lineTransport(encryptedStream(engineSocket, engineSession)).onMessage((m) => received.push(m));
    const phone = lineTransport(encryptedStream(phoneSocket, phoneSession));
    const long = 'é'.repeat(100_000);
    phone.send({ kind: 'event', name: 'x', payload: long });
    phone.send({ kind: 'event', name: 'y', payload: 1 });
    expect(phoneSocket.sent.length).toBeGreaterThan(3);
    expect(received).toEqual([{ kind: 'event', name: 'x', payload: long }, { kind: 'event', name: 'y', payload: 1 }]);
  });

  it('drops the first frame and closes when the other side is refused', () => {
    const { engineSession, phoneSession } = handshake('connect', { engine: generateKeyPair(), phone: generateKeyPair() });
    const [phoneSocket, engineSocket, state] = socketPair();
    const received: unknown[] = [];
    lineTransport(encryptedStream(engineSocket, engineSession, { onFirstFrame: () => false })).onMessage((m) => received.push(m));
    const phone = lineTransport(encryptedStream(phoneSocket, phoneSession));
    phone.send({ kind: 'event', name: 'x', payload: 1 });
    phone.send({ kind: 'event', name: 'y', payload: 2 });
    expect(received).toEqual([]);
    expect(state.closed).toBe(1);
  });

  it('closes on the first frame that does not decrypt', () => {
    const { engineSession } = handshake('connect', { engine: generateKeyPair(), phone: generateKeyPair() });
    const [phoneSocket, engineSocket, state] = socketPair();
    const errors: string[] = [];
    let first = 0;
    encryptedStream(engineSocket, engineSession, { onError: (e) => errors.push(e), onFirstFrame: () => void first++ });
    phoneSocket.send(bytes('not encrypted at all'));
    expect(errors).toEqual(['A message did not decrypt']);
    expect(state.closed).toBe(1);
    expect(first).toBe(0);
  });
});
