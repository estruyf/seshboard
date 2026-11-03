import { useLayoutEffect, useState, type RefObject } from 'react';
import { scrollEdges, type ScrollEdges } from './scrollEdge.ts';

/**
 * Whether a scroller is at its top and at its bottom, for the hairline under a fixed header (`edge-b`)
 * or over a fixed footer (`edge-t`) that shows only while content scrolls beneath it. Follows scrolling,
 * the scroller's resizes and its content's, and re-renders only when one of the two flips, not on every
 * pixel. `key` re-attaches when the scroller is replaced (a list that mounts after a loading state).
 */
export function useScrollEdge(scrollRef: RefObject<HTMLElement | null>, key?: unknown): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>({ atTop: true, atBottom: true });
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const next = scrollEdges(el);
      setEdges((prev) => (prev.atTop === next.atTop && prev.atBottom === next.atBottom ? prev : next));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    // Content that grows or shrinks moves the bottom without a scroll event: watch the scroller and what is in it.
    const resize = new ResizeObserver(update);
    const observe = () => {
      resize.disconnect();
      resize.observe(el);
      for (const child of el.children) resize.observe(child);
      update();
    };
    observe();
    const children = new MutationObserver(observe);
    children.observe(el, { childList: true });
    return () => {
      el.removeEventListener('scroll', update);
      resize.disconnect();
      children.disconnect();
    };
  }, [scrollRef, key]);
  return edges;
}
