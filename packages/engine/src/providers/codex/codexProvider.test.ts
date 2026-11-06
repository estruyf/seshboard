import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Turn } from './protocol.ts';
import { AppServerError, type AppServerOptions } from './appServer.ts';
import { fakeAppServer, thread } from './codexFakes.ts';
import { codexProvider, type CodexProviderOptions } from './codexProvider.ts';

// The converter is its own module with its own tests: here it names the turns it got, and a subagent by its call.
vi.mock('./codexEvents.ts', () => ({
  codexMessages: (turns: Turn[]) => turns.map((t) => ({ type: 'user', uuid: t.id, parent_tool_use_id: null, message: { content: t.id } })),
  codexSubagentThread: (turns: Turn[], toolUseId: string) => (turns.some((t) => t.id === toolUseId) ? SUB : undefined),
}));

const A = '019a0000-0000-7000-8000-00000000000a';
const B = '019a0000-0000-7000-8000-00000000000b';
const SUB = '019a0000-0000-7000-8000-0000000000ff';

const turn = (id: string): Turn => ({ id, items: [], itemsView: 'full', status: 'completed', error: null, startedAt: null, completedAt: null, durationMs: null });

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function home(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'codex-home-')));
  dirs.push(dir);
  return dir;
}

function provider(codexHome: string, extra: Partial<CodexProviderOptions> = {}) {
  return codexProvider({ profileId: 'codex-1', codexHome, userHome: codexHome, shellEnv: async () => ({ PATH: '/bin' }), binary: async () => ({ path: '/fake/codex', version: '0.167.0' }), ...extra });
}

