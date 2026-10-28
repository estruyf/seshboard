import { describe, expect, it } from 'vitest';
import { cacheExpiresAt, cacheRewriteCost, cacheTtlOf, isLargeContext, largeContextTokens } from './contextCache.ts';

describe('cacheTtlOf', () => {
  it('reads which cache a response wrote to', () => {
    expect(cacheTtlOf({ cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 956 } })).toBe('1h');
    expect(cacheTtlOf({ cache_creation: { ephemeral_5m_input_tokens: 12, ephemeral_1h_input_tokens: 0 } })).toBe('5m');
  });

  it('is null when it wrote nothing or the usage says nothing', () => {
    expect(cacheTtlOf({ cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } })).toBeNull();
    expect(cacheTtlOf({})).toBeNull();
    expect(cacheTtlOf(null)).toBeNull();
  });
});

describe('cacheRewriteCost', () => {
  it('prices writing the context again: 1.25 times input for 5 minutes, twice for the hour', () => {
    expect(cacheRewriteCost(400_000, 'claude-opus-5-5', '1h')).toBeCloseTo(3.2);
    expect(cacheRewriteCost(400_000, 'claude-opus-5-5', '5m')).toBeCloseTo(2);
    expect(cacheRewriteCost(1, 'gpt-4', '1h')).toBeNull();
  });

  it('knows when the cache lapses', () => {
    expect(cacheExpiresAt(1_000, '5m')).toBe(301_000);
    expect(cacheExpiresAt(0, '1h')).toBe(3_600_000);
  });
});

describe('largeContextTokens', () => {
  it('reads the percentage as a share of a 200k window', () => {
    expect(largeContextTokens({ percent: 60 })).toBe(120_000);
    expect(largeContextTokens({ percent: 40 })).toBe(80_000);
    expect(largeContextTokens({ percent: 95 })).toBe(190_000);
  });
});

describe('isLargeContext', () => {
  const on = { enabled: true, percent: 60 };

  it('counts tokens, whatever the size of the window', () => {
    expect(isLargeContext(384_000, on)).toBe(true);
    expect(isLargeContext(120_000, on)).toBe(true);
    expect(isLargeContext(100_000, on)).toBe(false);
  });

  it('is false when the warning is off or the size is unknown', () => {
    expect(isLargeContext(384_000, { ...on, enabled: false })).toBe(false);
    expect(isLargeContext(null, on)).toBe(false);
    expect(isLargeContext(undefined, on)).toBe(false);
  });
});
