import type { AppServer } from './appServer.ts';
import type { ReadMethods, Thread } from './protocol.ts';

type Handlers = { [M in keyof ReadMethods]?: (params: ReadMethods[M]['params']) => ReadMethods[M]['result'] | Promise<ReadMethods[M]['result']> };

/** An in-memory `codex app-server` for tests (the client itself is tested on its own): answers with `handlers`, records each request, and fails what it has no handler for. */
export function fakeAppServer(handlers: Handlers): AppServer & { calls: Array<{ method: string; params: unknown }>; disposed: number } {
  const calls: Array<{ method: string; params: unknown }> = [];
  const server = {
    calls,
    disposed: 0,
    async request(method: keyof ReadMethods, params: never) {
      calls.push({ method, params });
      const handler = handlers[method] as ((params: unknown) => unknown) | undefined;
      if (!handler) throw new Error(`No handler for ${method}`);
      return handler(params);
    },
    pid: () => 4242,
    async dispose() {
      server.disposed++;
    },
  };
  return server as unknown as AppServer & { calls: Array<{ method: string; params: unknown }>; disposed: number };
}

/** A thread as `thread/list` returns it, with what a test doesn't care about filled in. */
export function thread(id: string, extra: Partial<Thread> = {}): Thread {
  return {
    id,
    forkedFromId: null,
    parentThreadId: null,
    preview: `Prompt of ${id.slice(0, 4)}`,
    ephemeral: false,
    modelProvider: 'openai',
    createdAt: 1_762_400_000,
    updatedAt: 1_762_400_100,
    status: { type: 'notLoaded' },
    path: null,
    cwd: '/work/app',
    cliVersion: '0.167.0',
    source: 'cli',
    gitInfo: null,
    name: null,
    turns: [],
    ...extra,
  };
}
