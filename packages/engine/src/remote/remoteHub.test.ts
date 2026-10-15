import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  generateKeyPair,
  parseRemoteLink,
  pskFromSecret,
  type PermissionRequest,
  type RemoteContract,
  type RemotePairContract,
  type RemoteSettings,
  type SessionSummary,
  type TranscriptMessage,
} from '@switchboard/protocol';
import { createAppStateStore } from '../db/appState.ts';
import { openCacheDatabase } from '../db/database.ts';
import { RemoteHub } from './remoteHub.ts';
import { projectIdOf, transcriptPage } from './remoteView.ts';
import { APP_ORIGIN, client, handshake } from './testPhone.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const ROOT = '/work/web';
const SESSION = '11111111-1111-4111-8111-111111111111';
const HIDDEN = '22222222-2222-4222-8222-222222222222';

const summary = (id: string, inApp: boolean): SessionSummary =>
  ({ id, title: 'Fix the login form', customTitle: null, cwd: ROOT, projectRoot: ROOT, gitBranch: 'main', worktree: null, updatedAt: Date.now(), unread: false, pinned: false, archivedAt: null, restoredAt: null, inApp }) as unknown as SessionSummary;

const message = (uuid: string): TranscriptMessage => ({ uuid, role: 'user', timestamp: 1, parentToolUseId: null, model: null, blocks: [{ type: 'text', text: uuid }] });

/** A free port above 1024, as Settings › Remote takes. */
const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

/**
 * A stand-in for a tunnel tool: prints a Cloudflare-style address, then stays up. In these tests the "public" address
 * is this computer, since the phone connects straight to the port.
 */
const fakeTunnel = (script: string) => ({ file: process.execPath, args: ['-e', script] });
const QUIET_TUNNEL = (port: number) => fakeTunnel(`console.error('|  https://quiet-river.trycloudflare.com  |'); setInterval(() => {}, 1000); void ${port}`);

