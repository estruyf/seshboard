import { describe, expect, it } from 'vitest';
import { composerSummary, minimalAlert } from './minimalComposer.ts';

describe('composerSummary', () => {
  it('reads model · mode · profile', () => {
    expect(composerSummary({ model: 'Sonnet 5.5', mode: 'Auto', profile: 'Work' })).toBe('Sonnet 5.5 · Auto · Work');
  });

  it('leaves out what is missing', () => {
    expect(composerSummary({ model: 'Opus 5.5', mode: 'Ask', profile: null })).toBe('Opus 5.5 · Ask');
    expect(composerSummary({ model: 'Opus 5.5', mode: ' ' })).toBe('Opus 5.5');
  });
});

describe('minimalAlert', () => {
  it('stays quiet under 80%', () => {
    expect(minimalAlert(79, [{ label: '5h', percent: 50 }])).toBeNull();
    expect(minimalAlert(null)).toBeNull();
  });

  it('says what passed 80%', () => {
    expect(minimalAlert(84.4, [{ label: '5h', percent: 91 }, { label: 'Week', percent: 20 }])).toBe('Context 84% full · 5h 91% used');
    expect(minimalAlert(10, [{ label: 'Premium', percent: 80 }])).toBe('Premium 80% used');
  });
});
