import { describe, expect, it } from 'vitest';
import { parseSnooze, parseVersion, SNOOZE_MS, snoozeFor, updateState } from './update.ts';

const NOW = 1_800_000_000_000;

describe('a newer remote app', () => {
  it('reads the build from version.json', () => {
    expect(parseVersion({ build: 'a1b2c3d' })).toBe('a1b2c3d');
    expect(parseVersion({ build: '' })).toBeNull();
    expect(parseVersion({ version: 1 })).toBeNull();
    expect(parseVersion(null)).toBeNull();
  });

  it('offers Reload only when the site has another build', () => {
    expect(updateState({ running: 'a1', latest: 'a1', snooze: null, now: NOW })).toBe('none');
    expect(updateState({ running: 'a1', latest: null, snooze: null, now: NOW })).toBe('none');
    expect(updateState({ running: '', latest: 'b2', snooze: null, now: NOW })).toBe('none');
    expect(updateState({ running: 'a1', latest: 'b2', snooze: null, now: NOW })).toBe('ready');
  });

  it('lets Later hide it for an hour, for that version only', () => {
    const later = snoozeFor('b2', NOW);
    expect(updateState({ running: 'a1', latest: 'b2', snooze: later, now: NOW + SNOOZE_MS - 1 })).toBe('snoozed');
    expect(updateState({ running: 'a1', latest: 'b2', snooze: later, now: NOW + SNOOZE_MS })).toBe('ready');
    // A newer build than the one put off shows at once.
    expect(updateState({ running: 'a1', latest: 'c3', snooze: later, now: NOW + 1 })).toBe('ready');
  });

  it('reads a kept snooze back', () => {
    expect(parseSnooze({ version: 'b2', until: 5 })).toEqual({ version: 'b2', until: 5 });
    expect(parseSnooze({ version: 'b2' })).toBeNull();
    expect(parseSnooze(null)).toBeNull();
  });
});
