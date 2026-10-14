import { useLayoutEffect, useState, type RefObject } from 'react';

/** An element's height, following resizes (null until it has been measured). */
export function useHeight(ref: RefObject<HTMLElement | null>): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setHeight(el.getBoundingClientRect().height);
    const observer = new ResizeObserver(([entry]) => setHeight(entry!.contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return height;
}
