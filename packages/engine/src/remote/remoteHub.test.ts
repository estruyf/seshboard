import { createDecipheriv, createECDH, hkdfSync } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BUILT_IN_PIPELINES,
  generateKeyPair,
  parseRemoteLink,
  parseBriefs,
  parseRunBriefs,
  writeRunStub,
  type Pipeline,
  type PipelineRunState,
  checkRemoteSessions,
  pskFromSecret,
  REMOTE_APP_URL,
  REMOTE_IMAGE_BYTES,
  REMOTE_MAX_FILES,
  REMOTE_MAX_IMAGES,
  REMOTE_PREVIEW_APP_URL,
  type CatchUp,
  type LiveSession,
  type PermissionRequest,
  type RemoteContract,
  type RemoteImage,
  type RemotePairContract,
  type RemoteSettings,
  type SessionHostInfo,
  type SessionSummary,
  type TranscriptMessage,
  writeStub,
} from '@seshboard/protocol';
import type { RemoteLimitStanding } from '@seshboard/protocol';
import { createAppStateStore } from '../db/appState.ts';
import { commitAll, fileDiff, git, listChanges } from '../git/gitChanges.ts';
import { openCacheDatabase } from '../db/database.ts';
import { RemoteHub, remoteAppOrigins, type RemoteFromDevice, type RemotePipelines } from './remoteHub.ts';
import { autoOf, capDiff, projectIdOf, remoteCatchUp, remoteDefaults, remoteSessions, sessionChoice, transcriptPage, type SessionChoice } from './remoteView.ts';
import { APP_ORIGIN, client, handshake, open } from './testPhone.ts';
import { generateVapidKeys } from './webPush.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const ROOT = '/work/web';
const FIRST = '/work/api';
const SEEN_ONLY = '/work/scratch';
/** The `accountKey` the fake engine has a profile for. */
const ACCOUNT = 'ab'.repeat(32);
const NO_DEFAULTS = { model: null, effort: null, permissionMode: null, workspace: null, baseRef: null, branch: null, defaultBranch: null };
const SESSION = '11111111-1111-4111-8111-111111111111';
/** A browser's push subscription (the keys from RFC 8291's example). */
const PUSH = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' } };
const HIDDEN = '22222222-2222-4222-8222-222222222222';
/** The browser's private key for `PUSH` (RFC 8291's example), to read what a push carries. */
const PUSH_PRIVATE = 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94';

/** What the browser for `PUSH` would read from a push (RFC 8291 with one `aes128gcm` record). */
function readPush(body: Uint8Array): Record<string, unknown> {
  const salt = body.subarray(0, 16);
  const asPublic = body.subarray(21, 21 + body[20]!);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(PUSH_PRIVATE, 'base64url'));
  const uaPublic = Buffer.from(PUSH.keys.p256dh, 'base64url');
  const ikm = Buffer.from(hkdfSync('sha256', ecdh.computeSecret(asPublic), Buffer.from(PUSH.keys.auth, 'base64url'), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const record = body.subarray(21 + body[20]!);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
  return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString()) as Record<string, unknown>;
}

const summary = (id: string, inApp: boolean): SessionSummary =>
  ({ id, title: 'Fix the login form', customTitle: null, cwd: ROOT, projectRoot: ROOT, gitBranch: 'main', worktree: null, updatedAt: Date.now(), unread: false, pinned: false, archivedAt: null, restoredAt: null, inApp, profileId: 'work' }) as unknown as SessionSummary;

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

/** The built-in pipeline as the fake engine has it, saved for every project. */
const PIPELINE: Pipeline = { ...BUILT_IN_PIPELINES[0]!, builtIn: true, createdAt: 1, updatedAt: 1 };

/** A run of `PIPELINE` from `parent` (null: a run row), waiting for you at Push, in a worktree of `ROOT`. */
function runOf(id: string, parent: string | null): PipelineRunState {
  return {
    run: { id, pipelineId: PIPELINE.id, pipeline: PIPELINE, parentSessionId: parent, task: parent ? null : 'Add a toggle', title: 'Add a toggle', projectRoot: ROOT, cwd: `${ROOT}-worktree`, profileId: null, status: 'waiting', reason: 'Push waits for you.', waitingFor: 'push', hold: null, step: 3, round: 1, sentBackTo: null, pr: null, unattended: false, createdAt: 1, updatedAt: Date.now(), endedAt: null, archivedAt: null, restoredAt: null },
    steps: [{ runId: id, step: 'Plan', index: 0, round: 1, sessionId: `${id}-plan`, status: 'done', outcome: 'clean', verdict: null, reason: 'plan approved', plan: 'The plan', actions: [], startedAt: 1, endedAt: 2 }],
  };
}

