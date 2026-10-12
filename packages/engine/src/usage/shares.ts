import type { TokenCounts } from '@switchboard/protocol';

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

/** A plan % reading: a /usage result (no session) or a rate-limit update during a session's turn. */
export interface PlanSample {
  at: number;
  percent: number;
  resetsAt: number | null;
  sessionId: string | null;
}

/** When one window's reset times differ by more than this, the readings belong to different windows. */
const SAME_RESET_MS = 120_000;

/**
 * Plan % points each session measurably used, per session. A rate-limit update during session S's turn, minus the
 * reading before it, is S's own use only when no other session had a response in between; otherwise it is left out
 * and S's share falls back to the token estimate. Readings across a reset are skipped. `samples` are one window's
 * readings, `messages` every response in the scope over the same time; both sorted by time.
 */
export function measuredDeltas(samples: readonly PlanSample[], messages: ReadonlyArray<{ at: number; sessionId: string }>): Map<string, number> {
  const result = new Map<string, number>();
  for (let i = 1; i < samples.length; i++) {
    const sample = samples[i]!;
    const before = samples[i - 1]!;
    if (!sample.sessionId) continue;
    if (sample.resetsAt !== null && before.resetsAt !== null && Math.abs(sample.resetsAt - before.resetsAt) > SAME_RESET_MS) continue;
    const delta = sample.percent - before.percent;
    if (delta < 0) continue;
    const others = messages.some((m) => m.at > before.at && m.at <= sample.at && m.sessionId !== sample.sessionId);
    if (others) continue;
    result.set(sample.sessionId, (result.get(sample.sessionId) ?? 0) + delta);
  }
  return result;
}
