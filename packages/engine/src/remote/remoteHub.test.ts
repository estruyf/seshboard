import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  generateKeyPair,
  parseRemoteLink,
  pskFromSecret,
  REMOTE_IMAGE_BYTES,
  REMOTE_MAX_IMAGES,
  type CatchUp,
  type PermissionRequest,
  type RemoteContract,
  type RemoteImage,
  type RemotePairContract,
  type RemoteSettings,
  type SessionHostInfo,
  type SessionSummary,
  type TranscriptMessage,
} from '@switchboard/protocol';
import { createAppStateStore } from '../db/appState.ts';
import { commitAll, fileDiff, git, listChanges } from '../git/gitChanges.ts';
import { openCacheDatabase } from '../db/database.ts';
import { RemoteHub } from './remoteHub.ts';
import { capDiff, projectIdOf, remoteCatchUp, sessionChoice, transcriptPage, type SessionChoice } from './remoteView.ts';
import { APP_ORIGIN, client, handshake } from './testPhone.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const ROOT = '/work/web';
const FIRST = '/work/api';
const SEEN_ONLY = '/work/scratch';
const NO_DEFAULTS = { model: null, effort: null, permissionMode: null, workspace: null, baseRef: null, branch: null };
const SESSION = '11111111-1111-4111-8111-111111111111';
/** A browser's push subscription (the keys from RFC 8291's example). */
const PUSH = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' } };
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

