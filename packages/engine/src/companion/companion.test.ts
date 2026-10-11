import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import {
  COMPANION_DIR,
  COMPANION_INFO_FILE,
  COMPANION_PROTOCOL,
  createRpcClient,
  lineTransport,
  messagePortTransport,
  type CompanionContract,
  type CompanionInfo,
  type Contract,
  type DomLikePort,
  type RpcClient,
} from '@switchboard/protocol';
import type { SessionSource } from '../claude/sessionSource.ts';
import { createEngine } from '../engine.ts';
import type { PermissionDecision, PermissionRequest, SessionSummary } from '@switchboard/protocol';
import { CompanionHub } from './companionHub.ts';
import { companionSessions, inFolders, isWithin, promptsFor, RECENT_MS, sessionsFor } from './companionSessions.ts';

const SESSION_ID = '44444444-4444-4444-8444-444444444444';
// Folders in this platform's form (E:\work\web on Windows), as the companion only takes absolute local paths.
const WORK = resolve('/work');
const WEB = join(WORK, 'web');
const SRC = join(WEB, 'src');
const LOGIN = join(SRC, 'login.ts');
const ELSEWHERE = resolve('/elsewhere');
const source: SessionSource = {
  list: async () => [{ sessionId: SESSION_ID, summary: 'Fix the login form', lastModified: Date.now(), cwd: WEB }],
  info: async () => undefined,
  messages: async () => [],
};

const asDomPort = (port: MessagePort) => port as unknown as DomLikePort;
const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

