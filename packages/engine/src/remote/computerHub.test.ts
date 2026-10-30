import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { generateKeyPair, remoteLinkFragment, RpcError, type ComputerEvent, type ComputersStatus, type RemoteContract, type Handlers } from '@seshboard/protocol';
import { openCacheDatabase } from '../db/database.ts';
import { ComputerHub, offlineMessage, pairingMessage, sameAddress } from './computerHub.ts';
import { LinkError, retryDelay } from './computerLink.ts';
import { DeviceStore } from './devices.ts';
import { Pairing, type PairingState } from './pairing.ts';
import { CLOSE, RemoteServer } from './remoteServer.ts';
import { APP_ORIGIN } from './testPhone.ts';
import { REMOTE_DESKTOP_ORIGIN } from '@seshboard/protocol';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'seshboard-computers-'));
  const cache = openCacheDatabase(join(dir, 'cache.sqlite'));
  cleanups.push(() => {
    cache.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return cache.db;
}

/** Computer B: Remote with one session, which answers what the hub asks. */
async function otherComputer(name = 'Studio Mac') {
  const db = tempDb();
  let identity = generateKeyPair();
  const devices = new DeviceStore(db);
  let onRequest: (state: PairingState) => void = () => {};
  const pairing = new Pairing((state) => state.request && onRequest(state));
  const server = new RemoteServer({
    identity: () => identity,
    devices,
    pairing,
    appVersion: '9.9.9',
    computerName: () => name,
    origins: () => [APP_ORIGIN, REMOTE_DESKTOP_ORIGIN],
    log: () => {},
    handlers: (device) =>
      ({
        'sessions.list': () => ({ sessions: [], prompts: [{ requestId: 'r1', sessionId: 's1', toolName: 'Bash', input: { command: device.name }, title: null, description: null, alwaysLabel: null, createdAt: 1 }] }),
        'session.create': () => {
          throw new RpcError('NOT_FOUND', 'No such project');
        },
      }) as unknown as Omit<Handlers<RemoteContract>, 'hello'>,
  });
  const { port } = await server.start(0);
  cleanups.push(() => {
    server.stop();
    pairing.cancel();
  });
  const address = `http://127.0.0.1:${port}`;
  return {
    server,
    devices,
    pairing,
    address,
    pairLink: () => `https://switchboard.example/remote/#${remoteLinkFragment({ kind: 'pair', enginePublicKey: identity.publicKey, secret: pairing.start().secret, address })}`,
    connectLink: (at = address) => `https://switchboard.example/remote/#${remoteLinkFragment({ kind: 'connect', enginePublicKey: identity.publicKey, address: at })}`,
    answerNext: (allow: boolean) => (onRequest = (state) => pairing.decide(state.request!.id, allow)),
    /** Remote gets a new key there, as when the keychain lost the old one (the rename to Seshboard did). */
    newKey: () => void (identity = generateKeyPair()),
  };
}

/** An older Seshboard there: it closes every socket with 4400 once it reads the hello, as when the key it got was for another one. */
async function olderComputerRefusing(): Promise<string> {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  server.on('connection', (ws) => ws.once('message', () => ws.close(CLOSE.refused)));
  cleanups.push(() => server.close());
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

/** Computer A: the hub, with its own database and device key. */
function thisComputer(db = tempDb(), secret = generateKeyPair().secretKey) {
  const statuses: ComputersStatus[] = [];
  const events: ComputerEvent[] = [];
  const hub = new ComputerHub({ db, deviceKey: async () => secret, computerName: () => 'MacBook Air', onStatus: (status) => statuses.push(status), onEvent: (event) => events.push(event), log: () => {} });
  cleanups.push(() => hub.stop());
  const until = async (test: (status: ComputersStatus) => boolean, ms = 5_000): Promise<ComputersStatus> => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const status = hub.status();
      if (test(status)) return status;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`Timed out; last status: ${JSON.stringify(hub.status())}`);
  };
  return { hub, statuses, events, until, db, secret };
}