describe('codexProvider', () => {
  it('runs its sessions through its driver, with Codex CLI to continue and sign in, and its own CODEX_HOME', () => {
    const dir = home();
    const adapter = provider(dir);
    expect(adapter).toMatchObject({ id: 'codex', profileId: 'codex-1', home: dir, homeEnv: { CODEX_HOME: dir }, folder: join(dir, 'sessions'), resumeCommand: 'codex resume {sessionId}', signInCommand: 'codex login' });
    expect(adapter.driver?.modes.map((m) => m.value)).toEqual(['default', 'acceptEdits', 'plan', 'auto']);
    // The driver's status is the profile's.
    expect(adapter.status).toBeUndefined();
  });

  it("finds threads another Codex has open by their locks, and Seshboard's own aren't", async () => {
    const dir = home();
    const day = join(dir, 'sessions', '2026', '11', '06');
    mkdirSync(day, { recursive: true });
    mkdirSync(join(dir, 'thread-writer-locks'));
    for (const id of [A, B]) writeFileSync(join(dir, 'thread-writer-locks', `${id}.lock`), '');
    writeFileSync(join(day, `rollout-2026-11-06T10-00-00-${A}.jsonl`), '{}\n');
    // A is open in a terminal (pid 777); B only in Seshboard's own app-server (pid 4242, the fake's).
    const holders = async (files: readonly string[]) => new Map(files.map((f) => [f, f.includes(A) ? [777] : [4242]]));
    const server = fakeAppServer({ 'thread/list': () => ({ data: [], nextCursor: null }) });
    const adapter = provider(dir, { createAppServer: () => server, lockHolders: holders });
    await adapter.source.list();
    expect(await adapter.inUse!(A)).toBe(true);
    expect(await adapter.inUse!(B)).toBe(false);
    expect(await adapter.inUse!(SUB)).toBe(false);
    // Its rollout was just written: working.
    expect(await adapter.live!([A, B, SUB])).toEqual([{ sessionId: A, pid: 0, status: 'running', updatedAt: expect.any(Number) }]);
  });

  it("runs Seshboard's own app-server with threads unloading as soon as they close", async () => {
    const made: AppServerOptions[] = [];
    const adapter = provider(home(), { createAppServer: (options) => (made.push(options), fakeAppServer({ 'thread/list': () => ({ data: [], nextCursor: null }) })) });
    await adapter.source.list();
    expect(await made[0]!.binary()).toEqual({ path: '/fake/codex', version: '0.167.0', args: ['-c', 'thread_unload_delay_secs=0'] });
  });

  it("finds rollout files by day, plain or compressed, and maps a watcher's path with either separator", () => {
    const dir = home();
    const day = join(dir, 'sessions', '2026', '11', '06');
    mkdirSync(day, { recursive: true });
    mkdirSync(join(dir, 'sessions', '2026', '10', '30'), { recursive: true });
    const a = `rollout-2026-11-06T10-00-00-${A}.jsonl`;
    const b = `rollout-2026-10-30T09-00-00-${B}.jsonl.zst`;
    writeFileSync(join(day, a), '');
    writeFileSync(join(dir, 'sessions', '2026', '10', '30', b), '');
    // Not a rollout, or not in a day's folder.
    writeFileSync(join(day, 'notes.jsonl'), '');
    writeFileSync(join(dir, 'sessions', `rollout-2026-11-06T10-00-00-${SUB}.jsonl`), '');
    const { files } = provider(dir);
    expect(files.files()).toEqual(new Map([[A, join(day, a)], [B, join(dir, 'sessions', '2026', '10', '30', b)]]));

    expect(files.sessionOf(`2026/11/06/${a}`)).toEqual({ sessionId: A, file: join(day, a) });
    expect(files.sessionOf(`2026\\11\\06\\${a}`)).toEqual({ sessionId: A, file: join(day, a) });
    expect(files.sessionOf(`2026/10/30/${b}`)).toEqual({ sessionId: B, file: join(dir, 'sessions', '2026', '10', '30', b) });
    expect(files.sessionOf('2026/11/06/notes.jsonl')).toBeNull();
    expect(files.sessionOf('2026/11/06')).toBeNull();
    expect(files.sessionOf(a)).toBeNull();
    expect(files.sessionOf(`../2026/11/06/${a}`)).toBeNull();

    // Compressed meanwhile: the plain file went, so the session is the `.zst` now (and the plain one wins while both are there).
    writeFileSync(join(day, `${a}.zst`), '');
    expect(files.files().get(A)).toBe(join(day, a));
    rmSync(join(day, a));
    expect(files.sessionOf(`2026/11/06/${a}`)).toEqual({ sessionId: A, file: join(day, `${a}.zst`) });
    expect(files.files().get(A)).toBe(join(day, `${a}.zst`));
  });

  it("trashes the thread's rollout files, in a day's folder or the archive, and nothing else", () => {
    const dir = home();
    const day = join(dir, 'sessions', '2026', '11', '06');
    mkdirSync(day, { recursive: true });
    mkdirSync(join(dir, 'archived_sessions'));
    const a = `rollout-2026-11-06T10-00-00-${A}.jsonl`;
    writeFileSync(join(day, a), '');
    writeFileSync(join(day, `${a}.zst`), '');
    writeFileSync(join(day, `rollout-2026-11-06T10-00-00-${B}.jsonl`), '');
    writeFileSync(join(dir, 'archived_sessions', `rollout-2026-11-01T10-00-00-${B}.jsonl`), '');
    mkdirSync(join(dir, 'sessions', '2026', '11', '07', `rollout-2026-11-07T10-00-00-${A}.jsonl`), { recursive: true });
    const adapter = provider(dir);
    expect(adapter.trashPaths!(A).sort()).toEqual([join(day, a), join(day, `${a}.zst`)]);
    expect(adapter.trashPaths!(B).sort()).toEqual([join(dir, 'archived_sessions', `rollout-2026-11-01T10-00-00-${B}.jsonl`), join(day, `rollout-2026-11-06T10-00-00-${B}.jsonl`)].sort());
    expect(adapter.trashPaths!(SUB)).toEqual([]);
    expect(adapter.trashPaths!('../..')).toEqual([]);
  });

  it('starts one app-server on the first request, with CODEX_HOME, and stops it when disposed', async () => {
    const dir = home();
    const made: AppServerOptions[] = [];
    const server = fakeAppServer({ 'thread/list': () => ({ data: [thread(A)], nextCursor: null }) });
    const adapter = provider(dir, { createAppServer: (options) => (made.push(options), server) });
    expect(made).toHaveLength(0);
    expect((await adapter.source.list()).map((s) => s.sessionId)).toEqual([A]);
    await adapter.source.list();
    expect(made).toHaveLength(1);
    expect(await made[0]!.env()).toEqual({ PATH: '/bin', CODEX_HOME: dir });
    // For Plan mode: `turn/start`'s `collaborationMode` is experimental.
    expect(made[0]!.experimentalApi).toBe(true);
    await adapter.dispose!();
    expect(server.disposed).toBe(1);
  });

  it('starts no server once disposed', async () => {
    const made = vi.fn(() => fakeAppServer({ 'thread/list': () => ({ data: [thread(A)], nextCursor: null }) }));
    const adapter = provider(home(), { createAppServer: made });
    await adapter.source.list();
    await adapter.dispose!();
    // The list keeps what it had; nothing new is started for it.
    expect((await adapter.source.list()).map((s) => s.sessionId)).toEqual([A]);
    expect((await adapter.driver!.status()).problem).toMatch(/disposed/);
    expect(made).toHaveBeenCalledTimes(1);
  });

  it('looks for `codex` once, and again only after it went missing', async () => {
    const lookups = vi.fn(async () => ({ path: '/fake/codex', version: '0.167.0' }));
    let missing = false;
    const server = (options: AppServerOptions) => ({
      ...fakeAppServer({}),
      async request() {
        await options.binary();
        if (missing) throw new AppServerError("Codex CLI isn't installed.", 'notInstalled');
        return { account: null, requiresOpenaiAuth: false };
      },
    }) as never;
    const adapter = provider(home(), { binary: lookups, createAppServer: server });
    await adapter.driver!.status();
    await adapter.driver!.status();
    expect(lookups).toHaveBeenCalledTimes(1);
    missing = true;
    expect((await adapter.driver!.status()).problem).toMatch(/Install OpenAI Codex CLI/);
    missing = false;
    await adapter.driver!.status();
    expect(lookups).toHaveBeenCalledTimes(2);
  });

  it("reads a subagent's own thread through the call that started it", async () => {
    const server = fakeAppServer({ 'thread/turns/list': ({ threadId }) => ({ data: threadId === A ? [turn('spawn-call')] : [turn('sub-1'), turn('sub-2')], nextCursor: null }) });
    const adapter = provider(home(), { createAppServer: () => server });
    expect(await adapter.subagent!(A, 'spawn-call')).toEqual({ agentType: null, messages: [expect.objectContaining({ uuid: 'sub-1' }), expect.objectContaining({ uuid: 'sub-2' })] });
    expect(server.calls.map((c) => (c.params as { threadId: string }).threadId)).toEqual([A, SUB]);
    expect(await adapter.subagent!(A, 'another-call')).toEqual({ agentType: null, messages: [] });
  });

  describe('status', () => {
    it('is not installed without `codex`, and starts nothing', async () => {
      const made = vi.fn();
      const adapter = provider(home(), { binary: async () => null, createAppServer: made });
      expect(await adapter.driver!.status()).toEqual({ binary: null, version: null, signedIn: false, account: null, login: null, problem: expect.stringMatching(/Install OpenAI Codex CLI/) });
      expect(made).not.toHaveBeenCalled();
    });

    it("names a ChatGPT login by its email, and an API key's without a name", async () => {
      const chatgpt = fakeAppServer({ 'account/read': () => ({ account: { type: 'chatgpt', email: 'me@example.com', planType: 'plus', workspaceName: null }, requiresOpenaiAuth: true }) });
      expect(await provider(home(), { createAppServer: () => chatgpt }).driver!.status()).toEqual({ binary: '/fake/codex', version: '0.167.0', signedIn: true, account: 'me@example.com', login: 'me@example.com', problem: null });
      const apiKey = fakeAppServer({ 'account/read': () => ({ account: { type: 'apiKey' }, requiresOpenaiAuth: true }) });
      expect(await provider(home(), { createAppServer: () => apiKey }).driver!.status()).toEqual({ binary: '/fake/codex', version: '0.167.0', signedIn: true, account: null, login: null, problem: null });
    });

    it('says how to sign in when signed out (running a session needs the login), and what failed when Codex does', async () => {
      const signedOut = fakeAppServer({ 'account/read': () => ({ account: null, requiresOpenaiAuth: true }) });
      expect(await provider(home(), { createAppServer: () => signedOut }).driver!.status()).toEqual({ binary: '/fake/codex', version: '0.167.0', signedIn: false, account: null, login: null, problem: expect.stringMatching(/codex login/) });
      // A model provider that needs no OpenAI login (set in Codex's config).
      const noLogin = fakeAppServer({ 'account/read': () => ({ account: null, requiresOpenaiAuth: false }) });
      expect(await provider(home(), { createAppServer: () => noLogin }).driver!.status()).toMatchObject({ signedIn: true, problem: null });
      const broken = fakeAppServer({});
      expect(await provider(home(), { createAppServer: () => broken }).driver!.status()).toMatchObject({ binary: '/fake/codex', signedIn: false, problem: 'No handler for account/read' });
    });
  });
});
