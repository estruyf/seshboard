import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { middleEllipsis } from '../../lib/format.ts';

/**
 * A one-line name that is cut in the middle when it overflows its element, keeping the start and the end. It measures
 * (`scrollWidth > clientWidth`) only when the element changes size or the name changes, and picks the longest cut that
 * fits. Put the ref on a `truncate` element whose width doesn't follow its text (a grid or flex child with `min-w-0`).
 */
export function useMiddleEllipsis<T extends HTMLElement>(name: string): { ref: RefObject<T | null>; text: string } {
  const ref = useRef<T>(null);
  const [text, setText] = useState(name);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      // The element's text is set directly while measuring, and left as the answer, so React's render agrees with it.
      const fits = (value: string) => {
        el.textContent = value;
        return el.scrollWidth <= el.clientWidth;
      };
      let best = name;
      if (el.clientWidth > 0 && !fits(name)) {
        let low = 1;
        let high = name.length - 1;
        best = middleEllipsis(name, 1);
        while (low <= high) {
          const mid = (low + high) >> 1;
          if (fits(middleEllipsis(name, mid))) (best = middleEllipsis(name, mid)), (low = mid + 1);
          else high = mid - 1;
        }
      }
      el.textContent = best;
      setText(best);
    };
    fit();
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [name]);
  return { ref, text };
}
