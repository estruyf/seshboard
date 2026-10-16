import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection, SocketFailure, type ConnectionState, type Dial } from './connection.ts';
import type { Paired } from './link.ts';

const paired: Paired = { deviceSecret: new Uint8Array(32).fill(7), enginePublicKey: new Uint8Array(32).fill(9), address: 'https://mac.example.com', deviceId: 'd1', name: 'Phone', pairedAt: 1 };

/** The page's events the connection listens to: the page coming back to the front, the network coming back. */
function fakePage() {
  const listeners = new Map<string, Set<() => void>>();
  const target = {
    addEventListener: (type: string, listener: () => void) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(listener),
    removeEventListener: (type: string, listener: () => void) => void listeners.get(type)?.delete(listener),
  };
  vi.stubGlobal('document', { ...target, visibilityState: 'visible' });
  vi.stubGlobal('window', target);
  vi.stubGlobal('navigator', { onLine: true });
  return { fire: (type: string) => listeners.get(type)?.forEach((listener) => listener()) };
}

describe('Connection: Disconnect', () => {
  let page: ReturnType<typeof fakePage>;
  beforeEach(() => {
    vi.useFakeTimers();
    page = fakePage();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** A computer that doesn't answer: every try fails at once. */
  const unreachable = () => vi.fn<Dial>(() => Promise.reject(new SocketFailure({ kind: 'timeout' })));

  it('stops trying, and nothing but Connect starts again', async () => {
    const dial = unreachable();
    const connection = new Connection(paired, { dial });
    const states: ConnectionState['kind'][] = [];
    connection.subscribe((state) => states.push(state.kind));
    connection.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(connection.current.kind).toBe('offline');
    const tries = dial.mock.calls.length;

    connection.disconnect();
    expect(connection.current.kind).toBe('disconnected');
    // The backoff's timer, the page coming back and the network coming back all leave it alone.
    await vi.advanceTimersByTimeAsync(60_000);
    page.fire('visibilitychange');
    page.fire('online');
    connection.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(dial).toHaveBeenCalledTimes(tries);
    expect(connection.current.kind).toBe('disconnected');

    connection.reconnect();
    await vi.advanceTimersByTimeAsync(0);
    expect(dial).toHaveBeenCalledTimes(tries + 1);
    expect(states).toContain('connecting');
    connection.stop();
  });

  it('starts disconnected after a reload, without dialling', async () => {
    const dial = unreachable();
    const connection = new Connection(paired, { dial });
    connection.start({ disconnected: true });
    await vi.advanceTimersByTimeAsync(30_000);
    page.fire('online');
    expect(dial).not.toHaveBeenCalled();
    expect(connection.current.kind).toBe('disconnected');
    connection.reconnect();
    await vi.advanceTimersByTimeAsync(0);
    expect(dial).toHaveBeenCalledTimes(1);
    connection.stop();
  });

  it('ignores a try that was under way when Disconnect came', async () => {
    let fail: (error: Error) => void = () => {};
    const dial = vi.fn<Dial>(() => new Promise((_, reject) => (fail = reject)));
    const connection = new Connection(paired, { dial });
    connection.start();
    expect(connection.current.kind).toBe('connecting');
    connection.disconnect();
    fail(new SocketFailure({ kind: 'timeout' }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(connection.current.kind).toBe('disconnected');
    expect(dial).toHaveBeenCalledTimes(1);
    connection.stop();
  });

  it('only reconnects after a Disconnect', async () => {
    const dial = unreachable();
    const connection = new Connection(paired, { dial });
    connection.start();
    await vi.advanceTimersByTimeAsync(0);
    const tries = dial.mock.calls.length;
    connection.reconnect();
    await vi.advanceTimersByTimeAsync(0);
    expect(dial).toHaveBeenCalledTimes(tries);
    connection.stop();
  });
});
