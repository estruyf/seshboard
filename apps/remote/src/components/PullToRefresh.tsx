import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { SLOP } from '../lib/gesture.ts';
import { pullLabel, pullOffset, pullPhase, pullStarts, REFRESHING_OFFSET } from '../lib/pull.ts';

/** The spinner stays this long at least, so a quick answer still reads as a refresh. */
const MIN_SPIN_MS = 500;

/**
 * A scrolling list you pull down at its top to refresh (`lib/pull.ts`): "Pull to refresh", "Release to refresh" past
 * 64px, then a spinner while `onRefresh` runs. A Home Screen app has no reload button, and `overscroll-contain` keeps
 * the browser's own pull from reloading the page, so the pull is done here. Touch only. With `update`, a newer remote
 * app is on the site: it says Release to update, and `onRefresh` reloads the app.
 */
export function PullToRefresh({ onRefresh, update = false, disabled = false, className = '', onScroll, children, ...rest }: { onRefresh: () => Promise<unknown>; update?: boolean; disabled?: boolean; className?: string; /** Where the list is scrolled to (the floating New session button). */ onScroll?: (top: number) => void; children: ReactNode } & Record<`data-${string}` | `aria-${string}`, unknown>) {
  const scroller = useRef<HTMLDivElement>(null);
  const [dy, setDy] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef({ onRefresh, disabled, refreshing, update });
  latest.current = { onRefresh, disabled, refreshing, update };

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let start: { x: number; y: number } | null = null;
    let pulling = false;
    let distance = 0;
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      // Offline the list can't refresh, but a newer app can still load.
      if (event.touches.length !== 1 || !touch || (latest.current.disabled && !latest.current.update) || latest.current.refreshing || el.scrollTop > 0) return;
      start = { x: touch.clientX, y: touch.clientY };
      pulling = false;
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!start || !touch) return;
      const dx = touch.clientX - start.x;
      const down = touch.clientY - start.y;
      if (!pulling) {
        if (Math.max(Math.abs(dx), Math.abs(down)) < SLOP) return;
        if (!pullStarts(el.scrollTop, down, dx)) {
          start = null;
          return;
        }
        pulling = true;
      }
      // The list stays put while it is pulled: the indicator moves instead.
      if (event.cancelable) event.preventDefault();
      distance = Math.max(0, down);
      setDy(distance);
    };
    const onEnd = () => {
      if (!start) return;
      const pulled = pulling && pullPhase(distance, false) === 'release';
      start = null;
      pulling = false;
      distance = 0;
      setDy(0);
      if (!pulled) return;
      setRefreshing(true);
      const started = Date.now();
      void latest.current
        .onRefresh()
        .catch(() => {})
        .then(() => new Promise((resolve) => setTimeout(resolve, Math.max(0, MIN_SPIN_MS - (Date.now() - started)))))
        .then(() => setRefreshing(false));
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    // Not passive: a pull takes the move from the scroll.
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  const phase = pullPhase(dy, refreshing);
  const offset = refreshing ? REFRESHING_OFFSET : pullOffset(dy);
  const dragging = dy > 0;
  return (
    <div ref={scroller} className={`relative overflow-y-auto overscroll-contain ${className}`} onScroll={onScroll && ((event) => onScroll(event.currentTarget.scrollTop))} data-remote-scroll {...rest}>
      <div aria-live="polite" className="pointer-events-none absolute inset-x-0 top-0 flex items-end justify-center overflow-hidden text-meta text-muted" style={{ height: offset }} data-remote-pull={phase}>
        {phase === 'refreshing' ? (
          <span className="flex h-11 items-center">
            <LoaderCircle className="size-4 animate-spin text-faint" aria-hidden />
            <span className="sr-only">{pullLabel('refreshing', update)}</span>
          </span>
        ) : (
          phase !== 'idle' && <span className="flex h-11 items-center">{pullLabel(phase, update)}</span>
        )}
      </div>
      <div className={dragging ? '' : 'pull-settle'} style={offset ? { transform: `translateY(${offset}px)` } : undefined}>
        {children}
      </div>
    </div>
  );
}
