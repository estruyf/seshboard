import { describe, expect, it } from 'vitest';
import type { HostState } from '@seshboard/protocol/client';
import { whenIdle, type HostStateSource } from './whenIdle.ts';

/** A session whose state the test moves along, as the hosts store would. */
function fakeSession(start: HostState | undefined) {
  let state = start;
  const listeners = new Set<() => void>();
  const source: HostStateSource = {
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const move = (next: HostState | undefined) => {
    state = next;
    for (const listener of [...listeners]) listener();
  };
  return { source, move, listeners };
}

describe('whenIdle', () => {
  it('waits for the session to work and then go idle', async () => {
    const s = fakeSession('idle');
    const waiting = whenIdle(s.source, 1_000);
    // Still idle from before /compact reached it: not done yet.
    s.move('idle');
    s.move('running');
    s.move('idle');
    expect(await waiting).toBe(true);
    expect(s.listeners.size).toBe(0);
  });

  it('counts a session already busy when it starts waiting', async () => {
    const s = fakeSession('running');
    const waiting = whenIdle(s.source, 1_000);
    s.move('idle');
    expect(await waiting).toBe(true);
  });

  it('gives up when the session closes, fails or goes away', async () => {
    for (const end of ['closed', 'error', undefined] as const) {
      const s = fakeSession('running');
      const waiting = whenIdle(s.source, 1_000);
      s.move(end);
      expect(await waiting).toBe(false);
      expect(s.listeners.size).toBe(0);
    }
  });

  it('gives up after its time, and stops listening', async () => {
    const s = fakeSession('idle');
    expect(await whenIdle(s.source, 20)).toBe(false);
    expect(s.listeners.size).toBe(0);
  });
});
