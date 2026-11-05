/** Where a scroller is: at its top, at its bottom, both (nothing to scroll) or neither (in the middle). */
export interface ScrollEdges {
  atTop: boolean;
  atBottom: boolean;
}

/** What `scrollEdges` reads from a scrolling element (an `HTMLElement` has all three). */
export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * Whether a scroller sits at its top or bottom edge. `slack` absorbs the fractional pixels of zoomed
 * and high-density screens, where a scroller at the bottom can stop half a pixel short of it.
 */
export function scrollEdges({ scrollTop, scrollHeight, clientHeight }: ScrollMetrics, slack = 1): ScrollEdges {
  return {
    atTop: scrollTop <= slack,
    atBottom: scrollTop + clientHeight >= scrollHeight - slack,
  };
}
