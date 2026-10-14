import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALIVE, nextLiveness, startLivenessMonitor, type LivenessMonitor } from './liveness.ts';

describe('nextLiveness', () => {
  it('stalls after two misses in a row', () => {
    const one = nextLiveness(ALIVE, 'miss');
    expect(one).toEqual({ misses: 1, stalled: false });
    expect(nextLiveness(one, 'miss')).toEqual({ misses: 2, stalled: true });
  });

  it('starts counting again after an answer', () => {
    const one = nextLiveness(ALIVE, 'miss');
    const back = nextLiveness(one, 'answer');
    expect(back).toEqual(ALIVE);
    expect(nextLiveness(back, 'miss').stalled).toBe(false);
  });

  it('clears a stall on the next answer', () => {
    let state = ALIVE;
    for (let i = 0; i < 5; i++) state = nextLiveness(state, 'miss');
    expect(state.stalled).toBe(true);
    expect(nextLiveness(state, 'answer')).toEqual(ALIVE);
  });

  it('keeps the same state when all is well', () => {
    expect(nextLiveness(ALIVE, 'answer')).toBe(ALIVE);
  });

  it('takes another number of misses', () => {
    expect(nextLiveness(ALIVE, 'miss', 1).stalled).toBe(true);
  });
});

describe('startLivenessMonitor', () => {
  let monitor: LivenessMonitor | null = null;
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    monitor?.stop();
    monitor = null;
    vi.useRealTimers();
  });

  /** A ping whose answers the test hands out. */
  const engine = () => {
    const waiting: Array<() => void> = [];
    let answering = true;
    return {
      ping: vi.fn(() => (answering ? Promise.resolve({}) : new Promise<void>((resolve) => waiting.push(resolve)))),
      hang: () => (answering = false),
      resume: () => {
        answering = true;
        for (const resolve of waiting.splice(0)) resolve();
      },
    };
  };

  it('pings every interval and stays quiet while the engine answers', async () => {
    const fake = engine();
    const onChange = vi.fn();
    monitor = startLivenessMonitor({ ping: fake.ping, onChange, intervalMs: 5_000, timeoutMs: 4_000 });
    expect(fake.ping).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fake.ping).toHaveBeenCalledTimes(3);
    expect(onChange).not.toHaveBeenCalled();
    expect(monitor.stalled).toBe(false);
  });

  it('reports a stall after two missed pings, and clears it on the next answer', async () => {
    const fake = engine();
    const onChange = vi.fn();
    monitor = startLivenessMonitor({ ping: fake.ping, onChange, intervalMs: 5_000, timeoutMs: 4_000 });
    fake.hang();
    await vi.advanceTimersByTimeAsync(9_000); // first ping missed at 9s
    expect(onChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000); // second ping missed at 14s
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(monitor.stalled).toBe(true);
    // More misses don't say it again.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onChange).toHaveBeenCalledTimes(1);
    fake.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(monitor.stalled).toBe(false);
  });

  it('does not count one slow answer as a stall', async () => {
    const fake = engine();
    const onChange = vi.fn();
    monitor = startLivenessMonitor({ ping: fake.ping, onChange, intervalMs: 5_000, timeoutMs: 4_000 });
    fake.hang();
    await vi.advanceTimersByTimeAsync(9_000);
    fake.resume();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ignores a ping that fails fast: only the timer decides', async () => {
    const onChange = vi.fn();
    monitor = startLivenessMonitor({ ping: () => Promise.reject(new Error('DISCONNECTED')), onChange, intervalMs: 5_000, timeoutMs: 4_000 });
    await vi.advanceTimersByTimeAsync(14_000);
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it('does not ping while the window is hidden', async () => {
    const fake = engine();
    let hidden = true;
    monitor = startLivenessMonitor({ ping: fake.ping, onChange: vi.fn(), isHidden: () => hidden, intervalMs: 5_000, timeoutMs: 4_000 });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fake.ping).not.toHaveBeenCalled();
    hidden = false;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fake.ping).toHaveBeenCalledTimes(1);
  });

  it('says nothing after it is stopped', async () => {
    const fake = engine();
    const onChange = vi.fn();
    monitor = startLivenessMonitor({ ping: fake.ping, onChange, intervalMs: 5_000, timeoutMs: 4_000 });
    fake.hang();
    await vi.advanceTimersByTimeAsync(5_000);
    monitor.stop();
    await vi.advanceTimersByTimeAsync(30_000);
    fake.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.ping).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });
});