async function until<T>(read: () => T | Promise<T>, ok: (value: T) => boolean, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > deadline) throw new Error('Timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** An engine listening for the companion, and a window attached to it. */
async function start() {
  const dataDir = mkdtempSync(join(tmpdir(), 'switchboard-companion-'));
  const engine = createEngine({
    dataDir,
    claudeConfigDir: join(dataDir, 'claude'),
    shellEnv: Promise.resolve({ shell: '/bin/zsh', env: { PATH: '' }, resolved: false, durationMs: 0 }),
    claudeBinary: '/nonexistent/claude',
    sessionSource: source,
    companion: { appVersion: '9.9.9' },
  });
  const { port1, port2 } = new MessageChannel();
  const detach = engine.attach(messagePortTransport(asDomPort(port1)));
  const window = createRpcClient<Contract>(messagePortTransport(asDomPort(port2)));
  cleanups.push(() => {
    window.dispose();
    detach();
    engine.close();
    port1.close();
    port2.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  const infoFile = join(dataDir, COMPANION_DIR, COMPANION_INFO_FILE);
  await until(() => existsSync(infoFile), Boolean);
  const info = JSON.parse(readFileSync(infoFile, 'utf8')) as CompanionInfo;
  await until(() => window.call('sessions.list', {}), (s) => s.sessions.some((x) => x.id === SESSION_ID));
  return { dataDir, window, info, infoFile };
}

/** An editor's connection to the socket. */
function editor(info: CompanionInfo): { client: RpcClient<CompanionContract>; socket: Socket; closed: Promise<void> } {
  const socket = createConnection(info.socket);
  socket.setEncoding('utf8');
  const transport = lineTransport({
    write: (text) => void socket.write(text),
    onData(listener) {
      socket.on('data', listener);
      return () => socket.off('data', listener);
    },
    close: () => socket.destroy(),
  });
  const client = createRpcClient<CompanionContract>(transport, { timeoutMs: 3_000 });
  const closed = new Promise<void>((resolve) => socket.on('close', () => resolve()));
  cleanups.push(() => {
    client.dispose();
    socket.destroy();
  });
  return { client, socket, closed };
}

const hello = (client: RpcClient<CompanionContract>, token: string) => client.call('hello', { token, protocol: COMPANION_PROTOCOL, client: { name: 'test', version: '0' } });

describe('companion socket', () => {
  it('writes where it listens to a file only you can read', async () => {
    const { info, infoFile } = await start();
    if (process.platform === 'win32') {
      // A named pipe with a name nobody can guess; Windows has no file modes (AppData is the user's own).
      expect(info.socket).toMatch(/^\\\\\.\\pipe\\switchboard-[0-9a-f]{32}$/);
    } else {
      expect(statSync(infoFile).mode & 0o777).toBe(0o600);
      expect(statSync(join(infoFile, '..')).mode & 0o777).toBe(0o700);
      expect(statSync(join(info.socket, '..')).mode & 0o777).toBe(0o700);
    }
    expect(info).toMatchObject({ protocol: COMPANION_PROTOCOL, appVersion: '9.9.9', pid: process.pid });
    expect(info.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a wrong token and closes the connection', async () => {
    const { info } = await start();
    const { client, closed } = editor(info);
    await expect(hello(client, 'not-the-token')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await closed;
  });

  it('refuses anything before hello', async () => {
    const { info } = await start();
    const { client, closed } = editor(info);
    await expect(client.call('sessions.list', { folders: [] })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await closed;
  });

  it('validates what an editor sends', async () => {
    const { info } = await start();
    const { client } = editor(info);
    await hello(client, info.token);
    await expect(client.call('context.add', { target: { kind: 'new', cwd: 'relative/path' }, items: [] })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('lists the sessions of the workspace folders, and the one on screen', async () => {
    const { info, window } = await start();
    const { client } = editor(info);
    await expect(hello(client, info.token)).resolves.toMatchObject({ protocol: COMPANION_PROTOCOL, app: { version: '9.9.9' } });
    // Started in a terminal: only listed while the sidebar shows every session.
    expect((await client.call('sessions.list', { folders: [WORK] })).sessions).toEqual([]);
    await window.call('companion.focus', { sessionId: null, scope: 'all' });
    expect((await client.call('sessions.list', { folders: [WORK] })).sessions.map((s) => s.id)).toEqual([SESSION_ID]);
    expect((await client.call('sessions.list', { folders: [SRC] })).sessions.map((s) => s.id)).toEqual([SESSION_ID]);
    expect((await client.call('sessions.list', { folders: [ELSEWHERE] })).sessions).toEqual([]);
    expect((await client.call('sessions.list', { folders: [] })).focused).toBeNull();
    await window.call('companion.focus', { sessionId: SESSION_ID, scope: 'all' });
    const listed = await client.call('sessions.list', { folders: [ELSEWHERE] });
    expect(listed.focused).toMatchObject({ id: SESSION_ID, cwd: WEB });
    expect(listed.windows).toBe(1);
  });

  it('hands context to the window that reported focus, and waits for it to be added', async () => {
    const { info, window } = await start();
    const { client } = editor(info);
    await hello(client, info.token);
    const items = [{ kind: 'file' as const, path: LOGIN, range: { start: 12, end: 40 } }];
    // No window has said what it shows yet: nowhere to put it.
    await expect(client.call('context.add', { target: { kind: 'session', sessionId: SESSION_ID }, items })).rejects.toMatchObject({ code: 'NO_WINDOW' });

    await window.call('companion.focus', { sessionId: null });
    const received: unknown[] = [];
    window.on('companion.context', (event) => {
      received.push(event);
      void window.call('companion.received', { deliveryId: event.deliveryId });
    });
    await client.call('context.add', { target: { kind: 'session', sessionId: SESSION_ID }, items, reveal: false });
    expect(received).toEqual([{ deliveryId: expect.any(String), target: { kind: 'session', sessionId: SESSION_ID }, items: [{ ...items[0], directory: false }], reveal: false }]);

    await expect(client.call('context.add', { target: { kind: 'session', sessionId: 'no-such-session' }, items })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reports a window that could not add the context', async () => {
    const { info, window, dataDir } = await start();
    const { client } = editor(info);
    await hello(client, info.token);
    await window.call('companion.focus', { sessionId: null });
    window.on('companion.context', (event) => void window.call('companion.received', { deliveryId: event.deliveryId, error: 'No room' }));
    await expect(client.call('context.add', { target: { kind: 'new', cwd: dataDir }, items: [{ kind: 'text', source: 'terminal', label: 'Terminal', text: 'npm ERR!' }] })).rejects.toMatchObject({
      code: 'NOT_ADDED',
      message: 'No room',
    });
  });

  it('tells watching editors when the session on screen changes', async () => {
    const { info, window } = await start();
    const { client } = editor(info);
    await hello(client, info.token);
    const changes: Array<string | null> = [];
    client.on('sessions.changed', ({ focused }) => void changes.push(focused?.id ?? null));
    await client.call('sessions.watch', { folders: [WORK] });
    await window.call('companion.focus', { sessionId: SESSION_ID });
    await until(() => changes, (c) => c.length > 0);
    expect(changes).toEqual([SESSION_ID]);
  });
});

const prompt = (requestId: string, sessionId: string, createdAt = 1): PermissionRequest => ({
  requestId,
  sessionId,
  toolName: 'Bash',
  toolUseId: null,
  input: { command: 'npm test' },
  title: 'Claude wants to run npm test',
  description: null,
  decisionReason: null,
  blockedPath: null,
  alwaysLabel: null,
  agentId: null,
  createdAt,
});

describe('prompts', () => {
  it('lists the prompts of the listed sessions, oldest first', () => {
    const prompts = [prompt('b', 's1', 2), prompt('elsewhere', 's2', 0), prompt('a', 's1', 1)];
    expect(promptsFor(prompts, [{ id: 's1' }]).map((p) => p.requestId)).toEqual(['a', 'b']);
  });

  it('hands an editor the prompts of its folders, and its answers to the engine', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'switchboard-companion-'));
    const answers: Array<[string, PermissionDecision, boolean]> = [];
    const summary = { id: SESSION_ID, title: 'Fix the login form', firstPrompt: null, customTitle: null, cwd: WEB, projectRoot: WEB, gitBranch: 'main', worktree: null, origin: 'app', createdAt: null, updatedAt: Date.now(), fileSize: null, tag: null, pinned: false, archivedAt: null, viewedAt: null, unread: false, inApp: true, profileId: 'default' } satisfies SessionSummary;
    const hub = new CompanionHub({
      infoDir: join(dataDir, COMPANION_DIR),
      appVersion: '9.9.9',
      sources: () => ({ summaries: [summary], live: [], hosts: [], permissions: [prompt('ask', SESSION_ID), prompt('other', 'not-listed')] }),
      windows: () => 1,
      respond: (requestId, decision, acceptEdits) => {
        if (requestId !== 'ask') throw new Error('gone');
        answers.push([requestId, decision, acceptEdits]);
      },
      log: () => {},
    });
    cleanups.push(() => {
      hub.stop();
      rmSync(dataDir, { recursive: true, force: true });
    });
    await hub.start();
    const info = JSON.parse(readFileSync(hub.infoFile, 'utf8')) as CompanionInfo;
    const { client } = editor(info);
    await hello(client, info.token);
    expect((await client.call('sessions.list', { folders: [WORK] })).prompts?.map((p) => p.requestId)).toEqual(['ask']);
    expect((await client.call('sessions.list', { folders: [ELSEWHERE] })).prompts).toEqual([]);

    await client.call('prompt.respond', { requestId: 'ask', decision: { behavior: 'allow' }, acceptEdits: true });
    await client.call('prompt.respond', { requestId: 'ask', decision: { behavior: 'deny', message: 'Use pnpm' } });
    expect(answers).toEqual([
      ['ask', { behavior: 'allow', always: false }, true],
      ['ask', { behavior: 'deny', message: 'Use pnpm', interrupt: false }, false],
    ]);
    await expect(client.call('prompt.respond', { requestId: 'ask', decision: { behavior: 'maybe' } as never })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });
});

describe('session matching', () => {
  const session = (cwd: string | null, projectRoot = cwd ?? '/repo') => ({ cwd, projectRoot });

  it('matches folders by path, not by prefix', () => {
    expect(isWithin('/repo/src', '/repo')).toBe(true);
    expect(isWithin('/repo', '/repo/')).toBe(true);
    expect(isWithin('/repository', '/repo')).toBe(false);
    // Windows: VS Code says c:\, Claude Code says C:\.
    expect(isWithin('C:\\repo\\src', 'c:\\repo')).toBe(true);
    expect(isWithin('C:\\repository', 'C:\\repo')).toBe(false);
  });

  it('lists a session when it works in a workspace folder, or a workspace folder is inside its own', () => {
    expect(inFolders(session('/repo/.claude/worktrees/fix'), ['/repo'])).toBe(true);
    expect(inFolders(session('/repo'), ['/repo/packages/web'])).toBe(true);
    expect(inFolders(session('/repo/packages/api'), ['/repo/packages/web'])).toBe(false);
    expect(inFolders(session(null, '/repo'), ['/repo'])).toBe(true);
    expect(inFolders(session('/other'), [])).toBe(true);
  });

  it('puts what needs you first, then what is working, then the most recent', () => {
    const base = { title: '', cwd: '/repo', projectRoot: '/repo', branch: null, inApp: true };
    const list = sessionsFor(
      [
        { ...base, id: 'old', status: 'idle', updatedAt: 1 },
        { ...base, id: 'new', status: 'stopped', updatedAt: 9 },
        { ...base, id: 'busy', status: 'working', updatedAt: 2 },
        { ...base, id: 'ask', status: 'needs-you', updatedAt: 3 },
      ],
      ['/repo'],
    );
    expect(list.map((s) => s.id)).toEqual(['ask', 'busy', 'old', 'new']);
  });
});

describe('which sessions are listed', () => {
  const now = 10 * RECENT_MS;
  const summary = (id: string, over: Partial<SessionSummary> = {}): SessionSummary => ({
    id,
    title: id,
    firstPrompt: null,
    customTitle: null,
    cwd: '/repo',
    projectRoot: '/repo',
    gitBranch: 'main',
    worktree: null,
    origin: 'cli',
    createdAt: null,
    updatedAt: now - 60_000,
    fileSize: null,
    tag: null,
    pinned: false,
    archivedAt: null,
    viewedAt: null,
    unread: false,
    inApp: true,
    profileId: 'default',
    ...over,
  });
  const ids = (summaries: SessionSummary[], options: Parameters<typeof companionSessions>[1] = {}) =>
    companionSessions({ summaries, live: [], hosts: [] }, { now, scope: 'all', ...options }).map((s) => s.id);

  it('leaves out what the sidebar archived, by hand or after 48 hours', () => {
    const list = [
      summary('recent'),
      summary('archived-unread', { archivedAt: now - 30_000, updatedAt: now - 60_000, unread: true }),
      summary('news-since-archived', { archivedAt: now - 90_000 }),
      summary('old', { updatedAt: now - RECENT_MS - 1 }),
      summary('old-unread', { updatedAt: now - RECENT_MS - 1, unread: true }),
      summary('old-pinned', { updatedAt: now - RECENT_MS - 1, pinned: true, archivedAt: now }),
    ];
    expect(ids(list)).toEqual(['recent', 'news-since-archived', 'old-unread', 'old-pinned']);
  });

  it('lists only sessions from Switchboard under its default scope', () => {
    const list = [summary('app'), summary('terminal', { inApp: false })];
    expect(ids(list, { scope: 'switchboard' })).toEqual(['app']);
    expect(ids(list, { scope: 'all' })).toEqual(['app', 'terminal']);
  });

  it('keeps the session open in Switchboard', () => {
    const list = [summary('open', { archivedAt: now, inApp: false })];
    expect(ids(list, { scope: 'switchboard' })).toEqual([]);
    expect(ids(list, { scope: 'switchboard', keep: 'open' })).toEqual(['open']);
  });
});
