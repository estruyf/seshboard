import { describe, expect, it } from 'vitest';
import { STAR_AFTER_SESSIONS, starPrompt } from './starPrompt.ts';

describe('starPrompt', () => {
  const enough = STAR_AFTER_SESSIONS;

  it('stars through gh when it can, and opens the page when it cannot tell', () => {
    expect(starPrompt('ask', enough, 'not-starred')).toBe('star');
    expect(starPrompt('ask', enough, 'unavailable')).toBe('open-page');
  });

  it('stays hidden once starred, dismissed or opened, and while gh is being asked', () => {
    expect(starPrompt('ask', enough, 'starred')).toBe('hidden');
    expect(starPrompt('done', enough, 'not-starred')).toBe('hidden');
    expect(starPrompt('ask', enough, null)).toBe('hidden');
  });

  it('waits until there are a few sessions', () => {
    expect(starPrompt('ask', enough - 1, 'not-starred')).toBe('hidden');
    expect(starPrompt('ask', 0, 'unavailable')).toBe('hidden');
  });
});
