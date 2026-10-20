/**
 * What a finger is doing, for the drawer, pull to refresh and the swipe on a row. Pure, with tests.
 */

/** How far a finger moves before its direction counts: less is a tap, or a shaky one. */
export const SLOP = 8;
/** Mostly sideways: the horizontal distance is at least this many times the vertical one. */
export const HORIZONTAL = 1.5;

export type Axis = 'x' | 'y';

/** The direction a drag takes, once it has moved `SLOP`: sideways only when mostly so, else up or down (a scroll). */
export function axisOf(dx: number, dy: number): Axis | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SLOP) return null;
  return Math.abs(dx) >= Math.abs(dy) * HORIZONTAL ? 'x' : 'y';
}

export interface Sample {
  x: number;
  t: number;
}

/** Only the last stretch of a drag says how fast it was let go. */
const WINDOW_MS = 100;

/**
 * Pixels per millisecond along x when the finger lifted at `at` (by default its last move), from the samples of the
 * last 100ms: 0 when it had stopped before it lifted.
 */
export function velocity(samples: readonly Sample[], at?: number): number {
  const last = samples.at(-1);
  if (!last) return 0;
  const end = at ?? last.t;
  const recent = samples.filter((s) => end - s.t <= WINDOW_MS);
  if (recent.length < 2) return 0;
  const first = recent[0]!;
  const dt = recent.at(-1)!.t - first.t;
  return dt > 0 ? (recent.at(-1)!.x - first.x) / dt : 0;
}

/** Keeps the samples of the last stretch only, so a long drag doesn't grow the list. */
export function addSample(samples: readonly Sample[], sample: Sample): Sample[] {
  return [...samples.filter((s) => sample.t - s.t <= WINDOW_MS), sample];
}
