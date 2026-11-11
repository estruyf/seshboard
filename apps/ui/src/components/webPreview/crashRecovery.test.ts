import { describe, expect, it } from 'vitest';
import { CRASH_WINDOW_MS, crashReloadDelay } from './crashRecovery.ts';

describe('crashReloadDelay', () => {
  it('waits longer each time, then gives up after three stops in 30 seconds', () => {
    expect(crashReloadDelay([], 100_000)).toBe(250);
    expect(crashReloadDelay([99_000], 100_000)).toBe(500);
    expect(crashReloadDelay([98_000, 99_000], 100_000)).toBe(1_000);
    expect(crashReloadDelay([97_000, 98_000, 99_000], 100_000)).toBeNull();
  });

  it('forgets stops older than 30 seconds', () => {
    expect(crashReloadDelay([100_000 - CRASH_WINDOW_MS - 1, 99_000], 100_000)).toBe(500);
  });
});
