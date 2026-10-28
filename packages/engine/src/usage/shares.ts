import { SHARE_WEIGHTS, sharesOf, weightOf } from '@seshboard/protocol';

// The weights and the split live in the protocol, so the Usage view weighs other computers' tokens the same way.
export { SHARE_WEIGHTS, sharesOf, weightOf };

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