async function setup(options: { identity?: Uint8Array | null; tunnel?: (port: number) => { file: string; args: string[] }; tools?: boolean } = {}) {
  const identity = options.identity === undefined ? generateKeyPair().secretKey : options.identity;
  const dir = mkdtempSync(join(tmpdir(), 'switchboard-remote-hub-'));
  const cache = openCacheDatabase(join(dir, 'cache.sqlite'));
  const appState = createAppStateStore(cache.db);
  const sent: string[] = [];
  const answered: string[] = [];
  const created: Array<{ root: string; prompt: string; model: string | null }> = [];
  const permissions: PermissionRequest[] = [
    { requestId: 'r1', sessionId: SESSION, toolName: 'Bash', toolUseId: null, input: { command: 'npm test' }, title: null, description: null, decisionReason: null, blockedPath: '/secret', alwaysLabel: null, agentId: null, createdAt: 1 },
  ];
  const hub = new RemoteHub({
    db: cache.db,
    appState,
    appVersion: '1.2.3',
    appUrl: `${APP_ORIGIN}/remote/`,
    identity: async () => identity,
    sources: () => ({ summaries: [summary(SESSION, true), summary(HIDDEN, false)], live: [], hosts: [], permissions }),
    archiveAfterDays: () => 7,
    scope: () => 'switchboard',
    projects: () => [{ root: ROOT, name: 'Web', exists: true, defaults: { model: 'opus', effort: null, permissionMode: null, workspace: null, baseRef: null, branch: null } }],
    readTranscript: async () => ['a', 'b', 'c'].map(message),
    watchTranscript: () => () => {},
    send: async (_id, text) => (sent.push(text), { messageUuid: 'm1', queued: false }),
    dequeue: () => {},
    interrupt: async () => {},
    respond: (requestId) => void answered.push(requestId),
    create: async (root, prompt, defaults) => (created.push({ root, prompt, model: defaults.model }), { sessionId: 'new' }),
    onStatus: () => {},
    log: () => {},
    findTool: () => (options.tools === false ? null : '/fake/cloudflared'),
    tunnelCommand: (_tool, port) => (options.tunnel ?? QUIET_TUNNEL)(port),
    retryMs: [20],
  });
  cleanups.push(() => {
    hub.stop();
    cache.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const port = await freePort();
  const on = (change: Partial<RemoteSettings> = {}) => hub.configure({ enabled: true, port, ...change });
  return { hub, port, on, sent, answered, created, appState };
}

/** Pairs a phone through the hub, as Settings › Remote and the phone would. */
async function pair(hub: RemoteHub, port: number) {
  const { url } = hub.startPairing();
  expect(url.startsWith(`${APP_ORIGIN}/remote/#p.`)).toBe(true);
  const link = parseRemoteLink(new URL(url).hash);
  if (link?.kind !== 'pair') throw new Error('Not a pairing link');
  expect(link.address).toBe('https://quiet-river.trycloudflare.com');
  const phone = generateKeyPair();
  const pairing = await handshake(port, 'pair', phone, link.enginePublicKey, pskFromSecret(link.secret));
  const asked = client<RemotePairContract>(pairing.frames, pairing.session!).call('pair.request', { name: 'Phone' });
  await until(() => hub.status().pairing.request !== null);
  hub.decidePairing(hub.status().pairing.request!.id, true);
  await asked;
  pairing.ws.close();
  const connected = await handshake(port, 'connect', phone, link.enginePublicKey);
  const remote = client<RemoteContract>(connected.frames, connected.session!);
  await remote.call('hello', { client: { version: '1' } });
  return { remote, connected };
}

async function until(check: () => boolean, ms = 3_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('Remote hub', () => {
  it('starts the server and the tunnel only once it is on', async () => {
    const { hub, on } = await setup();
    await hub.start();
    expect(hub.status()).toMatchObject({ settings: { enabled: false }, address: null, tunnel: { state: 'off' } });
    await on();
    expect(hub.status()).toMatchObject({ address: 'https://quiet-river.trycloudflare.com', tunnel: { state: 'running' }, tools: { cloudflare: true } });
    await hub.configure({ enabled: false });
    expect(hub.status()).toMatchObject({ address: null, tunnel: { state: 'off' } });
    expect(() => hub.startPairing()).toThrow('not reachable');
  });

  it('gives a phone only what it needs, and only the sessions the sidebar lists', async () => {
    const { hub, port, on, sent, answered, created } = await setup();
    await on();
    const { remote } = await pair(hub, port);

    const list = await remote.call('sessions.list', {});
    expect(list.sessions.map((s) => s.id)).toEqual([SESSION]);
    expect(list.sessions[0]).toMatchObject({ projectName: 'Web', projectId: projectIdOf(ROOT) });
    expect(JSON.stringify(list)).not.toContain(ROOT);
    expect(list.prompts[0]).not.toHaveProperty('blockedPath');

    await expect(remote.call('transcript.get', { sessionId: HIDDEN })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(remote.call('session.send', { sessionId: HIDDEN, text: 'hi' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await remote.call('session.send', { sessionId: SESSION, text: 'run the tests' })).toEqual({ queued: false });
    expect(sent).toEqual(['run the tests']);

    await remote.call('session.respond', { requestId: 'r1', decision: { behavior: 'allow' } });
    expect(answered).toEqual(['r1']);
    await expect(remote.call('session.respond', { requestId: 'r-unknown', decision: { behavior: 'allow' } })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(await remote.call('projects.list', {})).toEqual({ projects: [{ id: projectIdOf(ROOT), name: 'Web' }] });
    await remote.call('session.create', { projectId: projectIdOf(ROOT), prompt: 'add a test' });
    expect(created).toEqual([{ root: ROOT, prompt: 'add a test', model: 'opus' }]);
    await expect(remote.call('session.create', { projectId: projectIdOf('/elsewhere'), prompt: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(hub.status().connections).toMatchObject([{ name: 'Phone' }]);
    // A paired phone learns a new address from a connect link, which holds no secret.
    const link = parseRemoteLink(new URL(hub.connectLink().url).hash);
    expect(link).toMatchObject({ kind: 'connect', address: 'https://quiet-river.trycloudflare.com' });
  });

  it('closes a phone\'s connection when it is revoked', async () => {
    const { hub, port, on } = await setup();
    await on();
    const { connected } = await pair(hub, port);
    hub.revoke(hub.status().devices[0]!.id);
    await connected.closed;
    expect(hub.status().devices).toEqual([]);
  });

  it('starts the tunnel again when it stops by itself', async () => {
    let runs = 0;
    const { hub, on } = await setup({
      tunnel: () => {
        runs++;
        return runs === 1
          ? fakeTunnel("console.error('https://first-one.trycloudflare.com'); setTimeout(() => { console.error('ERR lost the connection'); process.exit(1) }, 100)")
          : fakeTunnel("console.error('https://second-one.trycloudflare.com'); setInterval(() => {}, 1000)");
      },
    });
    await on();
    expect(hub.status().address).toBe('https://first-one.trycloudflare.com');
    await until(() => hub.status().address === 'https://second-one.trycloudflare.com');
    expect(hub.status().tunnel).toEqual({ state: 'running', message: null });
  });

  it('says what the tool said when the tunnel doesn\'t start', async () => {
    const { hub, on } = await setup({ tunnel: () => fakeTunnel("console.error('ERR failed to request quick Tunnel: 429 Too Many Requests'); process.exit(1)") });
    await on();
    expect(hub.status()).toMatchObject({ address: null, tunnel: { state: 'failed', message: expect.stringContaining('429 Too Many Requests') } });
  });

  it('says when the tool is not installed', async () => {
    const { hub, on } = await setup({ tools: false });
    await on({ tunnel: 'ngrok' });
    expect(hub.status()).toMatchObject({ problem: { kind: 'tool-missing', tunnel: 'ngrok' }, tools: { ngrok: false } });
  });

  it('uses your own address with a tunnel you run yourself', async () => {
    const { hub, on } = await setup({ tools: false });
    await on({ tunnel: 'custom', customUrl: null });
    expect(hub.status().tunnel.state).toBe('failed');
    await hub.configure({ customUrl: 'https://remote.example.com' });
    expect(hub.status()).toMatchObject({ address: 'https://remote.example.com', tunnel: { state: 'running' } });
  });

  it('stays off without a key from the keychain', async () => {
    const { hub, on } = await setup({ identity: null });
    await on();
    expect(hub.status()).toMatchObject({ address: null, problem: { kind: 'failed' } });
  });

  it('says when the port is taken', async () => {
    const { hub, port, on } = await setup();
    const taken = createServer().listen(port, '127.0.0.1');
    await new Promise((r) => taken.once('listening', r));
    cleanups.push(() => taken.close());
    await on();
    expect(hub.status().problem).toEqual({ kind: 'port-in-use', port });
  });
});

describe('transcript pages', () => {
  const all = ['a', 'b', 'c', 'd', 'e'].map(message);
  const ids = (page: { messages: TranscriptMessage[] }) => page.messages.map((m) => m.uuid);

  it('gives the last messages, pages back, and resumes after the last one the phone has', () => {
    expect(ids(transcriptPage(all, { limit: 2 }))).toEqual(['d', 'e']);
    expect(transcriptPage(all, { limit: 2 }).hasMore).toBe(true);
    expect(ids(transcriptPage(all, { before: 'd', limit: 2 }))).toEqual(['b', 'c']);
    expect(transcriptPage(all, { before: 'b', limit: 2 })).toMatchObject({ hasMore: false });
    expect(transcriptPage(all, { after: 'c', limit: 10 })).toMatchObject({ reset: false, hasMore: false });
    expect(ids(transcriptPage(all, { after: 'c', limit: 10 }))).toEqual(['d', 'e']);
  });

  it('starts over when the message the phone had is gone (a rewind or compaction)', () => {
    expect(transcriptPage(all, { after: 'gone', limit: 2 })).toMatchObject({ reset: true });
    expect(ids(transcriptPage(all, { after: 'gone', limit: 2 }))).toEqual(['d', 'e']);
  });
});
