import { cacheExpiresAt, isLargeContext, priceOf, type CacheTtl, type ContextWarningPrefs, type ModelOption, type SessionHostInfo, type TranscriptMessage } from '@seshboard/protocol/client';
import { findModelOption } from '../../lib/models.ts';
import { HIGH_AT, levelOf, type Level } from '../../lib/levels.ts';

/**
 * A session's context is "large" from the token count that Settings › Usage › Large from stands for (a share of a 200k
 * window, `largeContextTokens` in `@seshboard/protocol`): its ring turns orange there, and the
 * session says when its prompt cache lapses (`@seshboard/protocol` `contextCache.ts`).
 */

/** 46k, 1.2M. */
export const compactTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}k` : String(n));

/** When the conversation last used the prompt cache, and for how long the cache keeps it. */
export interface CacheUse {
  at: number;
  ttl: CacheTtl;
}

/**
 * The context ring's level: orange once the tokens are large (`isLargeContext`), red from the warning's percentage of
 * the real window (85% at least). With the warning off, the usual levels.
 */
export function contextLevel(percent: number, tokens: number, warning: ContextWarningPrefs): Level {
  if (!warning.enabled) return levelOf(percent);
  if (Number.isFinite(percent) && percent >= Math.max(HIGH_AT, warning.percent)) return 'high';
  return isLargeContext(tokens, warning) ? 'caution' : 'ok';
}

/**
 * The cache from the transcript: the last reply that read or wrote it (subagents have their own), and the cache it
 * last wrote to. Null when the transcript doesn't say which cache (older Claude Code) or nothing used one.
 */
export function transcriptCache(messages: readonly TranscriptMessage[]): CacheUse | null {
  let at: number | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'assistant' || m.parentToolUseId !== null || !m.usage) continue;
    if (at === null && m.timestamp !== null && m.usage.cacheRead + m.usage.cacheCreation > 0) at = m.timestamp;
    if (at !== null && m.usage.cacheTtl) return { at, ttl: m.usage.cacheTtl };
  }
  return null;
}

/** The latest of what the running session reported and what its transcript says. */
export function cacheUseOf(host: Pick<SessionHostInfo, 'cacheAt' | 'cacheTtl'> | null | undefined, messages: readonly TranscriptMessage[]): CacheUse | null {
  const fromTranscript = transcriptCache(messages);
  const live = host?.cacheAt != null && host.cacheTtl ? { at: host.cacheAt, ttl: host.cacheTtl } : null;
  if (!live) return fromTranscript;
  return !fromTranscript || live.at >= fromTranscript.at ? live : fromTranscript;
}

/** Where the cache stands now: still kept (and until when), lapsed (and since when), or unknown. */
export type CacheState = { kind: 'warm'; expiresAt: number } | { kind: 'cold'; since: number } | { kind: 'unknown' };

export function cacheState(use: CacheUse | null, now: number): CacheState {
  if (!use) return { kind: 'unknown' };
  const expiresAt = cacheExpiresAt(use.at, use.ttl);
  return now < expiresAt ? { kind: 'warm', expiresAt } : { kind: 'cold', since: expiresAt };
}

/** "48 min", "under a minute": how long until the cache lapses. */
export function untilText(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  return minutes < 1 ? 'under a minute' : `${minutes} min`;
}

/** "3 min", "2 h", "4 days": how long ago the cache lapsed. */
export function agoText(ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}

/** An open session with a large context, for the quit prompt. */
export interface LargeSession {
  sessionId: string;
  tokens: number;
  /** What reading it all again costs at API prices (null: unknown model or cache). */
  usd: number | null;
  ttl: CacheTtl | null;
}

/** The sessions running here whose context is large, largest first. */
export function largeSessions(hosts: Iterable<SessionHostInfo>, warning: ContextWarningPrefs, rewriteCost: (tokens: number, model: string, ttl: CacheTtl) => number | null): LargeSession[] {
  const out: LargeSession[] = [];
  for (const h of hosts) {
    if (h.state === 'closed' || h.state === 'error' || !h.contextTokens || !h.contextMax) continue;
    if (!isLargeContext(h.contextTokens, warning)) continue;
    const ttl = h.cacheTtl ?? null;
    out.push({ sessionId: h.sessionId, tokens: h.contextTokens, ttl, usd: ttl && h.model ? rewriteCost(h.contextTokens, h.model, ttl) : null });
  }
  return out.sort((a, b) => b.tokens - a.tokens);
}

/**
 * The quit prompt's sentence about them: "2 open sessions have a large context (412k and 180k tokens). Their cache
 * lapses within the hour, so picking them up later reads all of it again (≈$4.64)."
 */
export function largeSessionsText(large: readonly LargeSession[], format: ((usd: number) => string) | null): string | null {
  if (large.length === 0) return null;
  const one = large.length === 1;
  const sizes = large.map((s) => compactTokens(s.tokens));
  const list = sizes.length <= 2 ? sizes.join(' and ') : `${sizes.slice(0, -1).join(', ')} and ${sizes.at(-1)}`;
  const known = large.filter((s) => s.usd !== null);
  const cost = format && known.length > 0 ? ` (${format(known.reduce((sum, s) => sum + s.usd!, 0))})` : '';
  const within = large.some((s) => s.ttl === '1h') ? 'within the hour' : large.some((s) => s.ttl === '5m') ? 'within minutes' : 'soon after its last message';
  return `${one ? 'One open session has' : `${large.length} open sessions have`} a large context (${list} tokens). ${one ? 'Its cache lapses' : 'Their caches lapse'} ${within}, so picking ${one ? 'it' : 'them'} up later reads all of it again${cost}.`;
}

/**
 * The model the next message goes to, for pricing it: what the model chip shows (`chosen`; null is Claude Code's
 * default, undefined is not known), then each fallback. An alias like `sonnet` or `default` becomes the full id it
 * resolves to, since only a full id can be priced. The first one that has a price wins.
 */
export function nextMessageModel(chosen: string | null | undefined, models: readonly ModelOption[], fallbacks: ReadonlyArray<string | null | undefined>): string | null {
  const candidates = [...(chosen === undefined ? [] : [chosen ?? 'default']), ...fallbacks.filter((f): f is string => typeof f === 'string' && f !== '')];
  for (const candidate of candidates) {
    const resolved = findModelOption([...models], candidate)?.resolvedModel ?? candidate;
    if (priceOf(resolved)) return resolved;
  }
  return null;
}
