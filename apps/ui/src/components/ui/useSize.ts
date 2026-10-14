import { useLayoutEffect, useState, type RefObject } from 'react';

/** An element's width and height, following resizes (null until it has been measured). */
export function useSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (width: number, height: number) => setSize((s) => (s && s.width === width && s.height === height ? s : { width, height }));
    const rect = el.getBoundingClientRect();
    update(rect.width, rect.height);
    const observer = new ResizeObserver(([entry]) => update(entry!.contentRect.width, entry!.contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
