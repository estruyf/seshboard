import { priceOf } from './costEstimate.ts';

/**
 * Anthropic's prompt cache keeps a conversation's context for a while after its last request: 5 minutes or an hour,
 * whichever Claude Code asked for (the transcript says, per response). Every request that reads it starts that time
 * again. Once it lapses, the next message writes the whole context to the cache again, at the cache write price
 * instead of the much lower read price. Open or closed app makes no difference: only the time since the last request.
 */
export type CacheTtl = '5m' | '1h';

export const CACHE_TTL_MS: Record<CacheTtl, number> = { '5m': 5 * 60_000, '1h': 60 * 60_000 };

/** A cache write's price as a multiple of the input price: 1.25 for the 5-minute cache, 2 for the hour. */
export const CACHE_WRITE_FACTOR: Record<CacheTtl, number> = { '5m': 1.25, '1h': 2 };

/** Which cache a response wrote to, from its `usage.cache_creation` (null when it wrote nothing, or says nothing). */
export function cacheTtlOf(usage: { cache_creation?: unknown } | null | undefined): CacheTtl | null {
  const split = usage?.cache_creation as { ephemeral_1h_input_tokens?: unknown; ephemeral_5m_input_tokens?: unknown } | null | undefined;
  if (!split || typeof split !== 'object') return null;
  if (typeof split.ephemeral_1h_input_tokens === 'number' && split.ephemeral_1h_input_tokens > 0) return '1h';
  if (typeof split.ephemeral_5m_input_tokens === 'number' && split.ephemeral_5m_input_tokens > 0) return '5m';
  return null;
}

/** When a cache last used at `at` lapses. */
export const cacheExpiresAt = (at: number, ttl: CacheTtl): number => at + CACHE_TTL_MS[ttl];

/** What writing `tokens` of context to the cache again costs at the model's list price, in US dollars; null for an unknown model. */
export function cacheRewriteCost(tokens: number, model: string, ttl: CacheTtl): number | null {
  const p = priceOf(model);
  return p ? (tokens * p.input * CACHE_WRITE_FACTOR[ttl]) / 1_000_000 : null;
}
