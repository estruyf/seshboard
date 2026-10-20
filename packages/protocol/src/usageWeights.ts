import type { TokenCounts } from './usage.ts';

/**
 * How much each token type weighs against the plan, relative to uncached input. How tokens map to plan % isn't
 * published, so these follow how the types are usually priced; every share built on them is an estimate.
 */
export const SHARE_WEIGHTS = { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 } as const;

/** Tokens weighted by `SHARE_WEIGHTS`. */
export const weightOf = (t: TokenCounts) =>
  t.input * SHARE_WEIGHTS.input + t.cacheWrite * SHARE_WEIGHTS.cacheWrite + t.cacheRead * SHARE_WEIGHTS.cacheRead + t.output * SHARE_WEIGHTS.output;

/**
 * Each item's share of the whole, 0–1. Items with a measured share (from plan % deltas) keep it, at most what is
 * left; the rest is split between the others by weight.
 */
export function sharesOf(items: ReadonlyArray<{ key: string; weight: number }>, measured: ReadonlyMap<string, number> = new Map()): Map<string, { share: number; measured: boolean }> {
  const result = new Map<string, { share: number; measured: boolean }>();
  let left = 1;
  for (const item of items) {
    const value = measured.get(item.key);
    if (value === undefined) continue;
    const share = Math.max(0, Math.min(left, value));
    left -= share;
    result.set(item.key, { share, measured: true });
  }
  const rest = items.filter((item) => !result.has(item.key));
  const total = rest.reduce((sum, item) => sum + item.weight, 0);
  for (const item of rest) result.set(item.key, { share: total > 0 ? (item.weight / total) * left : 0, measured: false });
  return result;
}
