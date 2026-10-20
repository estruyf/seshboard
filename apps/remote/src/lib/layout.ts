/**
 * Which layout a screen gets. Pure, with tests; `useLayout` in `media.ts` reads the window's size.
 *
 * - `phone`: one view at a time, the sessions in a drawer. A phone in landscape (about 844 by 390) stays here: the
 *   sidebar would leave the session a sliver of height.
 * - `wide`: the sessions in a sidebar next to the open one, as on the computer (an iPad, a computer's browser).
 *
 * Below `FOLD_BELOW` (an iPad in portrait) the sidebar can fold away, and then it is the phone's drawer.
 */

/** Wide from this width and this height on, both. */
export const WIDE_MIN_WIDTH = 768;
export const WIDE_MIN_HEIGHT = 600;
/** Narrower than this, a wide screen's sidebar can fold away. */
export const FOLD_BELOW = 1024;

/** The media query for the wide layout, kept next to the rule it mirrors. */
export const WIDE_QUERY = `(min-width: ${WIDE_MIN_WIDTH}px) and (min-height: ${WIDE_MIN_HEIGHT}px)`;
/** The media query for a wide screen whose sidebar can fold. */
export const FOLDABLE_QUERY = `${WIDE_QUERY} and (max-width: ${FOLD_BELOW - 0.02}px)`;

export interface Layout {
  /** The sidebar next to the open session. */
  wide: boolean;
  /** Wide, but narrow enough that the sidebar can fold away into the drawer. */
  foldable: boolean;
}

export function layoutFor(size: { width: number; height: number }): Layout {
  const wide = size.width >= WIDE_MIN_WIDTH && size.height >= WIDE_MIN_HEIGHT;
  return { wide, foldable: wide && size.width < FOLD_BELOW };
}
