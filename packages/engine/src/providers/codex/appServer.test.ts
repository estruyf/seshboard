import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { type AppServer, type AppServerOptions, AppServerError, createAppServer } from './appServer.ts';

const fake = fileURLToPath(new URL('./fixtures/fakeAppServer.mjs', import.meta.url));
const servers: AppServer[] = [];

/** An app server that runs the fake (`fixtures/fakeAppServer.mjs`) with the user's own `node`. */
const fakeServer = (options: Partial<AppServerOptions> & { fakeEnv?: Record<string, string> } = {}) => {
  const { fakeEnv, ...rest } = options;
  const server = createAppServer({
    binary: async () => ({ path: process.execPath, args: [fake], version: '0.0.0' }),
    env: async () => ({ ...process.env, ...fakeEnv }),
    timeoutMs: 5000,
    ...rest,
  });
  servers.push(server);
  return server;
};

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const until = async (condition: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

/** The fake answers `account/read` with what it saw: `initialize`'s params and whether `initialized` came first. */
const seen = async (server: AppServer) => ((await server.request('account/read', {})) as unknown as { seen: { initialize: unknown; initialized: boolean; beforeInitialized: string[] } }).seen;

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.dispose()));
});

describe('createAppServer', () => {
  it('starts on the first request with initialize, then initialized, then the request', async () => {
    const server = fakeServer({ clientVersion: '1.2.3' });
    expect(server.pid()).toBeNull();
    const result = await seen(server);
    expect(result.initialize).toEqual({ clientInfo: { name: 'seshboard', title: 'Seshboard', version: '1.2.3' }, capabilities: null });
    expect(result.initialized).toBe(true);
    expect(result.beforeInitialized).toEqual([]);
    expect(server.pid()).toEqual(expect.any(Number));
  });

  it('matches answers to requests that run at once and share one start, past notifications, split lines and lines that are not JSON', async () => {
    const server = fakeServer();
    // The slower first: the fake answers `thread/list` after `limit` ms, so the answers come back in reverse.
    const results = await Promise.all([300, 150, 0].map((limit) => server.request('thread/list', { limit })));
    expect(results.map((r) => r.data[0]!.id)).toEqual(['t-300', 't-150', 't-0']);
    const pid = server.pid();
    await server.request('thread/read', { threadId: 'abc' });
    expect(server.pid()).toBe(pid);
  });

  it("rejects with Codex's own error", async () => {
    const server = fakeServer();
    const error = await server.request('nope/nope' as 'account/read', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppServerError);
    expect(error).toMatchObject({ code: 'rpc', rpcCode: -32600 });
    expect((error as Error).message).toContain('nope/nope');
  });

  it('answers a request of Codex its own with an error', async () => {
    const server = fakeServer();
    const result = (await server.request('thread/read', { threadId: 'ask' })) as unknown as { reply: { id: string; error: { code: number } } };
    expect(result.reply).toMatchObject({ id: 'srv-1', error: { code: -32601 } });
  });

  it('fails a request Codex does not answer in time, and keeps the process for the next', async () => {
    const server = fakeServer({ timeoutMs: 300 });
    await expect(server.request('thread/read', { threadId: 'hang' })).rejects.toMatchObject({ code: 'timeout' });
    const pid = server.pid();
    await expect(server.request('thread/list', {})).resolves.toMatchObject({ data: [{ id: 't-0' }] });
    expect(server.pid()).toBe(pid);
  });

  it('ends a process that does not answer initialize, and tries again on the next request', async () => {
    const server = fakeServer({ timeoutMs: 300, fakeEnv: { FAKE_CODEX_INIT: 'hang' } });
    await expect(server.request('thread/list', {})).rejects.toMatchObject({ code: 'timeout' });
    await until(() => server.pid() === null);
    await expect(server.request('thread/list', {})).rejects.toMatchObject({ code: 'timeout' });
  });

  it('fails the requests in flight when Codex crashes, with the end of its stderr, and starts again on the next', async () => {
    const server = fakeServer();
    await server.request('thread/list', {});
    const first = server.pid()!;
    const hanging = server.request('thread/read', { threadId: 'hang' });
    const crash = server.request('thread/read', { threadId: 'crash' });
    for (const request of [hanging, crash]) {
      const error = await request.catch((e: unknown) => e);
      expect(error).toMatchObject({ code: 'exited' });
      expect((error as Error).message).toContain('code 3');
      expect((error as Error).message).toContain('ERROR boom: the fake crashed');
    }
    expect(server.pid()).toBeNull();
    await expect(server.request('thread/list', {})).resolves.toMatchObject({ data: [{ id: 't-0' }] });
    expect(server.pid()).not.toBe(first);
    expect(alive(first)).toBe(false);
  });

  it('stops when idle and starts again on the next request', async () => {
    const server = fakeServer({ idleMs: 100 });
    await server.request('thread/list', {});
    const first = server.pid()!;
    await until(() => server.pid() === null && !alive(first));
    await server.request('thread/list', {});
    expect(server.pid()).not.toBeNull();
    expect(server.pid()).not.toBe(first);
  });

  it('does not stop while a request is in flight', async () => {
    const server = fakeServer({ idleMs: 50 });
    await expect(server.request('thread/list', { limit: 300 })).resolves.toMatchObject({ data: [{ id: 't-300' }] });
  });

  it("says Codex CLI isn't installed when there is no binary, or it is gone", async () => {
    const none = fakeServer({ binary: async () => null });
    await expect(none.request('thread/list', {})).rejects.toMatchObject({ code: 'notInstalled', message: "Codex CLI isn't installed." });
    const gone = fakeServer({ binary: async () => ({ path: fileURLToPath(new URL('./fixtures/no-such-codex', import.meta.url)), version: null }) });
    await expect(gone.request('thread/list', {})).rejects.toMatchObject({ code: 'notInstalled' });
    expect(gone.pid()).toBeNull();
  });

  it('looks for the binary again on the next request', async () => {
    let installed = false;
    const server = fakeServer({ binary: async () => (installed ? { path: process.execPath, args: [fake], version: '0.0.0' } : null) });
    await expect(server.request('thread/list', {})).rejects.toMatchObject({ code: 'notInstalled' });
    installed = true;
    await expect(server.request('thread/list', {})).resolves.toMatchObject({ data: [{ id: 't-0' }] });
  });

  it('dispose ends the process and fails what is pending and what comes after', async () => {
    const server = fakeServer();
    await server.request('thread/list', {});
    const pid = server.pid()!;
    const hanging = server.request('thread/read', { threadId: 'hang' }).catch((e: unknown) => e);
    // Nothing to wait on: the fake never answers, so give the request time to reach it.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await server.dispose();
    expect(await hanging).toMatchObject({ code: 'disposed' });
    expect(server.pid()).toBeNull();
    expect(alive(pid)).toBe(false);
    await expect(server.request('thread/list', {})).rejects.toMatchObject({ code: 'disposed' });
  });

  it('dispose right after a request fails it too', async () => {
    const server = fakeServer();
    const request = server.request('thread/list', {}).catch((e: unknown) => e);
    await server.dispose();
    expect(await request).toMatchObject({ code: 'disposed' });
  });

  it('dispose during the start ends the process it started', async () => {
    const server = fakeServer({ fakeEnv: { FAKE_CODEX_INIT: 'hang' } });
    const starting = server.request('thread/list', {}).catch((e: unknown) => e);
    await until(() => server.pid() !== null);
    const pid = server.pid()!;
    await server.dispose();
    expect(await starting).toMatchObject({ code: 'disposed' });
    expect(alive(pid)).toBe(false);
  });
});
