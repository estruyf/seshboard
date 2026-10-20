import { describe, expect, it } from 'vitest';
import { MAX_OFFSET, pullLabel, pullOffset, pullPhase, pullStarts } from './pull.ts';

describe('pull to refresh', () => {
  it('says Pull to refresh, then Release to refresh past 64px', () => {
    expect(pullPhase(0, false)).toBe('idle');
    expect(pullPhase(30, false)).toBe('pull');
    expect(pullPhase(64, false)).toBe('pull');
    expect(pullPhase(65, false)).toBe('release');
  });

  it('shows the spinner while it refreshes, wherever the finger is', () => {
    expect(pullPhase(0, true)).toBe('refreshing');
    expect(pullPhase(100, true)).toBe('refreshing');
  });

  it('moves the list less than the finger, and only so far', () => {
    expect(pullOffset(-20)).toBe(0);
    expect(pullOffset(50)).toBe(30);
    expect(pullOffset(1000)).toBe(MAX_OFFSET);
  });

  it('says Release to update when a newer app is waiting', () => {
    expect(pullLabel('pull', false)).toBe('Pull to refresh');
    expect(pullLabel('release', false)).toBe('Release to refresh');
    expect(pullLabel('pull', true)).toBe('Pull to refresh');
    expect(pullLabel('release', true)).toBe('Release to update');
    expect(pullLabel('refreshing', true)).toBe('Updating…');
  });

  it('only starts at the top of the list, going down', () => {
    expect(pullStarts(0, 12, 2)).toBe(true);
    expect(pullStarts(40, 12, 2)).toBe(false);
    expect(pullStarts(0, -12, 2)).toBe(false);
    expect(pullStarts(0, 10, 30)).toBe(false);
  });
});
