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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

  it('stops a process that does not answer in time when nothing else waits, and starts a fresh one', async () => {
    const server = fakeServer({ timeoutMs: 1500 });
    await server.request('thread/list', {});
    const first = server.pid()!;
    await expect(server.request('thread/read', { threadId: 'hang' })).rejects.toMatchObject({ code: 'timeout' });
    expect(server.pid()).toBeNull();
    await until(() => !alive(first));
    await expect(server.request('thread/list', {})).resolves.toMatchObject({ data: [{ id: 't-0' }] });
    expect(server.pid()).not.toBe(first);
  });

  it('keeps the process after one timeout while another request waits, and stops it after two in a row', async () => {
    const server = fakeServer({ timeoutMs: 1500 });
    await server.request('thread/list', {});
    const first = server.pid()!;
    // Sent together, they time out in the order sent, in one turn of the event loop: after the first, the others still
    // wait (the process is kept); the second is two in a row with no word from Codex between (stuck), which fails the third.
    const results = [0, 1, 2].map(() => server.request('thread/read', { threadId: 'hang' }).catch((e: unknown) => e));
    expect(await results[0]).toMatchObject({ code: 'timeout' });
    expect(server.pid()).toBe(first);
    expect(await results[1]).toMatchObject({ code: 'timeout' });
    expect(await results[2]).toMatchObject({ code: 'exited', message: 'Codex app-server stopped answering and was stopped.' });
    expect(server.pid()).toBeNull();
    await until(() => !alive(first), 15_000);
  });

  it('ends a process that does not answer initialize, and tries again on the next request', async () => {
    const server = fakeServer({ timeoutMs: 500, fakeEnv: { FAKE_CODEX_INIT: 'hang' } });
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
    const slow = server.request('thread/list', { limit: 300 });
    await server.request('thread/list', { limit: 0 });
    const pid = server.pid();
    // The quick one is done: only the slow one, still waiting, keeps the idle stop off.
    await expect(slow).resolves.toMatchObject({ data: [{ id: 't-300' }] });
    expect(server.pid()).toBe(pid);
  });

  it('kills a process that ignores the idle stop', async () => {
    const server = fakeServer({ idleMs: 50, killGraceMs: 200, fakeEnv: { FAKE_CODEX_STUBBORN: '1' } });
    const notifications: string[] = [];
    server.onNotification((n) => notifications.push(n.method));
    await server.request('thread/list', {});
    const pid = server.pid()!;
    // It said it got SIGTERM and stayed: only the SIGKILL ends it. Events, not time: however slow the machine. Windows
    // has no SIGTERM to ignore (Node's kill there always ends the process), so it just ends.
    if (process.platform !== 'win32') await until(() => notifications.includes('fake/sigterm'), 20_000);
    await until(() => !alive(pid), 20_000);
  }, 60_000);

  it('reads an answer written just before the process ends', async () => {
    const server = fakeServer();
    await expect(server.request('thread/read', { threadId: 'last' })).resolves.toMatchObject({ thread: { id: 'last' } });
  });

  it('reads an answer that comes in many chunks', async () => {
    const server = fakeServer();
    const result = await server.request('thread/read', { threadId: 'big' });
    expect(result.thread.preview).toHaveLength(8 * 1024 * 1024);
  });

  it('starts with the experimental API when asked', async () => {
    const server = fakeServer({ experimentalApi: true });
    expect((await seen(server)).initialize).toMatchObject({ capabilities: { experimentalApi: true } });
  });

  it('hands every notification to its listeners, from this process and the next, until they stop listening', async () => {
    const server = fakeServer();
    const got: Array<{ method: string; params: unknown }> = [];
    const stop = server.onNotification((n) => got.push(n));
    server.onNotification(() => {
      throw new Error('a broken listener');
    });
    await server.request('thread/read', { threadId: 'notify' });
    expect(got).toContainEqual({ method: 'thread/started', params: { thread: expect.objectContaining({ id: 'notify' }) } });
    await server.request('thread/read', { threadId: 'crash' }).catch(() => {});
    got.length = 0;
    await server.request('thread/read', { threadId: 'notify' });
    expect(got.map((n) => n.method)).toContain('thread/started');
    stop();
    got.length = 0;
    await server.request('thread/read', { threadId: 'notify' });
    expect(got).toEqual([]);
  });

  it("answers Codex's requests with the handler's result or error, however long it takes", async () => {
    const server = fakeServer({ timeoutMs: 1000 });
    const replies: unknown[] = [];
    server.onNotification((n) => n.method === 'fake/reply' && replies.push(n.params));
    const asked: unknown[] = [];
    server.handleRequests(async (request) => {
      asked.push(request);
      // Longer than a request may take: a person answers at the permission card.
      await sleep(1500);
      return { decision: 'accept' };
    });
    await server.request('thread/read', { threadId: 'ask-later' });
    await until(() => replies.length === 1);
    expect(asked).toEqual([{ id: 7, method: 'item/fileChange/requestApproval', params: { threadId: 'ask-later' } }]);
    expect(replies[0]).toEqual({ id: 7, result: { decision: 'accept' } });

    server.handleRequests(async () => {
      throw Object.assign(new Error('Not now.'), { code: -32000 });
    });
    await server.request('thread/read', { threadId: 'ask-later' });
    await until(() => replies.length === 2);
    expect(replies[1]).toEqual({ id: 7, error: { code: -32000, message: 'Not now.' } });

    server.handleRequests(() => Promise.resolve(undefined));
    await server.request('thread/read', { threadId: 'ask-later' });
    await until(() => replies.length === 3);
    expect(replies[2]).toEqual({ id: 7, result: null });

    server.handleRequests(null);
    await server.request('thread/read', { threadId: 'ask-later' });
    await until(() => replies.length === 4);
    expect(replies[3]).toMatchObject({ id: 7, error: { code: -32601 } });
  });

  it('a hold keeps the process from its idle stop until it is let go', async () => {
    const server = fakeServer({ idleMs: 50 });
    const release = server.hold();
    await server.request('thread/list', {});
    const pid = server.pid();
    // The idle stop would have come six times over.
    await sleep(300);
    expect(server.pid()).toBe(pid);
    const other = server.hold();
    release();
    release();
    await sleep(300);
    expect(server.pid()).toBe(pid);
    other();
    await until(() => server.pid() === null);
  });

  it('tells onExit when a held process ends, and the next process starts unheld', async () => {
    const server = fakeServer({ idleMs: 50 });
    let exits = 0;
    server.onExit(() => exits++);
    await server.request('thread/list', {});
    const release = server.hold();
    await server.request('thread/read', { threadId: 'crash' }).catch(() => {});
    expect(exits).toBe(1);
    await server.request('thread/list', {});
    // The hold from before the crash doesn't keep the new process, and letting go of it is harmless.
    await until(() => server.pid() === null);
    release();
    expect(exits).toBe(1);
  });

  // Needs a process that outlives the idle stop's SIGTERM, which Windows can't have: its kill always ends the process.
  it.skipIf(process.platform === 'win32')("a process that ends after the next one started never lets go of the next one's hold", async () => {
    // Stubborn, with no SIGKILL in the test's time: the idle-stopped process lives on until the test kills it, while
    // the next one runs.
    const server = fakeServer({ idleMs: 100, killGraceMs: 600_000, fakeEnv: { FAKE_CODEX_STUBBORN: '1' } });
    let exits = 0;
    server.onExit(() => exits++);
    const notifications: string[] = [];
    server.onNotification((n) => notifications.push(n.method));
    const pids: number[] = [];
    try {
      await server.request('thread/list', {});
      const first = server.pid()!;
      pids.push(first);
      await until(() => notifications.includes('fake/sigterm'), 20_000);
      server.hold();
      await server.request('thread/list', {});
      const second = server.pid()!;
      pids.push(second);
      expect(second).not.toBe(first);
      expect(alive(first)).toBe(true);
      process.kill(first, 'SIGKILL');
      await until(() => !alive(first), 20_000);
      // Its end is handled once its output closes, or at most a second after it exited. Waiting shows nothing happened.
      await sleep(2500);
      expect(exits).toBe(0);
      expect(server.pid()).toBe(second);
    } finally {
      // They ignore SIGTERM and their SIGKILL is far off: ended here, so dispose doesn't wait for them.
      for (const pid of pids) if (alive(pid)) process.kill(pid, 'SIGKILL');
    }
  }, 60_000);

  it('keeps a held process after a slow request, and stops it only after timeouts in a row', async () => {
    const server = fakeServer({ timeoutMs: 1500 });
    server.hold();
    await server.request('thread/list', {});
    const pid = server.pid();
    await expect(server.request('thread/read', { threadId: 'hang' })).rejects.toMatchObject({ code: 'timeout' });
    expect(server.pid()).toBe(pid);
    // An answer between means it isn't stuck; then two at once time out together, with no word from Codex between: stuck.
    await server.request('thread/list', {});
    const both = await Promise.all([0, 1].map(() => server.request('thread/read', { threadId: 'hang' }).catch((e: unknown) => e)));
    expect(both.map((e) => (e as AppServerError).code)).toEqual(['timeout', 'timeout']);
    expect(server.pid()).toBeNull();
    await until(() => !alive(pid!));
  });

  it("aborts a request of Codex's once Codex resolved it itself, and it no longer keeps the process", async () => {
    const server = fakeServer({ idleMs: 50 });
    const signals: AbortSignal[] = [];
    server.handleRequests((_request, signal) => {
      signals.push(signal);
      // Never answered: a card nobody looks at.
      return new Promise(() => {});
    });
    const notifications: string[] = [];
    server.onNotification((n) => notifications.push(n.method));
    await server.request('thread/read', { threadId: 'ask-resolved' });
    await until(() => signals.length === 1);
    expect(signals[0]!.aborted).toBe(false);
    await until(() => notifications.includes('serverRequest/resolved'));
    expect(signals[0]!.aborted).toBe(true);
    await until(() => server.pid() === null);
  });

  it("aborts a request of Codex's when its process ends, and sends nothing after", async () => {
    const server = fakeServer();
    const signals: AbortSignal[] = [];
    let answer: (value: unknown) => void = () => {};
    server.handleRequests((_request, signal) => {
      signals.push(signal);
      return new Promise((resolve) => (answer = resolve));
    });
    await server.request('thread/read', { threadId: 'ask-later' });
    await until(() => signals.length === 1);
    await server.request('thread/read', { threadId: 'crash' }).catch(() => {});
    expect(signals[0]!.aborted).toBe(true);
    answer({ decision: 'accept' });
    await expect(server.request('thread/list', {})).resolves.toMatchObject({ data: [{ id: 't-0' }] });
  });

  it('does not call onExit for the idle stop, an unheld crash or dispose', async () => {
    const server = fakeServer({ idleMs: 50 });
    let exits = 0;
    server.onExit(() => exits++);
    await server.request('thread/list', {});
    await until(() => server.pid() === null);
    await server.request('thread/read', { threadId: 'crash' }).catch(() => {});
    server.hold();
    await server.request('thread/list', {});
    await server.dispose();
    expect(exits).toBe(0);
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
    await sleep(100);
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
