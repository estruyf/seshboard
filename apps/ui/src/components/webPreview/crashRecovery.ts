/*
 * A page whose process went (`render-process-gone`, often a page parked behind others, ended under memory pressure)
 * loads again by itself, as T3 Code does: after 250, 500, then 1000 ms, at most three times in 30 seconds. Past that
 * it stays stopped, with its notice and Reload.
 */

/** How long ago a stop still counts towards the limit. */
export const CRASH_WINDOW_MS = 30_000;
/** The waits before each reload; as many reloads as waits. */
const DELAYS = [250, 500, 1_000] as const;

/** How long to wait before loading the page again after a stop at `now`, given the stops before it; null: give up. */
export function crashReloadDelay(earlier: readonly number[], now: number): number | null {
  const recent = earlier.filter((at) => now - at < CRASH_WINDOW_MS).length;
  return DELAYS[recent] ?? null;
}