async function setup(options: { identity?: Uint8Array | null; tunnel?: (port: number) => { file: string; args: string[] }; tools?: boolean; pushStatus?: number } = {}) {
  const pushes: Array<{ url: string; urgency: string }> = [];
  const pushFetch = (async (url: string, init: RequestInit) => {
    pushes.push({ url, urgency: (init.headers as Record<string, string>).Urgency! });
    return new Response(null, { status: options.pushStatus ?? 201 });
  }) as unknown as typeof fetch;
  const identity = options.identity === undefined ? generateKeyPair().secretKey : options.identity;
  const dir = mkdtempSync(join(tmpdir(), 'switchboard-remote-hub-'));
  const cache = openCacheDatabase(join(dir, 'cache.sqlite'));
  const appState = createAppStateStore(cache.db);
  const sent: string[] = [];
  const sentImages: RemoteImage[][] = [];
  const answered: string[] = [];
  const created: Array<{ root: string; prompt: string; model: string | null; choice?: SessionChoice }> = [];
  const queued: Array<{ root: string; prompt: string; choice: SessionChoice }> = [];
  const calls: string[] = [];
  // The session's checkout: a real repository with one change.
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-remote-repo-')));
  await git(repo, ['init', '-q', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'test@example.com']);
  await git(repo, ['config', 'user.name', 'Test']);
  await git(repo, ['config', 'core.autocrlf', 'false']);
  writeFileSync(join(repo, 'a.txt'), 'one\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-qm', 'initial']);
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n');
  writeFileSync(join(repo, 'big.txt'), Array.from({ length: 2_500 }, (_, i) => `line ${i}`).join('\n'));
  const card: CatchUp = {
    sessionId: SESSION,
    turnId: 't1',
    generatedAt: 1,
    source: 'fallback',
    state: 'finished',
    ask: 'Add a line',
    did: ['Added a line to a.txt'],
    skipped: [],
    need: { kind: 'commit', title: 'Commit the changes', text: 'Two files changed.' },
    signals: { tests: { state: 'notRun' }, diff: { files: 2, add: 2501, del: 0 }, outOfScope: ['src/x.ts', '/Users/me/.zshrc', '../elsewhere/y.ts'], scope: 'src', plan: null },
    reviewMinutes: 2,
  };
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
    projects: () => [
      { root: ROOT, name: 'Web', exists: true, added: true, order: null, defaults: { model: 'opus', effort: null, permissionMode: null, workspace: null, baseRef: null, branch: null } },
      // Only Claude Code sessions here, never added to Switchboard: a phone doesn't see it.
      { root: SEEN_ONLY, name: 'Seen', exists: true, added: false, order: null, defaults: NO_DEFAULTS },
      { root: FIRST, name: 'Api', exists: true, added: true, order: 0, defaults: NO_DEFAULTS },
    ],
    readTranscript: async () => ['a', 'b', 'c'].map(message),
    watchTranscript: () => () => {},
    send: async (_id, text, _mode, images) => (sent.push(text), sentImages.push(images), { messageUuid: 'm1', queued: false }),
    dequeue: () => {},
    interrupt: async () => {},
    respond: (requestId) => void answered.push(requestId),
    create: async (root, prompt, choice) => (created.push({ root, prompt, model: choice.model, choice }), { sessionId: 'new' }),
    queue: (root, prompt, choice) => (queued.push({ root, prompt, choice }), { id: 'later-1' }),
    markRead: (sessionId) => void calls.push(`read ${sessionId}`),
    setFlags: (sessionId, flags) => void calls.push(`flags ${sessionId} ${JSON.stringify(flags)}`),
    setModel: async (sessionId, model) => void calls.push(`model ${sessionId} ${model}`),
    setPermissionMode: async (sessionId, mode) => void calls.push(`mode ${sessionId} ${mode}`),
    models: () => [{ value: 'opus', resolvedModel: 'claude-opus-x', displayName: 'Opus', description: 'Most capable', supportsEffort: true }],
    catchUp: () => card,
    changes: async () => listChanges(repo, 'uncommitted'),
    diff: async (_id, path) => fileDiff(repo, 'uncommitted', path),
    commit: async (_id, message) => commitAll(repo, message, {}),
    onStatus: () => {},
    log: () => {},
    findTool: () => (options.tools === false ? null : '/fake/cloudflared'),
    tunnelCommand: (_tool, port) => (options.tunnel ?? QUIET_TUNNEL)(port),
    retryMs: [20],
    pushFetch,
    catchUpWaitMs: 20,
  });
  cleanups.push(() => {
    hub.stop();
    cache.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });
  const port = await freePort();
  const on = (change: Partial<RemoteSettings> = {}) => hub.configure({ enabled: true, port, ...change });
  return { hub, port, on, sent, sentImages, answered, created, queued, calls, repo, appState, pushes, permissions };
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
    const { hub, port, on, sent, sentImages, answered, created } = await setup();
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
    // Pasted or photographed images go with the message; too many, or one too big, are refused.
    const image = { type: 'image' as const, mediaType: 'image/jpeg' as const, data: 'aGVsbG8=', name: 'screen.jpg' };
    await remote.call('session.send', { sessionId: SESSION, text: 'look', images: [image] });
    expect(sentImages.at(-1)).toEqual([image]);
    await expect(remote.call('session.send', { sessionId: SESSION, text: 'look', images: Array(REMOTE_MAX_IMAGES + 1).fill(image) })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    await expect(remote.call('session.send', { sessionId: SESSION, text: 'look', images: [{ ...image, data: 'a'.repeat(REMOTE_IMAGE_BYTES + 1) }] })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    expect(sentImages).toHaveLength(2);

    await remote.call('session.respond', { requestId: 'r1', decision: { behavior: 'allow' } });
    expect(answered).toEqual(['r1']);
    await expect(remote.call('session.respond', { requestId: 'r-unknown', decision: { behavior: 'allow' } })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(await remote.call('projects.list', {})).toEqual({ projects: [{ id: projectIdOf(FIRST), name: 'Api' }, { id: projectIdOf(ROOT), name: 'Web' }] });
    await expect(remote.call('session.create', { projectId: projectIdOf(SEEN_ONLY), prompt: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await remote.call('session.create', { projectId: projectIdOf(ROOT), prompt: 'add a test' });
    expect(created).toMatchObject([{ root: ROOT, prompt: 'add a test', model: 'opus' }]);
    await expect(remote.call('session.create', { projectId: projectIdOf('/elsewhere'), prompt: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(hub.status().connections).toMatchObject([{ name: 'Phone' }]);
    // A paired phone learns a new address from a connect link, which holds no secret.
    const link = parseRemoteLink(new URL(hub.connectLink().url).hash);
    expect(link).toMatchObject({ kind: 'connect', address: 'https://quiet-river.trycloudflare.com' });
  });

  it('starts and queues sessions with what the phone chose, and the project\'s defaults for the rest', async () => {
    const { hub, port, on, created, queued } = await setup();
    await on();
    const { remote } = await pair(hub, port);
    await remote.call('session.create', { projectId: projectIdOf(ROOT), prompt: 'a', effort: 'high', permissionMode: 'plan', worktree: true });
    expect(created[0]!.choice).toEqual({ model: 'opus', effort: 'high', permissionMode: 'plan', worktree: true, baseRef: 'fresh' });
    await remote.call('session.create', { projectId: projectIdOf(ROOT), prompt: 'b', model: null });
    expect(created[1]!.choice).toEqual({ model: null, effort: null, permissionMode: 'default', worktree: false, baseRef: 'fresh' });
    await expect(remote.call('session.create', { projectId: projectIdOf(ROOT), prompt: 'c', permissionMode: 'bypassPermissions' as never })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    expect(await remote.call('later.add', { projectId: projectIdOf(FIRST), prompt: 'later', permissionMode: 'acceptEdits' })).toEqual({ id: 'later-1' });
    expect(queued).toEqual([{ root: FIRST, prompt: 'later', choice: { model: null, effort: null, permissionMode: 'acceptEdits', worktree: false, baseRef: 'fresh' } }]);
    await expect(remote.call('later.add', { projectId: projectIdOf(SEEN_ONLY), prompt: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const options = await remote.call('options.get', {});
    expect(options.models).toEqual([{ value: 'opus', displayName: 'Opus', description: 'Most capable', supportsEffort: true }]);
    expect(options.modes).toEqual(['default', 'acceptEdits', 'plan', 'auto']);
    expect(options.efforts).toContain('medium');
    expect(options.projects.find((p) => p.id === projectIdOf(ROOT))?.defaults).toEqual({ model: 'opus', effort: null, permissionMode: null, worktree: false });
    expect(JSON.stringify(options)).not.toContain(ROOT);
  });

  it('marks read, archives, and changes the model and mode only of sessions in the list', async () => {
    const { hub, port, on, calls } = await setup();
    await on();
    const { remote } = await pair(hub, port);
    await remote.call('session.markRead', { sessionId: SESSION });
    await remote.call('session.setFlags', { sessionId: SESSION, archived: true });
    await remote.call('session.setModel', { sessionId: SESSION, model: 'sonnet' });
    await remote.call('session.setPermissionMode', { sessionId: SESSION, mode: 'auto' });
    expect(calls).toEqual([`read ${SESSION}`, `flags ${SESSION} {"archived":true}`, `model ${SESSION} sonnet`, `mode ${SESSION} auto`]);
    for (const call of [
      remote.call('session.markRead', { sessionId: HIDDEN }),
      remote.call('session.setFlags', { sessionId: HIDDEN, pinned: true }),
      remote.call('session.setModel', { sessionId: HIDDEN, model: null }),
      remote.call('catchup.get', { sessionId: HIDDEN }),
      remote.call('changes.get', { sessionId: HIDDEN }),
    ])
      await expect(call).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(remote.call('session.setPermissionMode', { sessionId: SESSION, mode: 'dontAsk' as never })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('gives the catch-up without paths outside the project', async () => {
    const { hub, port, on } = await setup();
    await on();
    const { remote } = await pair(hub, port);
    const { catchUp } = await remote.call('catchup.get', { sessionId: SESSION });
    expect(catchUp?.signals.outOfScope).toEqual(['src/x.ts']);
    expect(catchUp?.need.title).toBe('Commit the changes');
  });

  it('lists changes, diffs only listed files with a cap, and commits without a terminal', async () => {
    const { hub, port, on, repo } = await setup();
    await on();
    const { remote } = await pair(hub, port);
    const changes = await remote.call('changes.get', { sessionId: SESSION });
    expect(changes.files).toEqual([
      { path: 'a.txt', status: 'modified', additions: 1, deletions: 0 },
      { path: 'big.txt', status: 'untracked', additions: 2_500, deletions: 0 },
    ]);
    expect(JSON.stringify(changes)).not.toContain(repo);
    expect((await remote.call('changes.diff', { sessionId: SESSION, path: 'a.txt' })).diff).toContain('+two');
    const big = await remote.call('changes.diff', { sessionId: SESSION, path: 'big.txt' });
    expect(big.truncated).toBe(true);
    expect(big.diff.split('\n')).toHaveLength(2_000);
    await expect(remote.call('changes.diff', { sessionId: SESSION, path: '../../etc/passwd' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(remote.call('changes.diff', { sessionId: SESSION, path: '.git/config' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const commit = await remote.call('changes.commit', { sessionId: SESSION, message: 'From the phone' });
    expect(commit).toMatchObject({ ok: true });
    expect((await git(repo, ['log', '-1', '--format=%s'])).trim()).toBe('From the phone');
    expect((await remote.call('changes.get', { sessionId: SESSION })).files).toEqual([]);
    expect(await remote.call('changes.commit', { sessionId: SESSION, message: 'Again' })).toEqual({ ok: false, output: 'There is nothing to commit.' });
  });

  it('tells a phone watching a session that its catch-up changed', async () => {
    const { hub, port, on } = await setup();
    await on();
    const { remote } = await pair(hub, port);
    const heard: Array<string | undefined> = [];
    remote.on('catchup.changed', (event) => heard.push(event.catchUp?.signals.outOfScope.join()));
    hub.catchUpChanged(SESSION, null);
    await remote.call('transcript.watch', { sessionId: SESSION });
    hub.catchUpChanged(SESSION, { ...(await remote.call('catchup.get', { sessionId: SESSION })).catchUp!, signals: { tests: { state: 'notRun' }, diff: null, outOfScope: ['/abs/x', 'rel/y'], scope: null, plan: null } });
    hub.catchUpChanged(HIDDEN, null);
    await until(() => heard.length > 0);
    expect(heard).toEqual(['rel/y']);
  });

  it('pushes to a subscribed phone when a session needs it or finishes, unless the app is on its screen', async () => {
    const { hub, port, on, pushes, permissions, appState } = await setup();
    await on();
    const { remote } = await pair(hub, port);
    const { publicKey } = await remote.call('push.key', {});
    expect(Buffer.from(publicKey, 'base64url')).toHaveLength(65);
    expect((await remote.call('push.key', {})).publicKey).toBe(publicKey);
    await expect(remote.call('push.subscribe', { subscription: { ...PUSH, endpoint: 'https://attacker.example/x' }, needsYou: true, finished: true })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    await remote.call('push.subscribe', { subscription: PUSH, needsYou: true, finished: false });

    hub.permissionAsked(permissions[0]!);
    await until(() => pushes.length === 1);
    expect(pushes[0]).toEqual({ url: PUSH.endpoint, urgency: 'high' });
    // A prompt in a session the phone doesn't list sends nothing.
    hub.permissionAsked({ ...permissions[0]!, sessionId: HIDDEN });
    // Finished is off for this phone.
    hub.hostChanged({ sessionId: SESSION, state: 'running' } as SessionHostInfo);
    hub.hostChanged({ sessionId: SESSION, state: 'idle' } as SessionHostInfo);
    await new Promise((r) => setTimeout(r, 60));
    expect(pushes).toHaveLength(1);

    await remote.call('push.subscribe', { subscription: PUSH, needsYou: true, finished: true });
    hub.hostChanged({ sessionId: SESSION, state: 'running' } as SessionHostInfo);
    hub.hostChanged({ sessionId: SESSION, state: 'idle' } as SessionHostInfo);
    await until(() => pushes.length === 2);
    expect(pushes[1]!.urgency).toBe('normal');

    // On screen: no push.
    await remote.call('device.visibility', { visible: true });
    hub.permissionAsked(permissions[0]!);
    await new Promise((r) => setTimeout(r, 30));
    expect(pushes).toHaveLength(2);
    await remote.call('device.visibility', { visible: false });
    hub.permissionAsked(permissions[0]!);
    await until(() => pushes.length === 3);

    await remote.call('push.unsubscribe', {});
    expect(appState.get('remote.push')).toEqual([]);
  });

  it('forgets a subscription the push service says is gone, and a revoked device\'s', async () => {
    const { hub, port, on, pushes, permissions, appState } = await setup({ pushStatus: 410 });
    await on();
    const { remote } = await pair(hub, port);
    await remote.call('push.subscribe', { subscription: PUSH, needsYou: true, finished: true });
    hub.permissionAsked(permissions[0]!);
    await until(() => pushes.length === 1 && (appState.get('remote.push') as unknown[]).length === 0);
    await remote.call('push.subscribe', { subscription: PUSH, needsYou: true, finished: true });
    hub.revoke(hub.status().devices[0]!.id);
    expect(appState.get('remote.push')).toEqual([]);
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

describe('what a phone sees', () => {
  it('cuts a long diff to its first lines', () => {
    expect(capDiff({ diff: 'a\nb\nc', truncated: false }, 2)).toEqual({ diff: 'a\nb', truncated: true });
    expect(capDiff({ diff: 'a\nb', truncated: false }, 2)).toEqual({ diff: 'a\nb', truncated: false });
  });

  it('leaves out a catch-up\'s paths outside the checkout', () => {
    const card = { signals: { outOfScope: ['src/a.ts', '/etc/x', 'C:\\Users\\x', '..\\up', '../up', '\\\\server\\share'], scope: '/abs' } } as unknown as CatchUp;
    expect(remoteCatchUp(card)?.signals).toMatchObject({ outOfScope: ['src/a.ts'], scope: null });
    expect(remoteCatchUp(null)).toBeNull();
  });

  it('takes the project\'s defaults for what the phone leaves out', () => {
    const defaults = { model: 'opus', effort: 'low' as const, permissionMode: 'acceptEdits' as const, workspace: 'worktree' as const, baseRef: 'head' as const, branch: null };
    expect(sessionChoice({}, defaults)).toEqual({ model: 'opus', effort: 'low', permissionMode: 'acceptEdits', worktree: true, baseRef: 'head' });
    expect(sessionChoice({ model: null, effort: null, permissionMode: 'plan', worktree: false }, defaults)).toEqual({ model: null, effort: null, permissionMode: 'plan', worktree: false, baseRef: 'head' });
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
