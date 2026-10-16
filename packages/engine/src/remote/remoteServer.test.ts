import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateKeyPair, pairingCode, pskFromSecret, RpcError, type FrameSocket, type RemoteContract, type RemotePairContract } from '@switchboard/protocol';
import { openCacheDatabase } from '../db/database.ts';
import { DeviceStore } from './devices.ts';
import { Pairing, PAIRING_MAX_FAILURES, type PairingState } from './pairing.ts';
import { Backoff, clientAddress, CLOSE, decodePath, deviceKind, RemoteServer } from './remoteServer.ts';
import { APP_ORIGIN, client, handshake, open } from './testPhone.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

async function setup(options: { backoff?: Backoff } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'switchboard-remote-'));
  const cache = openCacheDatabase(join(dir, 'cache.sqlite'));
  const identity = generateKeyPair();
  const devices = new DeviceStore(cache.db);
  const states: PairingState[] = [];
  let onRequest: (state: PairingState) => void = () => {};
  const pairing = new Pairing((state) => {
    states.push(state);
    if (state.request) onRequest(state);
  });
  const server = new RemoteServer({
    identity: () => identity,
    devices,
    pairing,
    appVersion: '1.2.3',
    computerName: () => "Elio's iMac",
    origins: [APP_ORIGIN],
    ...options,
    log: () => {},
    handlers: (device) => ({
      'sessions.list': () => ({ sessions: [], prompts: [{ requestId: 'r1', sessionId: 's1', toolName: 'Bash', input: { command: device.name }, title: null, description: null, alwaysLabel: null, createdAt: 1 }] }),
      'projects.list': () => ({ projects: [] }),
      'projects.branches': () => ({ current: null, branches: [], checkedOutElsewhere: [] }),
      'transcript.get': () => ({ messages: [], hasMore: false, reset: false }),
      'transcript.watch': () => ({}),
      'transcript.unwatch': () => ({}),
      'session.send': () => ({ queued: false }),
      'session.queue.remove': () => ({}),
      'session.interrupt': () => ({}),
      'session.stopTask': () => ({}),
      'session.respond': () => ({}),
      'session.create': () => {
        throw new RpcError('NOT_FOUND', 'No such project');
      },
      'later.add': () => ({ id: 'l1' }),
      'session.markRead': () => ({}),
      'session.markUnread': () => ({}),
      'session.setFlags': () => ({}),
      'session.setModel': () => ({}),
      'session.setPermissionMode': () => ({}),
      'options.get': () => ({ models: [], efforts: [], modes: [], profiles: [], defaultProfileId: 'default', projects: [] }),
      'usage.get': () => ({ profiles: [] }),
      'usage.tokens': () => ({ breakdown: null }),
      'session.setEffort': () => ({}),
      'session.ask': () => ({ threadId: 't', id: 'q', at: 1 }),
      'session.askThreads': () => ({ threads: [] }),
      'catchup.get': () => ({ catchUp: null }),
      'changes.get': () => ({ branch: null, files: [], error: null }),
      'changes.diff': () => ({ diff: '', truncated: false }),
      'changes.commit': () => ({ ok: false, output: '' }),
      'push.key': () => ({ publicKey: '' }),
      'push.subscribe': () => ({}),
      'push.unsubscribe': () => ({}),
      'device.visibility': () => ({}),
    }),
  });
  const { port } = await server.start(0);
  cleanups.push(() => {
    server.stop();
    pairing.cancel();
    cache.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { server, devices, pairing, identity, port, states, allowNext: (allow: boolean, seen?: (code: string) => void) => (onRequest = (state) => (seen?.(state.request!.code), pairing.decide(state.request!.id, allow))) };
}

async function pairPhone(env: Awaited<ReturnType<typeof setup>>, name = "Elio's iPhone") {
  const { secret } = env.pairing.start();
  const phone = generateKeyPair();
  const result = await handshake(env.port, 'pair', phone, env.identity.publicKey, pskFromSecret(secret));
  let shown = '';
  env.allowNext(true, (code) => (shown = code));
  const { deviceId } = await client<RemotePairContract>(result.frames, result.session!).call('pair.request', { name });
  expect(shown).toBe(pairingCode(result.session!.handshakeHash));
  result.ws.close();
  return { phone, deviceId };
}

describe('Remote server', () => {
  it('pairs a phone after Allow, then lets it connect with its key', async () => {
    const env = await setup();
    const { phone, deviceId } = await pairPhone(env);
    expect(env.devices.list()).toMatchObject([{ id: deviceId, name: "Elio's iPhone" }]);

    const { frames, session } = await handshake(env.port, 'connect', phone, env.identity.publicKey);
    const remote = client<RemoteContract>(frames, session!);
    expect(await remote.call('hello', { client: { version: '1' } })).toEqual({ app: { version: '1.2.3' }, device: { id: deviceId, name: "Elio's iPhone" }, computer: { name: "Elio's iMac" }, features: ['attachments', 'usage.tokens', 'branches', 'session.markUnread'] });
    expect((await remote.call('sessions.list', {})).prompts[0]!.input).toEqual({ command: "Elio's iPhone" });
    expect(env.server.list()).toMatchObject([{ deviceId, name: "Elio's iPhone" }]);
    await expect(remote.call('session.create', { projectId: '0123456789abcdef', prompt: 'hi' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // Methods of the app's own contract don't exist here.
    await expect((remote as unknown as { call(m: string, p: unknown): Promise<unknown> }).call('terminal.open', {})).rejects.toMatchObject({ code: 'METHOD_NOT_FOUND' });
  });

  it('refuses a device that is not paired, and closes a revoked one at once', async () => {
    const env = await setup();
    expect((await handshake(env.port, 'connect', generateKeyPair(), env.identity.publicKey)).code).toBe(CLOSE.unknownDevice);

    const { phone, deviceId } = await pairPhone(env);
    const connected = await handshake(env.port, 'connect', phone, env.identity.publicKey);
    await client<RemoteContract>(connected.frames, connected.session!).call('hello', { client: { version: '1' } });
    expect(env.devices.revoke(deviceId)).toBe(true);
    env.server.disconnect(deviceId);
    await connected.closed;
    expect((await handshake(env.port, 'connect', phone, env.identity.publicKey)).code).toBe(CLOSE.unknownDevice);
  });

  it('refuses a phone revoked between its handshake and its first message', async () => {
    const env = await setup();
    const { phone, deviceId } = await pairPhone(env);
    const connecting = await handshake(env.port, 'connect', phone, env.identity.publicKey);
    env.devices.revoke(deviceId);
    env.server.disconnect(deviceId);
    void client<RemoteContract>(connecting.frames, connecting.session!).call('hello', { client: { version: '1' } }).catch(() => {});
    expect(await connecting.closed).toBe(CLOSE.unknownDevice);
    expect(env.server.list()).toEqual([]);
  });

  it('keeps a phone that is denied, or too slow, out', async () => {
    const env = await setup();
    const { secret } = env.pairing.start();
    const phone = generateKeyPair();
    const result = await handshake(env.port, 'pair', phone, env.identity.publicKey, pskFromSecret(secret));
    env.allowNext(false);
    await expect(client<RemotePairContract>(result.frames, result.session!).call('pair.request', { name: 'Phone' })).rejects.toMatchObject({ code: 'DENIED' });
    expect(env.devices.list()).toEqual([]);
    // The secret was used: scanning the same QR code again doesn't work.
    expect((await handshake(env.port, 'pair', generateKeyPair(), env.identity.publicKey, pskFromSecret(secret))).code).toBe(CLOSE.pairingClosed);
  });

  it('closes pairing after too many wrong secrets', async () => {
    // Without the per-address backoff, which would stop this phone sooner.
    const env = await setup({ backoff: new (class extends Backoff {
      override allowed() {
        return true;
      }
    })() });
    env.pairing.start();
    for (let i = 0; i < PAIRING_MAX_FAILURES; i++) {
      const wrong = await handshake(env.port, 'pair', generateKeyPair(), env.identity.publicKey, pskFromSecret(new Uint8Array(16).fill(i)));
      // The phone notices at once: the engine's answer doesn't decrypt with the wrong secret.
      expect(wrong.session).toBeNull();
      // Whatever it sends then doesn't decrypt on the engine either, which counts as a failed attempt.
      wrong.frames.send(new Uint8Array(40));
      await wrong.closed;
    }
    expect(env.pairing.state()).toMatchObject({ offer: null, locked: true });
  }, 20_000);

  it('closes a connection on a replayed frame', async () => {
    const env = await setup();
    const { phone } = await pairPhone(env);
    const first = await handshake(env.port, 'connect', phone, env.identity.publicKey);
    const sent: Uint8Array[] = [];
    const recording: FrameSocket = { ...first.frames, send: (frame) => (sent.push(frame), first.frames.send(frame)) };
    await client<RemoteContract>(recording, first.session!).call('hello', { client: { version: '1' } });
    // The same bytes again: the counter moved on, so they don't decrypt.
    first.ws.send(sent[0]!);
    expect(await first.closed).toBe(1005);
    // And on a new connection, an old frame means nothing either.
    const second = await handshake(env.port, 'connect', phone, env.identity.publicKey);
    second.ws.send(sent[0]!);
    await second.closed;
  });

  it('refuses another origin and anything but a hello, and serves no pages', async () => {
    const env = await setup();
    await expect(open(env.port, 'https://evil.example')).rejects.toThrow('HTTP 403');
    await expect(open(env.port, `http://127.0.0.1:${env.port}`)).rejects.toThrow('HTTP 403');
    const stray = await open(env.port);
    stray.ws.send('hello');
    expect(await stray.closed).toBe(CLOSE.refused);

    const status = await new Promise<number>((resolve, reject) => {
      request({ host: '127.0.0.1', port: env.port, path: '/' }, (res) => (res.resume(), resolve(res.statusCode!))).on('error', reject).end();
    });
    expect(status).toBe(404);
  });
});

describe('who is asking', () => {
  const asking = (headers: Record<string, string>) => ({ headers, socket: { remoteAddress: '127.0.0.1' } }) as unknown as Parameters<typeof clientAddress>[0];

  it('is the address the tunnel saw, not what the client claims', () => {
    expect(clientAddress(asking({}), false)).toBe('127.0.0.1');
    expect(clientAddress(asking({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }), false)).toBe('203.0.113.9');
    expect(clientAddress(asking({ 'cf-connecting-ip': '198.51.100.4', 'x-forwarded-for': '198.51.100.4' }), true)).toBe('198.51.100.4');
    // Behind another tunnel, a client's own CF-Connecting-IP is just a header it made up.
    expect(clientAddress(asking({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '203.0.113.9' }), false)).toBe('203.0.113.9');
  });
});

describe('the backoff', () => {
  it('lets two failures through, then waits twice as long each time, up to five minutes', () => {
    let now = 0;
    const backoff = new Backoff(() => now);
    backoff.failed('a');
    backoff.failed('a');
    expect(backoff.allowed('a')).toBe(true);
    backoff.failed('a');
    expect(backoff.allowed('a')).toBe(false);
    expect(backoff.allowed('b')).toBe(true);
    now = 1_000;
    expect(backoff.allowed('a')).toBe(true);
    for (let i = 0; i < 20; i++) backoff.failed('a');
    now += 5 * 60_000 - 1;
    expect(backoff.allowed('a')).toBe(false);
    backoff.succeeded('a');
    expect(backoff.allowed('a')).toBe(true);
  });
});

describe('request paths', () => {
  it('drops the query and refuses climbing out', () => {
    expect(decodePath('/ws?x=1')).toBe('/ws');
    expect(decodePath('/a/%2e%2e/b')).toBe('/b');
    expect(decodePath('/a%2f..%2fb')).toBeNull();
    expect(decodePath('/a%5c..%5cb')).toBeNull();
    expect(decodePath('/%00')).toBeNull();
  });
});

describe('a paired device\'s kind', () => {
  it('tells Switchboard on another computer, a phone and a computer\'s browser apart', () => {
    expect(deviceKind('switchboard-desktop://switchboard', undefined)).toBe('computer');
    expect(deviceKind(APP_ORIGIN, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148')).toBe('phone');
    expect(deviceKind(APP_ORIGIN, 'Mozilla/5.0 (Linux; Android 15) Mobile Safari/537.36')).toBe('phone');
    expect(deviceKind(APP_ORIGIN, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15')).toBe('browser');
  });
});
