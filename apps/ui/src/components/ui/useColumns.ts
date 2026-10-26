import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { columnsFor } from '../newSession/projectTiles.ts';

/**
 * How many columns a container query with these breakpoints shows for an element: one, plus one for each breakpoint
 * its width reaches. The CSS lays out the grid; this only tells the code how many columns there are (for counts and
 * arrow keys), so the two must use the same breakpoints. It follows the element when another one takes the ref (a
 * list that is swapped for a form and back).
 */
export function useColumns(ref: RefObject<HTMLElement | null>, breakpoints: readonly number[]): number {
  const [columns, setColumns] = useState(1);
  const observed = useRef<{ el: HTMLElement; observer: ResizeObserver } | null>(null);
  const breaks = useRef(breakpoints);
  breaks.current = breakpoints;
  // After every render, but it only does something when the element changed: a cheap comparison.
  useLayoutEffect(() => {
    const el = ref.current;
    if (observed.current?.el === el) return;
    observed.current?.observer.disconnect();
    observed.current = null;
    if (!el) return;
    const measure = (width: number) => setColumns(columnsFor(width, breaks.current));
    // The content box, as a container query measures it.
    const style = getComputedStyle(el);
    measure(el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
    const observer = new ResizeObserver(([entry]) => measure(entry!.contentRect.width));
    observer.observe(el);
    observed.current = { el, observer };
  });
  useLayoutEffect(
    () => () => {
      observed.current?.observer.disconnect();
      observed.current = null;
    },
    [],
  );
  return columns;
}
