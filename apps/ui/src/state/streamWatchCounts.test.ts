import { describe, expect, it } from 'vitest';
import { canSee, createWatchCounts } from './streamWatchCounts.ts';

describe('createWatchCounts', () => {
  it('starts a watch with the first view of a session and ends it with the last', () => {
    const counts = createWatchCounts();
    expect(counts.add('a')).toBe(true);
    expect(counts.add('a')).toBe(false);
    expect(counts.has('a')).toBe(true);
    expect(counts.remove('a')).toBe(false);
    expect(counts.has('a')).toBe(true);
    expect(counts.remove('a')).toBe(true);
    expect(counts.has('a')).toBe(false);
    expect(counts.has('b')).toBe(false);
  });
});

describe('canSee', () => {
  it('needs main to say the window is shown and the page not to be hidden', () => {
    expect(canSee(true, 'visible')).toBe(true);
    expect(canSee(false, 'visible')).toBe(false);
    expect(canSee(true, 'hidden')).toBe(false);
  });
});
