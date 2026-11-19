import type { AcpConnection, AcpRequestHandler } from './acpConnection.ts';
import type { AcpInitializeResponse } from './acpTypes.ts';

/** What a fake agent answers a request with: a value, or a function of its params (which may throw, or wait). */
type Answer = unknown | ((params: Record<string, unknown>) => unknown);

/**
 * An `AcpConnection` for tests: requests are answered from `answers` by method (unknown ones fail), every request and
 * notification is recorded, and the test sends the agent's notifications (`update`) and requests (`ask`) itself.
 */
export function fakeAcpConnection(answers: Record<string, Answer> = {}) {
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  const notified: Array<{ method: string; params: Record<string, unknown> }> = [];
  const listeners = new Set<(method: string, params: unknown) => void>();
  const exits = new Set<() => void>();
  let handler: AcpRequestHandler | null = null;
  let holds = 0;
  let disposed = 0;
  const connection: AcpConnection = {
    async request<T>(method: string, params: unknown) {
      requests.push({ method, params: params as Record<string, unknown> });
      if (!(method in answers)) throw new Error(`fake agent: no answer for ${method}`);
      const answer = answers[method];
      return (typeof answer === 'function' ? await (answer as (p: Record<string, unknown>) => unknown)(params as Record<string, unknown>) : answer) as T;
    },
    notify(method, params) {
      notified.push({ method, params: params as Record<string, unknown> });
    },
    initialized: (): AcpInitializeResponse | null => null,
    onNotification(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    handleRequests(next) {
      handler = next;
    },
    hold() {
      holds++;
      let held = true;
      return () => {
        if (held) holds--;
        held = false;
      };
    },
    onExit(listener) {
      exits.add(listener);
      return () => exits.delete(listener);
    },
    pid: () => null,
    async dispose() {
      disposed++;
    },
  };
  return {
    connection,
    requests,
    notified,
    /** Sends a `session/update` for a session. */
    update(sessionId: string, update: Record<string, unknown>) {
      for (const listener of [...listeners]) listener('session/update', { sessionId, update });
    },
    /** The agent asks something (`session/request_permission`); resolves with Seshboard's answer. */
    ask(method: string, params: Record<string, unknown>, signal: AbortSignal = new AbortController().signal) {
      if (!handler) throw new Error('fake agent: nothing handles requests');
      return handler(method, params, signal);
    },
    /** The agent's process ended. */
    exit() {
      for (const listener of [...exits]) listener();
    },
    holds: () => holds,
    disposed: () => disposed,
  };
}
