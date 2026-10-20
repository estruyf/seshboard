import { verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encryptPayload, generateVapidKeys, isPushEndpoint, sendPush, validVapidKeys, vapidAuthorization, vapidPublicKey } from './webPush.ts';

const b64 = (text: string) => new Uint8Array(Buffer.from(text, 'base64url'));

describe('encryptPayload', () => {
  it('matches RFC 8291\'s example byte for byte', () => {
    const body = encryptPayload(new TextEncoder().encode('When I grow up, I want to be a watermelon'), { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' }, { salt: b64('DGv6ra1nlYgDCS1FRnbzlw'), serverPrivateKey: b64('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw') });
    expect(Buffer.from(body).toString('base64url')).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );
  });

  it('refuses a key that is not a subscription\'s', () => {
    expect(() => encryptPayload(new Uint8Array(1), { p256dh: 'AAAA', auth: 'BTBZMqHH6r4Tts7J_aSIgg' })).toThrow();
  });
});

describe('VAPID', () => {
  it('signs a JWT for the push service\'s origin that the public key verifies', () => {
    const keys = generateVapidKeys();
    expect(b64(keys.publicKey)).toHaveLength(65);
    const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, 'https://switchboard.struyfconsulting.com', 1_000_000);
    const [, token, key] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    expect(key).toBe(keys.publicKey);
    const [h, c, s] = token!.split('.');
    expect(JSON.parse(Buffer.from(c!, 'base64url').toString())).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_000 + 12 * 3600, sub: 'https://switchboard.struyfconsulting.com' });
    expect(verify('sha256', Buffer.from(`${h}.${c}`), { key: vapidPublicKey(keys), dsaEncoding: 'ieee-p1363' }, Buffer.from(s!, 'base64url'))).toBe(true);
  });
});

describe('a device\'s own VAPID key', () => {
  it('takes a key pair made with WebCrypto, as the remote app makes it, and signs with it', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const keys = { publicKey: Buffer.concat([Buffer.from([4]), b64(jwk.x!), b64(jwk.y!)]).toString('base64url'), privateKey: jwk.d! };
    expect(keys.publicKey).toHaveLength(87);
    expect(keys.privateKey).toHaveLength(43);
    expect(validVapidKeys(keys)).toBe(true);
    expect(vapidAuthorization('https://web.push.apple.com/x', keys, 'https://switchboard.struyfconsulting.com').endsWith(`k=${keys.publicKey}`)).toBe(true);
  });

  it('refuses a private key that isn\'t the public key\'s, or no key at all', () => {
    expect(validVapidKeys({ publicKey: generateVapidKeys().publicKey, privateKey: generateVapidKeys().privateKey })).toBe(false);
    expect(validVapidKeys({ publicKey: 'A'.repeat(87), privateKey: 'A'.repeat(43) })).toBe(false);
  });
});

describe('push endpoints', () => {
  it('takes only the browsers\' push services over https', () => {
    expect(isPushEndpoint('https://fcm.googleapis.com/fcm/send/x')).toBe(true);
    expect(isPushEndpoint('https://web.push.apple.com/QGx')).toBe(true);
    expect(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(isPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe(true);
    expect(isPushEndpoint('http://fcm.googleapis.com/x')).toBe(false);
    expect(isPushEndpoint('https://fcm.googleapis.com:8443/x')).toBe(false);
    expect(isPushEndpoint('https://evil.example/fcm.googleapis.com')).toBe(false);
    expect(isPushEndpoint('https://push.apple.com.evil.example/x')).toBe(false);
    expect(isPushEndpoint('https://127.0.0.1/x')).toBe(false);
  });
});

describe('sendPush', () => {
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' } };

  it('posts the encrypted payload with the headers push services want', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fake = (async (url: string, init: RequestInit) => (seen.push({ url, init }), new Response(null, { status: 201 }))) as unknown as typeof fetch;
    expect(await sendPush(subscription, { kind: 'needs-you' }, { keys: generateVapidKeys(), subject: 'https://example.com', urgent: true, topic: 'abc', fetch: fake })).toBe('sent');
    const headers = seen[0]!.init.headers as Record<string, string>;
    expect(seen[0]!.url).toBe(subscription.endpoint);
    expect(headers).toMatchObject({ 'Content-Encoding': 'aes128gcm', Urgency: 'high', TTL: '600', Topic: 'abc' });
    expect(headers.Authorization).toMatch(/^vapid t=.+, k=.+$/);
    expect(JSON.stringify(Buffer.from(seen[0]!.init.body as Uint8Array).toString())).not.toContain('needs-you');
  });

  it('says when the subscription is gone', async () => {
    const gone = (async () => new Response(null, { status: 410 })) as unknown as typeof fetch;
    const failed = (async () => new Response(null, { status: 500 })) as unknown as typeof fetch;
    expect(await sendPush(subscription, {}, { keys: generateVapidKeys(), subject: 'https://example.com', urgent: false, fetch: gone })).toBe('gone');
    expect(await sendPush(subscription, {}, { keys: generateVapidKeys(), subject: 'https://example.com', urgent: false, fetch: failed })).toBe('failed');
  });
});
