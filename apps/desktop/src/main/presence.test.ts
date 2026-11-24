import { afterEach, describe, expect, it, vi } from 'vitest';
import { AWAY_AFTER_SECONDS, PRESENCE_POLL_MS, Presence, type IdleState } from './presence.ts';

describe('Presence', () => {
  afterEach(() => vi.useRealTimers());

  const make = (state: { now: IdleState }) => {
    const sent: boolean[] = [];
    const asked: number[] = [];
    const presence = new Presence({
      idleState: (seconds) => {
        asked.push(seconds);
        return state.now;
      },
      send: (present) => sent.push(present),
    });
    return { presence, sent, asked };
  };

  it('says once at the start, then only on a change', () => {
    vi.useFakeTimers();
    const state: { now: IdleState } = { now: 'active' };
    const { presence, sent, asked } = make(state);
    presence.start();
    expect(sent).toEqual([true]);
    expect(asked[0]).toBe(AWAY_AFTER_SECONDS);
    vi.advanceTimersByTime(PRESENCE_POLL_MS * 3);
    expect(sent).toEqual([true]);
    state.now = 'idle';
    vi.advanceTimersByTime(PRESENCE_POLL_MS);
    expect(sent).toEqual([true, false]);
    state.now = 'active';
    vi.advanceTimersByTime(PRESENCE_POLL_MS);
    expect(sent).toEqual([true, false, true]);
    presence.stop();
  });

  it('counts locked and unknown as away', () => {
    for (const now of ['locked', 'unknown'] as const) {
      const { presence, sent } = make({ now });
      presence.check();
      expect(sent).toEqual([false]);
    }
  });

  it('goes away at once on a lock or sleep, and looks again on unlock', () => {
    const state: { now: IdleState } = { now: 'active' };
    const { presence, sent } = make(state);
    presence.check();
    presence.away();
    expect(sent).toEqual([true, false]);
    presence.check();
    expect(sent).toEqual([true, false, true]);
  });
});
