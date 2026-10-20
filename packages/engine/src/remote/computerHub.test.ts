import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateKeyPair, remoteLinkFragment, RpcError, type ComputerEvent, type ComputersStatus, type RemoteContract, type Handlers } from '@switchboard/protocol';
import { openCacheDatabase } from '../db/database.ts';
import { ComputerHub, offlineMessage, pairingMessage } from './computerHub.ts';
import { LinkError, retryDelay } from './computerLink.ts';
import { DeviceStore } from './devices.ts';
import { Pairing, type PairingState } from './pairing.ts';
import { CLOSE, RemoteServer } from './remoteServer.ts';
import { APP_ORIGIN } from './testPhone.ts';
import { REMOTE_DESKTOP_ORIGIN } from '@switchboard/protocol';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'switchboard-computers-'));
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
  const identity = generateKeyPair();
  const devices = new DeviceStore(db);
  let onRequest: (state: PairingState) => void = () => {};
  const pairing = new Pairing((state) => state.request && onRequest(state));
  const server = new RemoteServer({
    identity: () => identity,
    devices,
    pairing,
    appVersion: '9.9.9',
    computerName: () => name,
    origins: [APP_ORIGIN, REMOTE_DESKTOP_ORIGIN],
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
  };
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
    expect(offlineMessage({ kind: 'http', status: 403 }, 'Studio Mac')).toBe('Studio Mac refused the connection. Update Switchboard there.');
    expect(offlineMessage({ kind: 'closed', code: CLOSE.version }, 'Studio Mac')).toMatch(/Update Switchboard on both computers/);
    expect(pairingMessage(new LinkError({ kind: 'closed', code: CLOSE.pairingClosed }))).toMatch(/^This link was used or has expired/);
    expect(pairingMessage(new RpcError('TIMEOUT', 'x'))).toBe('Nobody clicked Allow on the other computer in time.');
  });

  it('waits longer each time, up to a minute', () => {
    expect([0, 1, 2, 3, 4, 5, 50].map(retryDelay)).toEqual([1_000, 2_000, 5_000, 10_000, 30_000, 60_000, 60_000]);
  });
});