describe('Other computers', () => {
  it('pairs with another computer after Allow there, connects, and passes requests and events on', async () => {
    const b = await otherComputer();
    const a = thisComputer();
    b.answerNext(true);
    await a.hub.add(b.pairLink());
    const status = await a.until((s) => s.computers[0]?.state === 'connected');
    // Meanwhile, the code both computers show.
    expect(a.statuses.some((s) => s.pairing?.state === 'waiting' && /^\d{6}$/.test(s.pairing.code ?? ''))).toBe(true);
    expect(status.pairing).toBeNull();
    expect(status.computers[0]).toMatchObject({ name: 'Studio Mac', address: b.address, version: '9.9.9', message: null });
    // B lists A as a computer, under A's name.
    expect(b.devices.list()).toMatchObject([{ name: 'MacBook Air', kind: 'computer' }]);

    const id = status.computers[0]!.id;
    const list = (await a.hub.call(id, 'sessions.list', {})) as { prompts: Array<{ input: unknown }> };
    expect(list.prompts[0]!.input).toEqual({ command: 'MacBook Air' });
    await expect(a.hub.call(id, 'session.create', { projectId: '0123456789abcdef', prompt: 'hi' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // B checks the params itself.
    await expect(a.hub.call(id, 'session.create', { projectId: '../etc', prompt: 'hi' })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    // New session's choices go through to that computer; a mode that never asks is refused there.
    await expect(a.hub.call(id, 'session.create', { projectId: '0123456789abcdef', prompt: 'hi', model: 'opus', effort: 'high', permissionMode: 'plan', worktree: true })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(a.hub.call(id, 'session.create', { projectId: '0123456789abcdef', prompt: 'hi', permissionMode: 'bypassPermissions' })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    expect(status.computers[0]!.lastSeen).toBeNull();

    b.server.each((rpc) => rpc.emit('sessions.changed', { sessions: [], prompts: [] }));
    await a.until(() => a.events.length > 0);
    expect(a.events[0]).toEqual({ computerId: id, name: 'sessions.changed', payload: { sessions: [], prompts: [] } });
  });

  it('passes on only what this version can read, and says what it left out', async () => {
    const b = await otherComputer();
    const a = thisComputer();
    b.answerNext(true);
    await a.hub.add(b.pairLink());
    const { computers } = await a.until((s) => s.computers[0]?.state === 'connected');
    const id = computers[0]!.id;
    expect(computers[0]!.problem).toBeNull();

    // A session the windows can't read (its title isn't text) is left out; the rest goes through.
    const prompt = { requestId: 'r1', sessionId: 's1', toolName: 'Bash', input: {}, title: null, description: null, alwaysLabel: null, createdAt: 1 };
    b.server.each((rpc) => rpc.emit('sessions.changed', { sessions: [{ id: 's1', title: { evil: true } }], prompts: [prompt] } as never));
    await a.until(() => a.events.length > 0);
    expect(a.events[0]!.payload).toEqual({ sessions: [], prompts: [prompt] });
    expect(a.hub.status().computers[0]!.problem).toMatch(/^Studio Mac sent 1 item in its session list this version of Seshboard can’t read/);

    // What isn't a list at all doesn't reach the windows.
    b.server.each((rpc) => rpc.emit('sessions.changed', 'garbage' as never));
    await a.until((s) => /^Studio Mac sent data /.test(s.computers[0]!.problem ?? ''));
    // A list it can read clears it.
    b.server.each((rpc) => rpc.emit('sessions.changed', { sessions: [], prompts: [] }));
    await a.until((s) => s.computers[0]!.problem === null);
    expect(a.events.map((e) => e.payload)).toEqual([{ sessions: [], prompts: [prompt] }, { sessions: [], prompts: [] }]);
    // Its answers go through the same check (B's sessions.list answer is a list it can read).
    expect(await a.hub.call(id, 'sessions.list', {})).toMatchObject({ sessions: [] });
  });

  it('says why pairing failed when the other computer denies it', async () => {
    const b = await otherComputer();
    const a = thisComputer();
    b.answerNext(false);
    await a.hub.add(b.pairLink());
    const status = await a.until((s) => s.pairing?.state === 'failed');
    expect(status.pairing?.message).toBe('The other computer didn’t allow this one.');
    expect(status.computers).toEqual([]);
    a.hub.cancelPairing();
    expect(a.hub.status().pairing).toBeNull();
  });

  it('refuses what isn’t a link, and a new address for a computer it doesn’t know', async () => {
    const b = await otherComputer();
    const a = thisComputer();
    await expect(a.hub.add('https://example.com/#nothing')).rejects.toMatchObject({ code: 'INVALID_LINK' });
    await expect(a.hub.add(b.connectLink())).rejects.toMatchObject({ code: 'NOT_PAIRED' });
  });

  it('reconnects at home after a restart, and follows a new address', async () => {
    const b = await otherComputer();
    const first = thisComputer();
    b.answerNext(true);
    await first.hub.add(b.pairLink());
    await first.until((s) => s.computers[0]?.state === 'connected');
    first.hub.stop();

    // The same database and key: the app started again.
    const again = thisComputer(first.db, first.secret);
    await again.hub.start();
    await again.until((s) => s.computers[0]?.state === 'connected');

    // The tunnel got a new address; the old one answers nothing any more.
    const moved = await otherComputer();
    await again.hub.add(b.connectLink(moved.address));
    expect(again.hub.status().computers[0]!.address).toBe(moved.address);
  });

  it('stops trying once the other computer revoked this one', async () => {
    const b = await otherComputer();
    const a = thisComputer();
    b.answerNext(true);
    await a.hub.add(b.pairLink());
    const { computers } = await a.until((s) => s.computers[0]?.state === 'connected');
    const device = b.devices.list()[0]!;
    b.devices.revoke(device.id);
    b.server.disconnect(device.id);
    const status = await a.until((s) => s.computers[0]?.state === 'unpaired');
    expect(status.computers[0]!.message).toBe('Studio Mac no longer knows this computer. Pair it again.');
    a.hub.forget(computers[0]!.id);
    expect(a.hub.status().computers).toEqual([]);
  });

  it('stops trying, and says to pair again, once the other computer\'s Remote key changed', async () => {
    const b = await otherComputer();
    const a = thisComputer();
    b.answerNext(true);
    await a.hub.add(b.pairLink());
    await a.until((s) => s.computers[0]?.state === 'connected');
    b.newKey();
    b.server.disconnect(b.devices.list()[0]!.id);
    const status = await a.until((s) => s.computers[0]?.state === 'unpaired');
    expect(status.computers[0]!.message).toBe('Studio Mac no longer knows this computer. Pair it again.');
  });

  it('replaces the earlier pairing when the computer at the same address is paired again with its new key', async () => {
    const b = await otherComputer();
    const a = thisComputer();
    b.answerNext(true);
    await a.hub.add(b.pairLink());
    const first = await a.until((s) => s.computers[0]?.state === 'connected');
    b.newKey();
    b.answerNext(true);
    await a.hub.add(b.pairLink());
    const status = await a.until((s) => s.computers.length === 1 && s.computers[0]!.id !== first.computers[0]!.id && s.computers[0]!.state === 'connected');
    expect(status.computers[0]).toMatchObject({ address: b.address, state: 'connected' });
  });

  it('keeps a computer at another address when one is paired', async () => {
    const b = await otherComputer();
    const c = await otherComputer('Office Mac');
    const a = thisComputer();
    b.answerNext(true);
    await a.hub.add(b.pairLink());
    await a.until((s) => s.computers[0]?.state === 'connected');
    c.answerNext(true);
    await a.hub.add(c.pairLink());
    await a.until((s) => s.computers.length === 2 && s.computers.every((computer) => computer.state === 'connected'));
  });

  it('stops trying when an older Seshboard there refuses the handshake, rather than every minute', async () => {
    const b = await otherComputer();
    const a = thisComputer();
    b.answerNext(true);
    await a.hub.add(b.pairLink());
    await a.until((s) => s.computers[0]?.state === 'connected');
    await a.hub.add(b.connectLink(await olderComputerRefusing()));
    await a.until((s) => s.computers[0]?.state === 'unpaired');
  });

  it('says it can’t reach a computer that is off, and tries again later', async () => {
    const b = await otherComputer();
    const a = thisComputer();
    b.answerNext(true);
    await a.hub.add(b.pairLink());
    await a.until((s) => s.computers[0]?.state === 'connected');
    const before = Date.now();
    b.server.stop();
    const status = await a.until((s) => s.computers[0]?.state === 'offline' && s.computers[0].retryAt !== null);
    // When it was last there, for "Last seen 2h ago".
    expect(status.computers[0]!.lastSeen).toBeGreaterThanOrEqual(before);
    expect(status.computers[0]!.message).toMatch(/^(Lost the connection to Studio Mac\.|Nothing answers at Studio Mac’s address)/);
    await expect(a.hub.call(status.computers[0]!.id, 'sessions.list', {})).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
});

describe('Other computers’ wording', () => {
  it('says what to do', () => {
    expect(offlineMessage({ kind: 'http', status: 403 }, 'Studio Mac')).toBe('Studio Mac refused the connection. Update Seshboard there.');
    expect(offlineMessage({ kind: 'closed', code: CLOSE.version }, 'Studio Mac')).toMatch(/Update Seshboard on both computers/);
    expect(pairingMessage(new LinkError({ kind: 'closed', code: CLOSE.pairingClosed }))).toMatch(/^This link was used or has expired/);
    expect(pairingMessage(new RpcError('TIMEOUT', 'x'))).toBe('Nobody clicked Allow on the other computer in time.');
  });

  it('waits longer each time, up to a minute', () => {
    expect([0, 1, 2, 3, 4, 5, 50].map(retryDelay)).toEqual([1_000, 2_000, 5_000, 10_000, 30_000, 60_000, 60_000]);
  });
});

describe('the same address', () => {
  it('is the same origin, whatever the path, and only that', () => {
    expect(sameAddress('https://mac.example.com', 'https://mac.example.com/')).toBe(true);
    expect(sameAddress('https://mac.example.com', 'https://other.example.com')).toBe(false);
    expect(sameAddress('http://127.0.0.1:4000', 'http://127.0.0.1:4001')).toBe(false);
    expect(sameAddress('not a url', 'not a url')).toBe(true);
  });
});
