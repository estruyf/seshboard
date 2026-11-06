import type { AppServer } from './appServer.ts';
import type { Methods, ServerNotification, ServerRequest, Thread } from './protocol.ts';

type Handlers = { [M in keyof Methods]?: (params: Methods[M]['params']) => Methods[M]['result'] | Promise<Methods[M]['result']> };

export type FakeAppServer = AppServer & {
  calls: Array<{ method: string; params: unknown }>;
  disposed: number;
  /** Holds taken and not let go. */
  holds: number;
  /** Sends a notification, as Codex does. */
  notify(method: string, params: unknown): void;
  /** Sends one of Codex's requests to the handler; resolves with its answer, rejects with its refusal. */
  ask(method: string, params: unknown): Promise<unknown>;
  /** The process ends while held. */
  exit(): void;
  /** Whether a handler for Codex's requests is set. */
  handling(): boolean;
};

/**
 * An in-memory `codex app-server` for tests (the client itself is tested on its own): answers with `handlers`, records
 * each request, fails what it has no handler for, and lets a test send notifications and Codex's own requests.
 */
export function fakeAppServer(handlers: Handlers): FakeAppServer {
  const calls: Array<{ method: string; params: unknown }> = [];
  const listeners = new Set<(notification: ServerNotification) => void>();
  const exits = new Set<() => void>();
  let handler: ((request: ServerRequest) => Promise<unknown>) | null = null;
  let nextRequest = 1;
  const server = {
    calls,
    disposed: 0,
    holds: 0,
    async request(method: keyof Methods, params: never) {
      calls.push({ method, params });
      const handle = handlers[method] as ((params: unknown) => unknown) | undefined;
      if (!handle) throw new Error(`No handler for ${method}`);
      return handle(params);
    },
    pid: () => 4242,
    onNotification(listener: (notification: ServerNotification) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    handleRequests(next: ((request: ServerRequest) => Promise<unknown>) | null) {
      handler = next;
    },
    hold() {
      server.holds++;
      let held = true;
      return () => {
        if (held) server.holds--;
        held = false;
      };
    },
    onExit(listener: () => void) {
      exits.add(listener);
      return () => void exits.delete(listener);
    },
    notify(method: string, params: unknown) {
      for (const listener of [...listeners]) listener({ method, params });
    },
    async ask(method: string, params: unknown) {
      if (!handler) throw new Error('Refused: no handler');
      return handler({ id: nextRequest++, method, params });
    },
    exit() {
      for (const listener of [...exits]) listener();
    },
    handling: () => handler !== null,
    async dispose() {
      server.disposed++;
    },
  };
  return server as unknown as FakeAppServer;
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
