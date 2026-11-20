import { useLayoutEffect, useState, type RefObject } from 'react';
import { contentWidthOf, newSessionLayout, type NewSessionMode } from './newSessionLayout.ts';

/** Which layout the view's width gets, read before the first paint and on every resize (the sidebar and side panels count). */
export function useNewSessionMode(view: RefObject<HTMLElement | null>): NewSessionMode {
  const [mode, setMode] = useState<NewSessionMode>('stack');
  useLayoutEffect(() => {
    const el = view.current;
    if (!el) return;
    const measure = (width: number) => setMode(newSessionLayout(contentWidthOf(width)).mode);
    measure(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => measure(entry!.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [view]);
  return mode;
}
