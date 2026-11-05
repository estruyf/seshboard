/**
 * The patch panel's working light (plain TypeScript, no zod): the order the free jacks light up in, how long a round
 * takes and how far the tail reaches. The Dock's animation (`apps/desktop/src/main/dockActivity.ts`) and the
 * `WorkingPanel` mark under replies (the app and the phone) both read these, so "working" moves the same everywhere.
 */

/** The panel is a 3×3 grid of jacks (`apps/desktop/build/icon.svg`). */
export const PANEL_SIZE = 3;

/**
 * The free jacks in the order the light visits them, as cells of the grid read row by row (0 is top left, 8 bottom
 * right): top middle, top right, middle left, centre, bottom right.
 */
export const FREE_JACK_CELLS: readonly number[] = [1, 2, 3, 4, 8];

/** One round of the light over the five free jacks. */
export const WORKING_ROUND_MS = 1500;

/** How many jacks the light's tail reaches back over: the lit jack is full, and the two before it fade. */
export const WORKING_TAIL = 2.4;

/** How lit every free jack is in the still frame (Reduce motion, Compacting). */
export const WORKING_STILL_LEVEL = 0.8;

/** The share of a round a free jack stays full under a reply: one jack's turn, until the light moves on (0–1). */
export const WORKING_HOLD = 1 / FREE_JACK_CELLS.length;

/** The share of a round after which a free jack is dark again: the end of the tail (0–1). */
export const WORKING_FADE = WORKING_TAIL / FREE_JACK_CELLS.length;

/** A jack's row and column in the grid. */
export function jackCell(cell: number): { row: number; col: number } {
  return { row: Math.floor(cell / PANEL_SIZE), col: cell % PANEL_SIZE };
}

/**
 * The `animation-delay` (ms, zero or negative) that puts free jack `index` in its place in the round, for an animation
 * that starts at `startedAt` on the page's clock (`performance.now()`). Every instance then shows the same frame at the
 * same moment, however late it was mounted.
 */
export function jackDelayMs(index: number, startedAt: number): number {
  const offset = (index / FREE_JACK_CELLS.length) * WORKING_ROUND_MS;
  const elapsed = (((startedAt - offset) % WORKING_ROUND_MS) + WORKING_ROUND_MS) % WORKING_ROUND_MS;
  return elapsed === 0 ? 0 : -elapsed;
}
