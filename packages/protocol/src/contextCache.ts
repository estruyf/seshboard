import type { ContextWarningPrefs } from './bridge.ts';
import { priceOf } from './costEstimate.ts';

/**
 * Anthropic's prompt cache keeps a conversation's context for a while after its last request: 5 minutes or an hour,
 * whichever Claude Code asked for (the transcript says, per response). Every request that reads it starts that time
 * again. Once it lapses, the next message writes the whole context to the cache again, at the cache write price
 * instead of the much lower read price. Open or closed app makes no difference: only the time since the last request.
 */
export type CacheTtl = '5m' | '1h';

export const CACHE_TTL_MS: Record<CacheTtl, number> = { '5m': 5 * 60_000, '1h': 60 * 60_000 };

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
  return p ? (tokens * (ttl === '1h' ? p.cacheWrite1h : p.cacheWrite)) / 1_000_000 : null;
}

/** The window the "Large from" percentage is read against. */
const LARGE_CONTEXT_WINDOW = 200_000;

/**
 * From how many tokens a context counts as large: the preference's percentage of a 200k window (60% is 120k). It is
 * a token count, not a share of the session's own window, because what the notice, the reminder and the quit prompt
 * are about is what reading the context again costs, and that grows with tokens: 384k costs the same on a 200k or a
 * 1M window.
 */
export const largeContextTokens = (prefs: Pick<ContextWarningPrefs, 'percent'>): number => Math.round((prefs.percent / 100) * LARGE_CONTEXT_WINDOW);

/** Whether a context of `tokens` is large under the preference; false when the warning is off or the size is unknown. */
export const isLargeContext = (tokens: number | null | undefined, prefs: Pick<ContextWarningPrefs, 'enabled' | 'percent'>): boolean => prefs.enabled && tokens != null && tokens >= largeContextTokens(prefs);
