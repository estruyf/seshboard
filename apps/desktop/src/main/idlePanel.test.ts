import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdlePanel, PANEL_IDLE_MS } from './idlePanel.ts';

describe('IdlePanel', () => {
  afterEach(() => vi.useRealTimers());

  it('destroys a panel that stays hidden for the time, once', () => {
    vi.useFakeTimers();
    const destroy = vi.fn();
    const idle = new IdlePanel({ afterMs: 1_000, destroy });
    idle.hidden();
    vi.advanceTimersByTime(999);
    expect(destroy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(destroy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('keeps a panel that shows again in time, and counts afresh from the next hide', () => {
    vi.useFakeTimers();
    const destroy = vi.fn();
    const idle = new IdlePanel({ afterMs: 1_000, destroy });
    idle.hidden();
    vi.advanceTimersByTime(800);
    idle.shown();
    vi.advanceTimersByTime(5_000);
    expect(destroy).not.toHaveBeenCalled();
    idle.hidden();
    vi.advanceTimersByTime(800);
    idle.hidden();
    vi.advanceTimersByTime(800);
    // The second hide restarted the count: only 800 ms of it have passed.
    expect(destroy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('can be cancelled, and cancelling with nothing counted does nothing', () => {
    vi.useFakeTimers();
    const destroy = vi.fn();
    const idle = new IdlePanel({ afterMs: 1_000, destroy });
    idle.cancel();
    idle.hidden();
    idle.cancel();
    vi.advanceTimersByTime(5_000);
    expect(destroy).not.toHaveBeenCalled();
  });

  it('waits an hour by default', () => {
    expect(PANEL_IDLE_MS).toBe(60 * 60_000);
  });
});
