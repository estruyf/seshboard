/**
 * When the first screen's large title shrinks into its bar. Pure, with tests.
 */

/** How far the list scrolls before the title shrinks into the bar. */
export const COLLAPSE_AT = 40;

/**
 * The IntersectionObserver's `rootMargin` for the large title: the top of the list, moved down so that the title
 * leaves it once the list scrolled `at` pixels. `bottom` is where the title's bottom edge is in the list before it
 * scrolls (under the safe area and the bar's padding).
 */
export function collapseMargin(bottom: number, at = COLLAPSE_AT): string {
  return `${-Math.max(0, Math.round(bottom - at))}px 0px 0px 0px`;
}