async function setup(options: { identity?: Uint8Array | null; tunnel?: (port: number) => { file: string; args: string[] }; tools?: boolean; pushStatus?: number; hosts?: SessionHostInfo[]; archived?: Set<string>; previewApp?: boolean; runs?: PipelineRunState[] } = {}) {
  const pushes: Array<{ url: string; urgency: string }> = [];
  /** Each push's VAPID header and body, apart so the tests that only count pushes stay as they are. */
  const pushBodies: Array<{ authorization: string; body: Uint8Array }> = [];
  const pushFetch = (async (url: string, init: RequestInit) => {
    pushes.push({ url, urgency: (init.headers as Record<string, string>).Urgency! });
    pushBodies.push({ authorization: (init.headers as Record<string, string>).Authorization!, body: init.body as Uint8Array });
    return new Response(null, { status: options.pushStatus ?? 201 });
  }) as unknown as typeof fetch;
  const identity = options.identity === undefined ? generateKeyPair().secretKey : options.identity;
  const dir = mkdtempSync(join(tmpdir(), 'seshboard-remote-hub-'));
  const cache = openCacheDatabase(join(dir, 'cache.sqlite'));
  const appState = createAppStateStore(cache.db);
  const sent: string[] = [];
  const sentImages: RemoteImage[][] = [];
  /** The sessions phones follow now (a watch's `stop` takes it out). */
  const watching = new Set<string>();
  const answered: string[] = [];
  const created: Array<{ root: string; prompt: string; model: string | null; choice?: SessionChoice; images?: RemoteImage[] }> = [];
  const queued: Array<{ root: string; prompt: string; choice: SessionChoice }> = [];
  const calls: string[] = [];
  /** How each session stands with its usage limit. */
  const limitOf: Record<string, RemoteLimitStanding> = {};
  // The session's checkout: a real repository with one change.
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-remote-repo-')));
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
  const fromDevice: RemoteFromDevice[] = [];
  const runs = options.runs ?? [];
  const ran: Array<Parameters<RemotePipelines['run']>[0]> = [];
  const hub = new RemoteHub({
    db: cache.db,
    appState,
    appVersion: '1.2.3',
    appUrl: `${APP_ORIGIN}/remote/`,
    previewApp: options.previewApp ?? false,
    filesDir: join(dir, 'remote-files'),
    logFile: join(dir, 'remote.log'),
    identity: async () => identity,
    sources: () => ({ summaries: [summary(SESSION, true), summary(HIDDEN, false)].map((s) => (options.archived?.has(s.id) ? { ...s, archivedAt: Date.now() } : s)), live: [], hosts: options.hosts ?? [], permissions }),
    archiveAfterDays: () => 7,
    scope: () => 'switchboard',
    projects: () => [
      { root: ROOT, name: 'Web', exists: true, added: true, order: null, defaults: { model: 'opus', effort: null, permissionMode: null, workspace: null, baseRef: null, branch: null, defaultBranch: null }, profileId: null },
      // Only Claude Code sessions here, never added to Seshboard: a phone doesn't see it.
      { root: SEEN_ONLY, name: 'Seen', exists: true, added: false, order: null, defaults: NO_DEFAULTS, profileId: null },
      { root: FIRST, name: 'Api', exists: true, added: true, order: 0, defaults: NO_DEFAULTS, profileId: 'work' },
    ],
    profiles: () => ({
      profiles: [
        { id: 'default', name: 'Personal', color: 'yellow', defaults: { model: null, effort: null, permissionMode: null, workspace: null, baseRef: null }, account: 'a'.repeat(64) },
        { id: 'work', name: 'Work', color: 'blue', defaults: { model: 'sonnet', effort: 'high', permissionMode: null, workspace: 'worktree', baseRef: null } },
      ],
      defaultId: 'default',
    }),
    readTranscript: async () => ['a', 'b', 'c'].map(message),
    watchTranscript: (sessionId) => (watching.add(sessionId), () => void watching.delete(sessionId)),
    send: async (_id, text, _mode, images) => (sent.push(text), sentImages.push(images), { messageUuid: 'm1', queued: false }),
    dequeue: (sessionId, id) => void calls.push(`dequeue ${sessionId} ${id}`),
    sendQueuedNow: async (sessionId, id) => void calls.push(`send now ${sessionId} ${id}`),
    limit: (sessionId) => limitOf[sessionId] ?? null,
    resumeLimit: async (sessionId) => void calls.push(`resume ${sessionId}`),
    armLimit: (sessionId, armed) => void calls.push(`arm ${sessionId} ${armed}`),
    upNext: (sessionId) => (sessionId === SESSION ? [{ id: 'q1', text: 'Then the tests', attachments: [], createdAt: 1 }] : []),
    interrupt: async () => {},
    stopTask: async (sessionId, taskId) => void calls.push(`stop ${sessionId} ${taskId}`),
    respond: (requestId) => void answered.push(requestId),
    create: async (root, prompt, choice, images) => (created.push({ root, prompt, model: choice.model, choice, images }), { sessionId: 'new' }),
    branches: async (root) => (root === ROOT ? { current: 'main', branches: ['main', 'feat/login', 'taken'], checkedOutElsewhere: ['taken'] } : { current: null, branches: [], checkedOutElsewhere: [] }),
    queue: (root, prompt, choice) => (queued.push({ root, prompt, choice }), { id: 'later-1' }),
    markRead: (sessionId) => void calls.push(`read ${sessionId}`),
    markUnread: (sessionId) => void calls.push(`unread ${sessionId}`),
    setFlags: (sessionId, flags) => void calls.push(`flags ${sessionId} ${JSON.stringify(flags)}`),
    setModel: async (sessionId, model) => void calls.push(`model ${sessionId} ${model}`),
    setEffort: async (sessionId, effort) => void calls.push(`effort ${sessionId} ${effort}`),
    setPermissionMode: async (sessionId, mode) => void calls.push(`mode ${sessionId} ${mode}`),
    autoModel: () => ({ enabled: true, allowed: ['sonnet', 'opus'] }),
    globalPermissionMode: () => 'default',
    globalModel: () => ({ model: null, effort: null }),
    models: () => [{ value: 'opus', resolvedModel: 'claude-opus-x', displayName: 'Opus', description: 'Most capable', supportsEffort: true }],
    usage: async (profileId, refresh) => {
      calls.push(`usage ${profileId}${refresh ? ' refresh' : ''}`);
      if (profileId === 'work') return { usage: null, error: 'Not logged in' };
      return { usage: { fetchedAt: 1, limits: [{ kind: 'session', group: 'session', percent: 44, resetsAt: 2, scope: null, severity: 'normal', isActive: true }], extraUsage: null }, error: null };
    },
    sessionCost: (sessionId) => {
      calls.push(`sessionCost ${sessionId}`);
      return { usd: 4.2, partial: false };
    },
    windowCosts: (account, windows) => {
      calls.push(`windowCosts ${account.slice(0, 4)} ${windows.map((w) => w.kind).join(',')}`);
      return account === ACCOUNT ? windows.map((w) => ({ ...w, usd: 1.5, partial: false })) : null;
    },
    tokens: (account, params) => {
      calls.push(`tokens ${account.slice(0, 4)} ${params.period} ${params.groupBy}`);
      if (account !== ACCOUNT) return null;
      const tokens = { input: 10, output: 20, cacheRead: 300, cacheWrite: 40 };
      const row = (key: string, projectRoot: string | null) => ({ key, label: key, sessionId: null, projectRoot, model: 'claude-opus-x', sessions: 1, turns: 2, fastTurns: 0, tokens, largestContext: 350, share: 0.5, measured: false });
      return {
        period: params.period,
        from: 1,
        to: 2,
        bucket: 'hour',
        totals: { tokens, sessions: 2, turns: 4, fastTurns: 0, largestContext: 350 },
        rows: [row(ROOT, ROOT), row('/elsewhere/tools', '/elsewhere/tools'), row('', null)],
        buckets: [],
        scan: null,
      };
    },
    catchUp: () => card,
    ask: (sessionId, question, threadId) => (calls.push(`ask ${sessionId} ${question} ${threadId ?? 'new'}`), { threadId: threadId ?? 't1', id: `q${calls.length}`, at: 5 }),
    askThreads: () => ({ threads: [{ id: 't1', title: 'Why?', createdAt: 1, items: [{ id: 'q0', question: 'Why?', answer: 'Because.', at: 1 }] }] }),
    changes: async () => listChanges(repo, 'uncommitted'),
    diff: async (_id, path) => fileDiff(repo, 'uncommitted', path),
    commit: async (_id, message) => commitAll(repo, message, {}),
    clonePlan: async (url, name) => ({ state: 'free', repo: { owner: 'o', name: 'n', branch: null, defaultBranch: null }, name: name ?? 'n', where: `~/Developer/${name ?? 'n'}` }),
    clone: async (jobId, url, name, onProgress) => {
      calls.push(`clone ${jobId} ${url} ${name}`);
      const progress = { jobId, phase: null, percent: null, root: null, reused: false, brings: null, error: null };
      setTimeout(() => {
        onProgress({ ...progress, state: 'running', phase: 'receiving', percent: 40 });
        onProgress({ ...progress, state: 'done', phase: 'checkout', percent: 100, root: ROOT });
      }, 5);
    },
    cancelClone: (jobId) => void calls.push(`cancel ${jobId}`),
    pipelines: {
      runs: () => runs,
      list: (root) => (root === ROOT ? [{ ...PIPELINE, scope: { kind: 'project', root: ROOT } }] : []),
      run: async (input) => (ran.push(input), runOf('run-new', input.parentSessionId)),
      act: async (action, runId, message) => (calls.push(`${action} ${runId}${message ? ` ${message}` : ''}`), runs.find((r) => r.run.id === runId)!),
      archive: async (runId, archived) => void calls.push(`archive ${runId} ${archived}`),
      pushPreview: async () => ({ message: 'Add the toggle', files: 2, branch: 'worktree-toggle', base: 'main', problem: null }),
      write: async (runId, text) => (calls.push(`write ${runId} ${text}`), { sessionId: 'adopted' }),
    },
    onStatus: () => {},
    onFromDevice: (event) => void fromDevice.push(event),
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
  return { hub, dir, port, on, watching, sent, sentImages, answered, created, queued, calls, limitOf, repo, appState, pushes, pushBodies, permissions, fromDevice, ran };
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

  it('writes Remote\'s log to its file, and says when an address waits until Unblock', async () => {
    const { hub, dir, on, port } = await setup({ tools: false });
    await on({ tunnel: 'custom', customUrl: 'https://remote.example.com' });
    for (let i = 0; i < 3; i++) await handshake(port, 'connect', generateKeyPair(), generateKeyPair().publicKey);
    await until(() => hub.status().blocked.length === 1);
    expect(hub.status().blocked).toMatchObject([{ address: '127.0.0.1', attempts: 3 }]);
    hub.unblock();
    expect(hub.status().blocked).toEqual([]);
    await hub.configure({ enabled: false });
    const log = readFileSync(join(dir, 'remote.log'), 'utf8');
    expect(log).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z info Remote: listening on 127\.0\.0\.1:\d+, version 1\.2\.3$/m);
    expect(log).toContain('info Remote: your tunnel forwards https://remote.example.com here');
    expect(log).toContain('warn Remote: 127.0.0.1 waits 1 s before it may try again, after 3 refused attempts in a row');
    expect(log).toContain('info Remote: unblocked every address (Settings › Remote)');
    expect(log).toMatch(/info Remote: turned off\n$/);
  });

  it('lets in the preview\'s remote app only when asked to (development and beta builds)', async () => {
    const preview = new URL(REMOTE_PREVIEW_APP_URL).origin;
    expect(remoteAppOrigins(REMOTE_APP_URL, false)).toEqual(['https://seshboard.app', 'https://switchboard.struyfconsulting.com']);
    expect(remoteAppOrigins(REMOTE_APP_URL, true)).toEqual(['https://seshboard.app', 'https://switchboard.struyfconsulting.com', preview, 'https://switch-dev.struyfconsulting.com']);
    expect(remoteAppOrigins(REMOTE_PREVIEW_APP_URL, true)).toEqual([preview, 'https://switch-dev.struyfconsulting.com']);
    expect(remoteAppOrigins('http://localhost:5199/remote/', false)).toEqual(['http://localhost:5199']);

    const release = await setup();
    await release.on();
    await expect(open(release.port, preview)).rejects.toThrow('HTTP 403');
    await expect(open(release.port, 'https://switch-dev.struyfconsulting.com')).rejects.toThrow('HTTP 403');
    const beta = await setup({ previewApp: true });
    await beta.on();
    const socket = await open(beta.port, preview);
    socket.ws.close();
    // A phone paired on the preview's old address, until 1.3.0.
    (await open(beta.port, 'https://switch-dev.struyfconsulting.com')).ws.close();
    (await open(beta.port)).ws.close();
  });

  it('follows the update channel: Stable closes phones on the preview and refuses them, Beta lets them in again', async () => {
    const preview = new URL(REMOTE_PREVIEW_APP_URL).origin;
    const { hub, port, on } = await setup({ previewApp: true });
    await on();
    const onPreview = await open(port, preview);
    const onSite = await open(port);
    const closed = new Promise<void>((resolve) => onPreview.ws.once('close', () => resolve()));
    hub.setPreviewApp(false);
    await closed;
    expect(onSite.ws.readyState).toBe(onSite.ws.OPEN);
    await expect(open(port, preview)).rejects.toThrow('HTTP 403');
    hub.setPreviewApp(true);
    (await open(port, preview)).ws.close();
    onSite.ws.close();
  });

  it('gives a phone only what it needs, and only the sessions the sidebar lists', async () => {
    const { hub, port, on, sent, sentImages, answered, created } = await setup();
    await on();
    const { remote } = await pair(hub, port);

    const list = await remote.call('sessions.list', {});
    expect(list.sessions.map((s) => s.id)).toEqual([SESSION]);
    expect(list.sessions[0]).toMatchObject({ projectName: 'Web', projectId: projectIdOf(ROOT), profile: { id: 'work', name: 'Work', color: 'blue' } });
    expect(JSON.stringify(list)).not.toContain(ROOT);
    expect(list.prompts[0]).not.toHaveProperty('blockedPath');

    await expect(remote.call('transcript.get', { sessionId: HIDDEN })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(remote.call('session.send', { sessionId: HIDDEN, text: 'hi' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await remote.call('session.send', { sessionId: SESSION, text: 'run the tests' })).toEqual({ queued: false });
    expect(sent).toEqual(['run the tests']);
    // A phone can't link a session: a stub typed there goes as a plain code block, so it never turns into a brief.
    await remote.call('session.send', { sessionId: SESSION, text: `read @Hidden\n\n${writeStub('Hidden', HIDDEN)}` });
    expect(parseBriefs(sent.at(-1)!).briefs).toEqual([]);
    expect(sent.at(-1)).toContain(`\`\`\`text\nsession: ${HIDDEN}`);
    sent.pop();
    sentImages.pop();
    // Pasted or photographed images go with the message; too many, or one too big, are refused.
    const image = { type: 'image' as const, mediaType: 'image/jpeg' as const, data: 'aGVsbG8=', name: 'screen.jpg' };
    await remote.call('session.send', { sessionId: SESSION, text: 'look', images: [image] });
    expect(sentImages.at(-1)).toEqual([image]);
    await expect(remote.call('session.send', { sessionId: SESSION, text: 'look', images: Array(REMOTE_MAX_IMAGES + 1).fill(image) })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    await expect(remote.call('session.send', { sessionId: SESSION, text: 'look', images: [{ ...image, data: 'a'.repeat(REMOTE_IMAGE_BYTES + 1) }] })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    expect(sentImages).toHaveLength(2);
    // Files are kept on this computer and mentioned by path; together with the images they must fit one message.
    await remote.call('session.send', { sessionId: SESSION, text: 'read these', files: [{ name: 'notes.txt', data: 'aGVsbG8=' }, { name: 'notes.txt', data: 'd29ybGQ=' }] });
    const mentions = [...sent.at(-1)!.matchAll(/@"([^"]+)"|@(\S+)/g)].map((m) => m[1] ?? m[2]!);
    expect(sent.at(-1)!.startsWith('read these\n\n@')).toBe(true);
    expect(mentions.map((path) => readFileSync(path, 'utf8'))).toEqual(['hello', 'world']);
    expect(mentions[1]).toMatch(/notes \(2\)\.txt$/);
    await expect(remote.call('session.send', { sessionId: SESSION, text: 'x', files: [{ name: '../escape.txt', data: 'aGVsbG8=' }] })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    const big = 'a'.repeat(REMOTE_IMAGE_BYTES);
    await expect(remote.call('session.send', { sessionId: SESSION, text: 'x', images: [{ ...image, data: big }], files: [...Array(REMOTE_MAX_FILES - 1).fill({ name: 'big.bin', data: big }), { name: 'one.txt', data: 'aGVsbG8=' }] })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });

    await remote.call('session.respond', { requestId: 'r1', decision: { behavior: 'allow' } });
    expect(answered).toEqual(['r1']);
    await expect(remote.call('session.respond', { requestId: 'r-unknown', decision: { behavior: 'allow' } })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(await remote.call('projects.list', {})).toEqual({ projects: [{ id: projectIdOf(FIRST), name: 'Api' }, { id: projectIdOf(ROOT), name: 'Web' }] });
    await expect(remote.call('session.create', { projectId: projectIdOf(SEEN_ONLY), prompt: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await remote.call('session.create', { projectId: projectIdOf(ROOT), prompt: 'add a test' });
    expect(created).toMatchObject([{ root: ROOT, prompt: 'add a test', model: 'opus', images: [] }]);
    await remote.call('session.create', { projectId: projectIdOf(ROOT), prompt: 'match this', images: [image], files: [{ name: 'spec.pdf', data: 'aGVsbG8=' }] });
    expect(created.at(-1)).toMatchObject({ images: [image], prompt: expect.stringMatching(/^match this\n\n@\S+spec\.pdf$/) });
    await expect(remote.call('session.create', { projectId: projectIdOf('/elsewhere'), prompt: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(hub.status().connections).toMatchObject([{ name: 'Phone' }]);
    // A paired phone learns a new address from a connect link, which holds no secret.
    const link = parseRemoteLink(new URL(hub.connectLink().url).hash);
    expect(link).toMatchObject({ kind: 'connect', address: 'https://quiet-river.trycloudflare.com' });
  });

  it('says which device sent a prompt, answered or started a session, by its id', async () => {
    const { hub, port, on, fromDevice } = await setup();
    await on();
    const { remote } = await pair(hub, port);
    const deviceId = hub.status().devices[0]!.id;

    await remote.call('session.send', { sessionId: SESSION, text: 'run the tests' });
    await remote.call('session.respond', { requestId: 'r1', decision: { behavior: 'deny' } });
    await remote.call('session.create', { projectId: projectIdOf(ROOT), prompt: 'add a test' });
    expect(fromDevice).toEqual([
      { sessionId: SESSION, messageUuid: 'm1', requestId: null, device: 'Phone', deviceId, answer: null },
      { sessionId: SESSION, messageUuid: null, requestId: 'r1', device: 'Phone', deviceId, answer: { toolName: 'Bash', allowed: false } },
      { sessionId: 'new', messageUuid: null, requestId: null, device: 'Phone', deviceId, answer: null },
    ]);
  });

  it('starts and queues sessions with what the phone chose, and the project\'s defaults for the rest', async () => {
    const { hub, port, on, created, queued } = await setup();
    await on();
    const { remote } = await pair(hub, port);
    await remote.call('session.create', { projectId: projectIdOf(ROOT), prompt: 'a', effort: 'high', permissionMode: 'plan', worktree: true });
    expect(created[0]!.choice).toEqual({ profileId: 'default', model: 'opus', effort: 'high', permissionMode: 'plan', worktree: true, baseRef: 'fresh', checkoutBranch: null });
    // Auto goes through as it is: the engine routes it, or starts on the default model with Auto off.
    await remote.call('session.create', { projectId: projectIdOf(ROOT), prompt: 'auto', model: 'auto' });
    expect(created.at(-1)!.model).toBe('auto');
    created.pop();
    await remote.call('session.create', { projectId: projectIdOf(ROOT), prompt: 'b', model: null });
    expect(created[1]!.choice).toEqual({ profileId: 'default', model: null, effort: null, permissionMode: 'default', worktree: false, baseRef: 'fresh', checkoutBranch: null });
    await expect(remote.call('session.create', { projectId: projectIdOf(ROOT), prompt: 'c', permissionMode: 'bypassPermissions' as never })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    // Another profile for this session brings its defaults, under the project's own.
    await remote.call('session.create', { projectId: projectIdOf(ROOT), prompt: 'd', profileId: 'work' });
    expect(created[2]!.choice).toEqual({ profileId: 'work', model: 'opus', effort: 'high', permissionMode: 'default', worktree: true, baseRef: 'fresh', checkoutBranch: null });
    await expect(remote.call('session.create', { projectId: projectIdOf(ROOT), prompt: 'e', profileId: 'gone' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // A project linked to a profile runs with it, and its defaults.
    expect(await remote.call('later.add', { projectId: projectIdOf(FIRST), prompt: 'later', permissionMode: 'acceptEdits' })).toEqual({ id: 'later-1' });
    expect(queued).toEqual([{ root: FIRST, prompt: 'later', choice: { profileId: 'work', model: 'sonnet', effort: 'high', permissionMode: 'acceptEdits', worktree: true, baseRef: 'fresh', checkoutBranch: null } }]);
    await expect(remote.call('later.add', { projectId: projectIdOf(SEEN_ONLY), prompt: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // A branch to check out first: only one of the folder's own, free, and not with a worktree.
    expect(await remote.call('projects.branches', { projectId: projectIdOf(ROOT) })).toEqual({ current: 'main', branches: ['main', 'feat/login', 'taken'], checkedOutElsewhere: ['taken'] });
    await expect(remote.call('projects.branches', { projectId: projectIdOf(SEEN_ONLY) })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await remote.call('session.create', { projectId: projectIdOf(ROOT), prompt: 'f', worktree: false, checkoutBranch: 'feat/login' });
    expect(created.at(-1)!.choice).toMatchObject({ worktree: false, checkoutBranch: 'feat/login' });
    await expect(remote.call('session.create', { projectId: projectIdOf(ROOT), prompt: 'g', worktree: false, checkoutBranch: 'origin/main' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(remote.call('session.create', { projectId: projectIdOf(ROOT), prompt: 'h', worktree: false, checkoutBranch: 'taken' })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    await expect(remote.call('session.create', { projectId: projectIdOf(ROOT), prompt: 'i', worktree: true, checkoutBranch: 'feat/login' })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    expect(await remote.call('later.add', { projectId: projectIdOf(ROOT), prompt: 'j', worktree: false, checkoutBranch: 'feat/login' })).toEqual({ id: 'later-1' });
    expect(queued.at(-1)!.choice.checkoutBranch).toBe('feat/login');

    const options = await remote.call('options.get', {});
    expect(options.models).toEqual([{ value: 'opus', displayName: 'Opus', description: 'Most capable', supportsEffort: true }]);
    expect(options.modes).toEqual(['default', 'acceptEdits', 'plan', 'auto']);
    expect(options.efforts).toContain('medium');
    expect(options.auto).toEqual({ enabled: true, allowed: ['sonnet', 'opus'] });
    expect(options.projects.find((p) => p.id === projectIdOf(ROOT))).toEqual({ id: projectIdOf(ROOT), profileId: null, defaults: { model: 'opus', effort: null, permissionMode: null, worktree: null } });
    expect(options.projects.find((p) => p.id === projectIdOf(FIRST))?.profileId).toBe('work');
    expect(options.profiles).toEqual([
      // A profile without a mode starts in the global one.
      { id: 'default', name: 'Personal', color: 'yellow', defaults: { model: null, effort: null, permissionMode: 'default', worktree: null } },
      { id: 'work', name: 'Work', color: 'blue', defaults: { model: 'sonnet', effort: 'high', permissionMode: 'default', worktree: true } },
    ]);
    expect(options.defaultProfileId).toBe('default');
    expect(JSON.stringify(options)).not.toContain(ROOT);
  });

  it('clones on the computer for a phone, with job ids of its own and the project by its id', async () => {
    const { hub, port, on, calls } = await setup();
    await hub.start();
    await on();
    const { remote } = await pair(hub, port);
    // Clone from GitHub on the computer: the job is the device's own, and the project comes back as its id.
    const heard: unknown[] = [];
    remote.on('projects.cloneProgress', (event) => heard.push(event));
    expect(await remote.call('projects.clonePlan', { url: 'https://github.com/o/n' })).toMatchObject({ state: 'free', where: '~/Developer/n' });
    expect(await remote.call('projects.clone', { jobId: 'j1', url: 'https://github.com/o/n', name: 'n' })).toEqual({});
    await until(() => heard.length === 2);
    expect(heard).toEqual([
      expect.objectContaining({ jobId: 'j1', state: 'running', percent: 40, projectId: null }),
      expect.objectContaining({ jobId: 'j1', state: 'done', projectId: projectIdOf(ROOT) }),
    ]);
    expect(heard[1]).not.toHaveProperty('root');
    await remote.call('projects.cancelClone', { jobId: 'j1' });
    expect(calls.filter((c) => c.startsWith('clone') || c.startsWith('cancel'))).toEqual([expect.stringMatching(/^clone remote:[^:]+:j1 https:\/\/github.com\/o\/n n$/), expect.stringMatching(/^cancel remote:[^:]+:j1$/)]);
  });

  it('marks read, archives, and changes the model, effort and mode only of sessions in the list', async () => {
    const { hub, port, on, calls } = await setup();
    await on();
    const { remote } = await pair(hub, port);
    await remote.call('session.markRead', { sessionId: SESSION });
    await remote.call('session.markUnread', { sessionId: SESSION });
    await remote.call('session.setFlags', { sessionId: SESSION, archived: true });
    await remote.call('session.setModel', { sessionId: SESSION, model: 'sonnet' });
    await remote.call('session.setEffort', { sessionId: SESSION, effort: 'high' });
    await remote.call('session.setEffort', { sessionId: SESSION, effort: null });
    await remote.call('session.setPermissionMode', { sessionId: SESSION, mode: 'auto' });
    expect(calls).toEqual([`read ${SESSION}`, `unread ${SESSION}`, `flags ${SESSION} {"archived":true}`, `model ${SESSION} sonnet`, `effort ${SESSION} high`, `effort ${SESSION} null`, `mode ${SESSION} auto`]);
    // One at a time: a call made before the loop reaches it could be refused before anything handles its rejection.
    for (const call of [
      () => remote.call('session.markRead', { sessionId: HIDDEN }),
      () => remote.call('session.markUnread', { sessionId: HIDDEN }),
      () => remote.call('session.setFlags', { sessionId: HIDDEN, pinned: true }),
      () => remote.call('session.setModel', { sessionId: HIDDEN, model: null }),
      () => remote.call('session.setEffort', { sessionId: HIDDEN, effort: 'low' }),
      () => remote.call('catchup.get', { sessionId: HIDDEN }),
      () => remote.call('changes.get', { sessionId: HIDDEN }),
    ])
      await expect(call()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(remote.call('session.setPermissionMode', { sessionId: SESSION, mode: 'dontAsk' as never })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('lets a phone take back an archive it made (Undo), but not unarchive anything else', async () => {
    const archived = new Set<string>();
    const { hub, port, on, calls } = await setup({ archived });
    await on();
    const { remote } = await pair(hub, port);
    await remote.call('session.setFlags', { sessionId: SESSION, archived: true });
    archived.add(SESSION);
    expect((await remote.call('sessions.list', {})).sessions.map((s) => s.id)).not.toContain(SESSION);
    // Gone from the list: nothing but Undo may touch it.
    await expect(remote.call('session.markRead', { sessionId: SESSION })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(remote.call('session.setFlags', { sessionId: SESSION, archived: false, pinned: true })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // Only the phone that archived it: another paired phone may not bring it back.
    const other = await pair(hub, port);
    await expect(other.remote.call('session.setFlags', { sessionId: SESSION, archived: false })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await remote.call('session.setFlags', { sessionId: SESSION, archived: false });
    expect(calls.at(-1)).toBe(`flags ${SESSION} {"archived":false}`);
    // Once only.
    await expect(remote.call('session.setFlags', { sessionId: SESSION, archived: false })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // A session the phone never archived stays out of reach.
    archived.add(HIDDEN);
    await expect(remote.call('session.setFlags', { sessionId: HIDDEN, archived: false })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('stops following a session once it leaves the list, so nothing more of it reaches the phone', async () => {
    const archived = new Set<string>();
    const { hub, port, on, watching } = await setup({ archived });
    await on();
    const { remote } = await pair(hub, port);
    await remote.call('transcript.watch', { sessionId: SESSION });
    expect(watching.has(SESSION)).toBe(true);
    archived.add(SESSION);
    hub.sessionsChanged();
    await until(() => !watching.has(SESSION));
  });

  it('lists what a session runs in the background, and stops only a task it lists', async () => {
    const task = { taskId: 'b1', type: 'local_bash', description: 'gh run watch', startedAt: 5 };
    const host = { sessionId: SESSION, cwd: ROOT, state: 'idle', model: 'opus', effort: null, permissionMode: 'default', profileId: 'work', backgroundTasks: [task] } as unknown as SessionHostInfo;
    const { hub, port, on, calls } = await setup({ hosts: [host] });
    await on();
    const { remote } = await pair(hub, port);
    const { sessions } = await remote.call('sessions.list', {});
    expect(sessions.find((s) => s.id === SESSION)).toMatchObject({ status: 'background', background: [task] });
    await remote.call('session.stopTask', { sessionId: SESSION, taskId: 'b1' });
    expect(calls).toEqual([`stop ${SESSION} b1`]);
    await expect(remote.call('session.stopTask', { sessionId: SESSION, taskId: 'gone' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(remote.call('session.stopTask', { sessionId: HIDDEN, taskId: 'b1' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('gives the catch-up without paths outside the project', async () => {
    const { hub, port, on } = await setup();
    await on();
    const { remote } = await pair(hub, port);
    const { catchUp } = await remote.call('catchup.get', { sessionId: SESSION });
    expect(catchUp?.signals.outOfScope).toEqual(['src/x.ts']);
    expect(catchUp?.need.title).toBe('Commit the changes');
  });

  it('gives every profile\'s plan usage, the default first, and tells phones when it changes', async () => {
    const { hub, port, on, calls } = await setup();
    await on();
    const { remote } = await pair(hub, port);
    const { profiles } = await remote.call('usage.get', { refresh: true });
    expect(profiles.map((p) => [p.profile, p.usage?.limits[0]?.percent ?? null, p.error, p.account])).toEqual([
      [{ id: 'default', name: 'Personal', color: 'yellow' }, 44, null, 'a'.repeat(64)],
      [{ id: 'work', name: 'Work', color: 'blue' }, null, 'Not logged in', null],
    ]);
    expect(calls).toEqual(['usage default refresh', 'usage work refresh']);
    const heard: string[] = [];
    remote.on('usage.changed', (event) => heard.push(event.profileId));
    hub.usageChanged('gone', null);
    hub.usageChanged('work', null);
    await until(() => heard.length > 0);
    expect(heard).toEqual(['work']);
  });

  it('tells phones the app icon colourway in hello and when it changes', async () => {
    const { hub, port, on } = await setup();
    hub.setAppIcon('signal');
    await on();
    const { remote } = await pair(hub, port);
    expect((await remote.call('hello', { client: { version: '1' } })).appIcon).toBe('signal');
    const heard: string[] = [];
    remote.on('app.icon', (event) => heard.push(event.key));
    hub.setAppIcon('signal');
    hub.setAppIcon('graphite');
    await until(() => heard.length > 0);
    expect(heard).toEqual(['graphite']);
  });

  it('gives the app\'s theme, kept across restarts, and tells phones only when it changes', async () => {
    const { hub, port, on, appState } = await setup();
    await on();
    const { remote } = await pair(hub, port);
    expect(await remote.call('theme.get', {})).toEqual({ theme: null });
    const heard: string[] = [];
    remote.on('theme.changed', (theme) => heard.push(theme.name));
    const github = { name: 'GitHub', light: { bg: '#ffffff', accent: '#0969da' }, dark: { bg: '#0d1117', accent: '#58a6ff' } };
    hub.setTheme(github);
    hub.setTheme(structuredClone(github));
    hub.setTheme({ ...github, name: 'Nord' });
    await until(() => heard.length === 2);
    expect(heard).toEqual(['GitHub', 'Nord']);
    expect(await remote.call('theme.get', {})).toEqual({ theme: { ...github, name: 'Nord' } });
    expect(appState.get('remote.theme')).toEqual({ ...github, name: 'Nord' });
  });

  it('answers token usage for the profile signed in to an account, with projects by id and name and never their folder', async () => {
    const { hub, port, on, calls } = await setup();
    await on();
    const { remote } = await pair(hub, port);
    const { breakdown } = await remote.call('usage.tokens', { account: ACCOUNT, period: 'week', groupBy: 'project' });
    expect(breakdown?.rows.map((r) => [r.key, r.projectId, r.projectName])).toEqual([
      [projectIdOf(ROOT), projectIdOf(ROOT), 'Web'],
      [projectIdOf('/elsewhere/tools'), projectIdOf('/elsewhere/tools'), 'tools'],
      ['', null, null],
    ]);
    expect(JSON.stringify(breakdown)).not.toContain('/work');
    expect(JSON.stringify(breakdown)).not.toContain('/elsewhere');
    expect(await remote.call('usage.tokens', { account: 'cd'.repeat(32), period: 'day' })).toEqual({ breakdown: null });
    await expect(remote.call('usage.tokens', { account: 'elio@example.com', period: 'day' } as never)).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    expect(calls).toEqual(['tokens abab week project', 'tokens cdcd day session']);
  });

  it('answers the cost of a session in the list, and of the plan windows an account asks for', async () => {
    const { hub, port, on, calls } = await setup();
    await on();
    const { remote } = await pair(hub, port);
    expect(await remote.call('usage.sessionCost', { sessionId: SESSION })).toEqual({ cost: { usd: 4.2, partial: false } });
    // A session the list doesn't show has no cost to tell either.
    await expect(remote.call('usage.sessionCost', { sessionId: HIDDEN })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const windows = [{ kind: 'session', scope: null, from: 1 }, { kind: 'weekly_scoped', scope: 'Opus', from: 2 }];
    expect(await remote.call('usage.windowCosts', { account: ACCOUNT, windows })).toEqual({ windows: windows.map((w) => ({ ...w, usd: 1.5, partial: false })) });
    expect(await remote.call('usage.windowCosts', { account: 'cd'.repeat(32), windows })).toEqual({ windows: null });
    expect(calls).toEqual(['sessionCost ' + SESSION, 'windowCosts abab session,weekly_scoped', 'windowCosts cdcd session,weekly_scoped']);
  });

  it('asks about a session in the list, and sends the answer to the phone that asked and to phones watching it', async () => {
    const { hub, port, on, calls } = await setup();
    await on();
    const { remote } = await pair(hub, port);
    expect((await remote.call('session.askThreads', { sessionId: SESSION })).threads[0]?.items[0]?.answer).toBe('Because.');
    await expect(remote.call('session.ask', { sessionId: HIDDEN, question: 'Why?' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const asked = await remote.call('session.ask', { sessionId: SESSION, question: 'What changed?', threadId: 't1' });
    expect(calls).toEqual(['ask ' + SESSION + ' What changed? t1']);
    const heard: string[] = [];
    remote.on('session.ask', (event) => heard.push(`${event.id}:${event.delta ?? (event.done ? 'done' : '')}`));
    // Not watching the session: only its own question's answer comes, until it ends.
    hub.askEvent({ sessionId: SESSION, threadId: 't1', id: asked.id, delta: 'Two files.' });
    hub.askEvent({ sessionId: SESSION, threadId: 't1', id: 'other', delta: 'Not for you.' });
    hub.askEvent({ sessionId: SESSION, threadId: 't1', id: asked.id, done: true, answer: 'Two files.' });
    hub.askEvent({ sessionId: SESSION, threadId: 't1', id: asked.id, delta: 'Late.' });
    // Watching it: every answer in it.
    await remote.call('transcript.watch', { sessionId: SESSION });
    hub.askEvent({ sessionId: SESSION, threadId: 't2', id: 'from-the-computer', delta: 'Hi.' });
    await until(() => heard.length >= 3);
    expect(heard).toEqual([`${asked.id}:Two files.`, `${asked.id}:done`, 'from-the-computer:Hi.']);
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

  it('sends a phone the Up next of the session it starts watching, and again after it removes one', async () => {
    const { hub, port, on, calls } = await setup();
    await on();
    const { remote } = await pair(hub, port);
    const heard: string[] = [];
    remote.on('upNext.changed', (event) => heard.push(`${event.sessionId}:${event.queue.map((m) => m.text).join()}`));
    // What changed while the phone was away is in the list it gets when it watches again.
    await remote.call('transcript.watch', { sessionId: SESSION });
    await until(() => heard.length >= 1);
    // A message sent meanwhile changes nothing when removed, and the phone still gets the list as it is.
    await remote.call('session.queue.remove', { sessionId: SESSION, id: 'gone' });
    await until(() => heard.length >= 2);
    expect(heard).toEqual([`${SESSION}:Then the tests`, `${SESSION}:Then the tests`]);
    expect(calls).toContain(`dequeue ${SESSION} gone`);
  });

  it('sends a message from Up next now, only for a session in the list', async () => {
    const { hub, port, on, calls } = await setup();
    await on();
    const { remote } = await pair(hub, port);
    await remote.call('session.queue.sendNow', { sessionId: SESSION, id: 'q1' });
    expect(calls).toContain(`send now ${SESSION} q1`);
    await expect(remote.call('session.queue.sendNow', { sessionId: HIDDEN, id: 'q1' })).rejects.toBeDefined();
    expect(calls).not.toContain(`send now ${HIDDEN} q1`);
  });

  it('gives a phone how a session stands with its usage limit, and lets it resume or arm only a session in the list', async () => {
    const { hub, port, on, calls, limitOf } = await setup();
    await on();
    const { remote } = await pair(hub, port);
    expect(await remote.call('limits.get', { sessionId: SESSION })).toEqual({ limit: null });
    const standing: RemoteLimitStanding = { stopped: true, kind: 'five_hour', resetsAt: 5000, resumeAt: null, gaveUp: false };
    limitOf[SESSION] = standing;
    expect(await remote.call('limits.get', { sessionId: SESSION })).toEqual({ limit: standing });
    await remote.call('limits.resume', { sessionId: SESSION });
    await remote.call('limits.arm', { sessionId: SESSION, armed: true });
    expect(calls).toEqual(expect.arrayContaining([`resume ${SESSION}`, `arm ${SESSION} true`]));
    await expect(remote.call('limits.resume', { sessionId: HIDDEN })).rejects.toBeDefined();
    await expect(remote.call('limits.arm', { sessionId: HIDDEN, armed: true })).rejects.toBeDefined();
    expect(calls).not.toContain(`resume ${HIDDEN}`);
  });

  it('tells a phone watching a session how its limit stands: when it starts watching and on each change', async () => {
    const { hub, port, on, limitOf } = await setup();
    await on();
    const { remote } = await pair(hub, port);
    const heard: Array<string | null> = [];
    remote.on('limits.changed', (event) => heard.push(`${event.sessionId}:${event.limit?.resetsAt ?? null}`));
    await remote.call('transcript.watch', { sessionId: SESSION });
    limitOf[SESSION] = { stopped: true, kind: null, resetsAt: 7000, resumeAt: null, gaveUp: false };
    hub.limitsChanged();
    await until(() => heard.length >= 2);
    expect(heard).toEqual([`${SESSION}:null`, `${SESSION}:7000`]);
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

  it('shows a phone the runs of its sessions and its run rows, and presses only their buttons', async () => {
    const { hub, port, on, calls, sent, fromDevice } = await setup({ runs: [runOf('run-1', SESSION), runOf('run-hidden', HIDDEN), runOf('run-row', null)] });
    await on();
    const { remote } = await pair(hub, port);
    const list = await remote.call('sessions.list', {});
    expect(list.runs?.map((r) => r.run.id).sort()).toEqual(['run-1', 'run-row']);
    expect(list.runs?.[0]?.run).toMatchObject({ projectId: projectIdOf(ROOT), projectName: 'Web', worktree: true });
    expect(JSON.stringify(list.runs)).not.toContain(ROOT);
    expect(JSON.stringify(list.runs)).not.toContain('The plan');

    await expect(remote.call('runs.stop', { runId: 'run-hidden' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await remote.call('runs.stop', { runId: 'run-1' })).state.run).not.toHaveProperty('cwd');
    await remote.call('runs.skipStep', { runId: 'run-1' });
    await remote.call('runs.continue', { runId: 'run-row', message: 'Add the toggle' });
    expect(calls).toEqual(expect.arrayContaining(['stop run-1', 'skipStep run-1', 'continue run-row Add the toggle']));
    expect((await remote.call('runs.pushPreview', { runId: 'run-row' })).preview).toMatchObject({ files: 2, base: 'main' });

    // Writing in a run row starts its session; a run's stub typed on the phone goes as plain text.
    expect(await remote.call('runs.write', { runId: 'run-row', text: `Go on\n\n${writeRunStub('Other', 'run-hidden')}` })).toEqual({ sessionId: 'adopted' });
    expect(calls.find((c) => c.startsWith('write run-row'))).toContain('```text\nrun: run-hidden');
    expect(fromDevice.at(-1)).toMatchObject({ sessionId: 'adopted' });
    await expect(remote.call('runs.write', { runId: 'run-1', text: 'Hi' })).rejects.toMatchObject({ code: 'INVALID' });

    // A message to the run's parent links its run, as the computer's message box does, and only that run.
    await remote.call('session.send', { sessionId: SESSION, text: `What did the review find?\n\n${writeRunStub('Other', 'run-hidden')}` });
    expect(parseRunBriefs(sent.at(-1)!).runs.map((r) => r.runId)).toEqual(['run-1']);
  });

  it('archives a run, and lets the phone take back only an archive it made', async () => {
    const { hub, port, on, calls } = await setup({ runs: [runOf('run-row', null)] });
    await on();
    const { remote } = await pair(hub, port);
    await expect(remote.call('runs.archive', { runId: 'run-gone', archived: false })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await remote.call('runs.archive', { runId: 'run-row', archived: true });
    await remote.call('runs.archive', { runId: 'run-row', archived: false });
    expect(calls).toEqual(expect.arrayContaining(['archive run-row true', 'archive run-row false']));
  });

  it('runs a pipeline from a session in the list, or with a task in a project you added', async () => {
    const { hub, port, on, ran } = await setup({ runs: [] });
    await on();
    const { remote } = await pair(hub, port);
    const { pipelines } = await remote.call('pipelines.list', { projectId: projectIdOf(ROOT) });
    expect(pipelines.map((p) => p.id)).toEqual([PIPELINE.id]);
    expect(pipelines[0]).not.toHaveProperty('scope');

    const fromSession = await remote.call('pipelines.run', { pipelineId: PIPELINE.id, parentSessionId: SESSION });
    expect(fromSession.state.run).not.toHaveProperty('projectRoot');
    expect(ran[0]).toMatchObject({ pipelineId: PIPELINE.id, parentSessionId: SESSION, task: null, projectRoot: null, choices: null });
    await expect(remote.call('pipelines.run', { pipelineId: PIPELINE.id, parentSessionId: HIDDEN })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(remote.call('pipelines.run', { pipelineId: 'not-offered', parentSessionId: SESSION })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // From a session, or with a project and a task: never both, never neither.
    await expect(remote.call('pipelines.run', { pipelineId: PIPELINE.id, parentSessionId: SESSION, projectId: projectIdOf(ROOT), task: 'x' })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    await expect(remote.call('pipelines.run', { pipelineId: PIPELINE.id, projectId: projectIdOf(ROOT) })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });

    await remote.call('pipelines.run', { pipelineId: PIPELINE.id, projectId: projectIdOf(ROOT), task: `Add a toggle\n\n${writeStub('Hidden', HIDDEN)}`, model: 'opus', profileId: 'work' });
    expect(ran[1]).toMatchObject({ parentSessionId: null, projectRoot: ROOT, profileId: 'work', choices: { model: 'opus', effort: null, permissionMode: null } });
    expect(parseBriefs(ran[1]!.task!).briefs).toEqual([]);
    // Only a project you added, as New session.
    await expect(remote.call('pipelines.run', { pipelineId: PIPELINE.id, projectId: projectIdOf(SEEN_ONLY), task: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // A mode that doesn't ask is only for the computer.
    await expect(remote.call('pipelines.run', { pipelineId: PIPELINE.id, projectId: projectIdOf(ROOT), task: 'x', permissionMode: 'bypassPermissions' as 'default' })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('pushes what a run says, and no Finished push for a step of a run that goes on', async () => {
    const step = runOf('run-1', null);
    step.run.status = 'running';
    step.steps = [{ ...step.steps[0]!, sessionId: SESSION, status: 'working', endedAt: null }];
    const { hub, port, on, pushes, pushBodies } = await setup({ runs: [step] });
    await on();
    const { remote } = await pair(hub, port);
    await remote.call('push.subscribe', { subscription: PUSH, needsYou: true, finished: true });

    hub.hostChanged({ sessionId: SESSION, state: 'running' } as SessionHostInfo);
    hub.hostChanged({ sessionId: SESSION, state: 'idle' } as SessionHostInfo);
    await new Promise((r) => setTimeout(r, 60));
    expect(pushes).toHaveLength(0);

    hub.runNotice({ kind: 'needsYou', runId: 'run-1', sessionId: null, title: 'Add a toggle', body: 'Push waits for you.' });
    await until(() => pushes.length === 1);
    expect(readPush(pushBodies[0]!.body)).toMatchObject({ kind: 'needs-you', sessionId: 'run-1', title: 'Add a toggle', project: 'Web', line: 'Push waits for you.' });
    hub.runNotice({ kind: 'stopped', runId: 'run-1', sessionId: SESSION, title: 'Add a toggle', body: 'Validate has no verdict.' });
    await until(() => pushes.length === 2);
    expect(readPush(pushBodies[1]!.body)).toMatchObject({ kind: 'finished', sessionId: SESSION, title: 'Add a toggle: the run stopped' });
    // A run it can't see says nothing.
    hub.runNotice({ kind: 'done', runId: 'run-gone', sessionId: null, title: 'x', body: 'y' });
    await new Promise((r) => setTimeout(r, 30));
    expect(pushes).toHaveLength(2);
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

  it('signs with the device\'s own VAPID key when it gives one, and says which device and computer a push is for', async () => {
    const { hub, port, on, pushes, pushBodies, permissions } = await setup();
    await on();
    const { remote } = await pair(hub, port);
    const mine = generateVapidKeys();
    // A private key that isn't the public key's is refused.
    await expect(remote.call('push.subscribe', { subscription: PUSH, needsYou: true, finished: true, vapid: { publicKey: generateVapidKeys().publicKey, privateKey: mine.privateKey } })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    await remote.call('push.subscribe', { subscription: PUSH, needsYou: true, finished: true, vapid: mine, label: 'mystic' });

    hub.permissionAsked(permissions[0]!);
    await until(() => pushes.length === 1);
    expect(pushBodies[0]!.authorization.endsWith(`k=${mine.publicKey}`)).toBe(true);
    const device = hub.status().devices[0]!.id;
    expect(readPush(pushBodies[0]!.body)).toMatchObject({ kind: 'needs-you', sessionId: SESSION, deviceId: device, computer: 'mystic' });

    // Without a key of its own, the engine's, and no label.
    await remote.call('push.subscribe', { subscription: PUSH, needsYou: true, finished: true });
    hub.permissionAsked(permissions[0]!);
    await until(() => pushes.length === 2);
    expect(pushBodies[1]!.authorization.endsWith(`k=${(await remote.call('push.key', {})).publicKey}`)).toBe(true);
    const plain = readPush(pushBodies[1]!.body);
    expect(plain.deviceId).toBe(device);
    expect(plain).not.toHaveProperty('computer');
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

  it('turns off at once while the tunnel is still starting', async () => {
    const { hub, on } = await setup({ tunnel: () => fakeTunnel('setInterval(() => {}, 1000)') });
    const starting = on();
    await until(() => hub.status().tunnel.state === 'starting');
    const started = Date.now();
    await hub.configure({ enabled: false });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(hub.status()).toMatchObject({ settings: { enabled: false }, address: null, tunnel: { state: 'off' }, problem: null });
    await starting;
    expect(hub.status().tunnel.state).toBe('off');
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
    const { problem } = hub.status();
    expect(problem).toMatchObject({ kind: 'port-in-use', port });
    // The next port that was free, for Use port …
    const suggested = (problem as { suggestedPort: number | null }).suggestedPort;
    expect(suggested).toBeGreaterThan(port);
    await hub.configure({ port: suggested! });
    expect(hub.status().problem).toBeNull();
  });

  it('renames a paired device, and says when it is gone', async () => {
    const { hub, port, on } = await setup();
    await on();
    await pair(hub, port);
    const device = hub.status().devices[0]!;
    // The test's socket sends no user agent: a computer's browser, as far as the server can tell.
    expect(device.kind).toBe('browser');
    hub.rename(device.id, "Elio's iPhone");
    expect(hub.status().devices[0]!.name).toBe("Elio's iPhone");
    hub.revoke(device.id);
    expect(() => hub.rename(device.id, 'Again')).toThrow(/no longer paired/);
  });

  it('says when a quick tunnel came back at an address no paired device has used yet', async () => {
    let runs = 0;
    const { hub, port, on } = await setup({ tunnel: () => fakeTunnel(`console.error('https://run-${++runs}.trycloudflare.com'); setInterval(() => {}, 1000)`) });
    await on();
    // Nobody paired yet: nothing to reconnect.
    expect(hub.status()).toMatchObject({ address: 'https://run-1.trycloudflare.com', addressChanged: false });
    const { url } = hub.startPairing();
    const link = parseRemoteLink(new URL(url).hash);
    if (link?.kind !== 'pair') throw new Error('Not a pairing link');
    const phone = generateKeyPair();
    const pairing = await handshake(port, 'pair', phone, link.enginePublicKey, pskFromSecret(link.secret));
    const asked = client<RemotePairContract>(pairing.frames, pairing.session!).call('pair.request', { name: 'Phone' });
    await until(() => hub.status().pairing.request !== null);
    hub.decidePairing(hub.status().pairing.request!.id, true);
    await asked;
    pairing.ws.close();
    const connect = async () => {
      const connected = await handshake(port, 'connect', phone, link.enginePublicKey);
      await client<RemoteContract>(connected.frames, connected.session!).call('hello', { client: { version: '1' } });
      return connected;
    };
    (await connect()).ws.close();
    expect(hub.status().addressChanged).toBe(false);

    // The tunnel restarts with a new address: the phone still knows the old one.
    await hub.configure({});
    expect(hub.status()).toMatchObject({ address: 'https://run-2.trycloudflare.com', addressChanged: true });
    // It connected through the new one (Reconnect a paired device): nothing to say any more.
    (await connect()).ws.close();
    await until(() => !hub.status().addressChanged);

    // An address that never changes: never.
    await hub.configure({ tunnel: 'custom', customUrl: 'https://remote.example.com' });
    expect(hub.status().addressChanged).toBe(false);
  });
});

describe('what a phone sees', () => {
  it('shows what Auto picked until you change the model, and that it is still choosing', () => {
    const pick = { model: 'sonnet' as const, reason: 'A small change', at: 1, tokens: 10, allowed: ['haiku' as const, 'sonnet' as const] };
    expect(autoOf({ autoChoosing: true, autoPick: null })).toEqual({ picked: null, choosing: true });
    expect(autoOf({ autoPick: pick })).toEqual({ picked: 'sonnet', choosing: false });
    expect(autoOf({ autoPick: { ...pick, model: null } })).toEqual({ picked: null, choosing: false });
    expect(autoOf({ autoPick: { ...pick, left: true } })).toBeNull();
    expect(autoOf({})).toBeNull();
    expect(autoOf(undefined)).toBeNull();
  });

  it('cuts a long diff to its first lines', () => {
    expect(capDiff({ diff: 'a\nb\nc', truncated: false }, 2)).toEqual({ diff: 'a\nb', truncated: true });
    expect(capDiff({ diff: 'a\nb', truncated: false }, 2)).toEqual({ diff: 'a\nb', truncated: false });
  });

  it('leaves out a catch-up\'s paths outside the checkout', () => {
    const card = { signals: { outOfScope: ['src/a.ts', '/etc/x', 'C:\\Users\\x', '..\\up', '../up', '\\\\server\\share'], scope: '/abs' } } as unknown as CatchUp;
    expect(remoteCatchUp(card)?.signals).toMatchObject({ outOfScope: ['src/a.ts'], scope: null });
    expect(remoteCatchUp(null)).toBeNull();
  });

  it('says when a session\'s turn began, from Claude Code\'s registry', () => {
    const base = { archiveAfterDays: 7, scope: 'switchboard' as const, projectNames: new Map<string, string>() };
    const live = { sessionId: SESSION, pid: 1, cwd: ROOT, projectRoot: ROOT, status: 'busy', rawStatus: 'busy', name: null, origin: 'app', startedAt: 100, updatedAt: 200, profileId: 'work' } as unknown as LiveSession;
    expect(remoteSessions({ summaries: [summary(SESSION, true)], live: [live], hosts: [] }, base).sessions[0]!.workingSince).toBe(200);
    expect(remoteSessions({ summaries: [summary(SESSION, true)], live: [{ ...live, updatedAt: null }], hosts: [] }, base).sessions[0]!.workingSince).toBe(100);
    expect(remoteSessions({ summaries: [summary(SESSION, true)], live: [], hosts: [] }, base).sessions[0]!.workingSince).toBeNull();
  });

  it('names a session\'s profile only with more than one', () => {
    const sources = { summaries: [summary(SESSION, true)], live: [], hosts: [] };
    const base = { archiveAfterDays: 7, scope: 'switchboard' as const, projectNames: new Map<string, string>() };
    const work = { id: 'work', name: 'Work', color: 'blue' as const };
    expect(remoteSessions(sources, { ...base, profiles: [work] }).sessions[0]!.profile).toBeNull();
    expect(remoteSessions(sources, { ...base, profiles: [{ id: 'default', name: 'Personal', color: 'yellow' }, work] }).sessions[0]!.profile).toEqual(work);
    // What it sends, the remote app's own check (without zod) reads in full.
    const sent = JSON.parse(JSON.stringify(remoteSessions(sources, { ...base, profiles: [{ id: 'default', name: 'Personal', color: 'yellow' }, work] }))) as unknown;
    expect(checkRemoteSessions(sent)).toMatchObject({ dropped: 0, list: { sessions: [{ id: SESSION }] } });
  });

  it('takes the project\'s defaults, then the profile\'s, for what the phone leaves out', () => {
    const defaults = { model: 'opus', effort: 'low' as const, permissionMode: 'acceptEdits' as const, workspace: 'worktree' as const, baseRef: 'head' as const, branch: null, defaultBranch: null };
    const none = { id: 'default', defaults: { model: null, effort: null, permissionMode: null, workspace: null, baseRef: null } };
    expect(sessionChoice({}, defaults, none)).toEqual({ profileId: 'default', model: 'opus', effort: 'low', permissionMode: 'acceptEdits', worktree: true, baseRef: 'head', checkoutBranch: null });
    expect(sessionChoice({ model: null, effort: null, permissionMode: 'plan', worktree: false }, defaults, none)).toEqual({ profileId: 'default', model: null, effort: null, permissionMode: 'plan', worktree: false, baseRef: 'head', checkoutBranch: null });
    const work = { id: 'work', defaults: { model: 'sonnet', effort: 'high' as const, permissionMode: 'plan' as const, workspace: 'current' as const, baseRef: 'fresh' as const } };
    expect(sessionChoice({}, NO_DEFAULTS, work)).toEqual({ profileId: 'work', model: 'sonnet', effort: 'high', permissionMode: 'plan', worktree: false, baseRef: 'fresh', checkoutBranch: null });
    expect(sessionChoice({}, defaults, work)).toEqual({ profileId: 'work', model: 'opus', effort: 'low', permissionMode: 'acceptEdits', worktree: true, baseRef: 'head', checkoutBranch: null });
    // The global mode where neither sets one, or where the project skips its profile's.
    expect(sessionChoice({}, NO_DEFAULTS, none, 'auto').permissionMode).toBe('auto');
    expect(sessionChoice({}, NO_DEFAULTS, work, 'auto').permissionMode).toBe('plan');
    expect(sessionChoice({}, { ...NO_DEFAULTS, globalPermissionMode: true }, work, 'auto').permissionMode).toBe('auto');
    // The global model and effort where neither sets one; what the phone picks still wins, Default model included.
    const globals = { model: 'haiku', effort: 'max' as const };
    expect(sessionChoice({}, NO_DEFAULTS, none, 'default', globals)).toMatchObject({ model: 'haiku', effort: 'max' });
    expect(sessionChoice({}, NO_DEFAULTS, work, 'default', globals)).toMatchObject({ model: 'sonnet', effort: 'high' });
    expect(sessionChoice({ model: null, effort: null }, NO_DEFAULTS, none, 'default', globals)).toMatchObject({ model: null, effort: null });
  });

  it("shows a phone the global model and effort under a profile, and leaves a project's unset ones to its profile", () => {
    const globals = { model: 'haiku', effort: 'max' as const };
    const unset = { model: null, effort: null, permissionMode: null, workspace: null };
    expect(remoteDefaults(unset, 'default', globals)).toMatchObject({ model: 'haiku', effort: 'max' });
    expect(remoteDefaults({ ...unset, model: 'opus' }, 'default', globals)).toMatchObject({ model: 'opus', effort: 'max' });
    expect(remoteDefaults(unset, null)).toMatchObject({ model: null, effort: null });
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
