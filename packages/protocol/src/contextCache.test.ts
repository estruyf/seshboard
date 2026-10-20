import { describe, expect, it } from 'vitest';
import { cacheExpiresAt, cacheRewriteCost, cacheTtlOf } from './contextCache.ts';

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
