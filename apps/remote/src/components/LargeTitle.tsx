import { useEffect, useRef, useState, type ReactNode } from 'react';
import { collapseMargin } from '../lib/largeTitle.ts';

/**
 * The first screen's top: the computer's name as a large title, a line under it, and the buttons on the right. Past
 * 40px of scroll the name shrinks into the sticky bar, centred, with a line under the bar. An IntersectionObserver on
 * the large title says when, so nothing runs while the list scrolls.
 *
 * The bar and the title are direct children of the list's scrolling content (a fragment), so the bar sticks for all
 * of it. The title sits in the bar's row (`-mt-11`): until it shrinks, the bar is see-through and lets taps through,
 * except on its buttons and over the safe area, which stays opaque so the title doesn't scroll under the clock.
 */
export function LargeTitle({ title, line, actions }: { title: (size: 'large' | 'compact') => ReactNode; line: ReactNode; actions: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const el = heading.current;
    const scroller = el?.closest<HTMLElement>('[data-remote-scroll]');
    if (!el || !scroller) return;
    let observer: IntersectionObserver | null = null;
    const observe = () => {
      observer?.disconnect();
      const bottom = el.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top + scroller.scrollTop;
      observer = new IntersectionObserver(([entry]) => entry && setCollapsed(!entry.isIntersecting), { root: scroller, rootMargin: collapseMargin(bottom) });
      observer.observe(el);
    };
    observe();
    // Turning the phone changes the safe area, and so where the title sits.
    window.addEventListener('resize', observe);
    return () => {
      window.removeEventListener('resize', observe);
      observer?.disconnect();
    };
  }, []);
  return (
    <>
      <div
        className={`safe-top sticky top-0 z-10 border-b px-2 transition-colors duration-150 before:absolute before:inset-x-0 before:top-0 before:-z-10 before:h-[max(0.75rem,env(safe-area-inset-top))] before:bg-bg motion-reduce:transition-none ${collapsed ? 'border-border bg-bg' : 'pointer-events-none border-transparent'}`}
        data-remote-bar={collapsed ? 'compact' : 'large'}
      >
        <div className="grid h-11 grid-cols-[minmax(5.5rem,1fr)_minmax(0,auto)_minmax(5.5rem,1fr)] items-center">
          <span />
          <div aria-hidden={!collapsed || undefined} className={`flex min-w-0 justify-center transition-[opacity,visibility] duration-150 motion-reduce:transition-none ${collapsed ? 'visible opacity-100' : 'invisible opacity-0'}`}>
            {title('compact')}
          </div>
          <div className="pointer-events-auto flex items-center justify-self-end">{actions}</div>
        </div>
      </div>
      <div className="-mt-11 px-4 pb-1">
        <h1 ref={heading} className="flex h-11 min-w-0 items-center pr-22">
          {title('large')}
        </h1>
        {line}
      </div>
    </>
  );
}
