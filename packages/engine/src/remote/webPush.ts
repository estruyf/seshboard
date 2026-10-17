import { createECDH, createPrivateKey, createPublicKey, generateKeyPairSync, hkdfSync, randomBytes, sign, verify, createCipheriv, type KeyObject } from 'node:crypto';

/**
 * Web Push from the engine itself, without a push library: the payload encrypted for the browser (RFC 8291,
 * `aes128gcm`), so the push service (Apple, Google, Mozilla, Microsoft) only carries ciphertext, and the request
 * signed with the engine's VAPID key (RFC 8292), so a push service only accepts pushes for a subscription from the
 * key it was made with.
 */

/** The engine's VAPID key pair: the public key as the browser takes it, both base64url. */
export type VapidKeys = {
  /** The uncompressed P-256 point (65 bytes). */
  publicKey: string;
  /** The private scalar (32 bytes). */
  privateKey: string;
};

/** A browser's push subscription, as `PushSubscription.toJSON()` gives it. */
export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const fromB64url = (text: string) => new Uint8Array(Buffer.from(text, 'base64url'));

export function generateVapidKeys(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]);
  return { publicKey: b64url(point), privateKey: privateKey.export({ format: 'jwk' }).d! };
}

function vapidPrivateKey(keys: VapidKeys): KeyObject {
  const point = fromB64url(keys.publicKey);
  return createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: b64url(point.slice(1, 33)), y: b64url(point.slice(33, 65)), d: keys.privateKey }, format: 'jwk' });
}

export function vapidPublicKey(keys: VapidKeys): KeyObject {
  const point = fromB64url(keys.publicKey);
  return createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64url(point.slice(1, 33)), y: b64url(point.slice(33, 65)) }, format: 'jwk' });
}

/**
 * Whether a device's own VAPID key pair (`push.subscribe`'s `vapid`) is one: a point on P-256 and the private key that
 * goes with it, so the pushes signed with it are accepted for the subscription made with its public half.
 */
export function validVapidKeys(keys: VapidKeys): boolean {
  try {
    const data = Buffer.from('switchboard-vapid-check');
    return verify('sha256', data, vapidPublicKey(keys), sign('sha256', data, vapidPrivateKey(keys)));
  } catch {
    return false;
  }
}

/**
 * The `Authorization` header for a push to `endpoint`: a JWT for the push service's origin, valid for 12 hours, signed
 * with ES256, and the public key it was signed with.
 */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now = Date.now()): string {
  const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key: vapidPrivateKey(keys), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${keys.publicKey}`;
}

/** One record is enough: payloads here are a few hundred bytes. */
const RECORD_SIZE = 4096;

/**
 * Encrypts a payload for one subscription (RFC 8291 with RFC 8188's `aes128gcm`). `salt` and `serverKey` are for the
 * RFC's test vector; leave them out.
 */
export function encryptPayload(payload: Uint8Array, subscription: PushSubscriptionJson['keys'], test: { salt?: Uint8Array; serverPrivateKey?: Uint8Array } = {}): Uint8Array<ArrayBuffer> {
  const uaPublic = fromB64url(subscription.p256dh);
  const authSecret = fromB64url(subscription.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('Not a push subscription key');
  const ecdh = createECDH('prime256v1');
  if (test.serverPrivateKey) ecdh.setPrivateKey(test.serverPrivateKey);
  else ecdh.generateKeys();
  const asPublic = new Uint8Array(ecdh.getPublicKey());
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const salt = test.salt ?? new Uint8Array(randomBytes(16));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  if (payload.length + 17 > RECORD_SIZE) throw new Error('Push payload too large');
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // The padding delimiter 2 ends the last (and only) record.
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  Buffer.from(salt).copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return new Uint8Array(Buffer.concat([header, asPublic, body]));
}

/**
 * The push services browsers use. A subscription's endpoint must be on one of them, so a paired phone can't make the
 * engine send requests anywhere else.
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/, /^android\.googleapis\.com$/];

export function isPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.port && PUSH_HOSTS.some((host) => host.test(url.hostname));
  } catch {
    return false;
  }
}

export type PushResult = 'sent' | 'gone' | 'failed';

/**
 * Sends one push. `gone` (404 or 410): the browser dropped the subscription, so it should be forgotten. A push to a
 * phone that needs you is urgent; one about a finished turn is not, and gives the phone a few hours to wake.
 */
export async function sendPush(
  subscription: PushSubscriptionJson,
  payload: object,
  options: { keys: VapidKeys; subject: string; urgent: boolean; topic?: string; fetch?: typeof fetch },
): Promise<PushResult> {
  const body = encryptPayload(new TextEncoder().encode(JSON.stringify(payload)), subscription.keys);
  const response = await (options.fetch ?? fetch)(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidAuthorization(subscription.endpoint, options.keys, options.subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: options.urgent ? '600' : '14400',
      Urgency: options.urgent ? 'high' : 'normal',
      // A newer push for the same session replaces one the phone hasn't had yet.
      ...(options.topic ? { Topic: options.topic } : {}),
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404 || response.status === 410) return 'gone';
  return response.ok ? 'sent' : 'failed';
}
