import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Archive, Check } from 'lucide-react';
import { addSample, axisOf, velocity, type Sample } from '../lib/gesture.ts';
import { restingOffset, swipeOffset, swipeOutcome, type SwipeAction } from '../lib/swipe.ts';
import { useReducedMotion } from '../lib/media.ts';

/** The one row with its button out: opening another closes it. */
let closeOpen: (() => void) | null = null;

const LOOK: Record<SwipeAction, { label: string; className: string; icon: ReactNode }> = {
  read: { label: 'Mark as read', className: 'bg-unread text-bg justify-start', icon: <Check className="size-5" aria-hidden /> },
  archive: { label: 'Archive', className: 'bg-faint text-bg justify-end', icon: <Archive className="size-5" aria-hidden /> },
};

/**
 * A session row you can swipe (`lib/swipe.ts`): to the right Mark as read, on the `info` blue with a check; to the left
 * Archive, on a neutral grey with the archive icon. A short swipe leaves the button out, a long one acts at once.
 * Only with a finger: a mouse or the keyboard use the row's menu, which has the same actions. A drag that goes up or
 * down is a scroll and leaves the row alone. `onClickCapture` swallows the click a swipe ends with.
 */
export function SwipeRow({ allowed, onAction, children }: { allowed: Record<SwipeAction, boolean>; onAction: (action: SwipeAction) => void; children: ReactNode }) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; start: number; axis: 'x' | 'y' | null; samples: Sample[]; id: number } | null>(null);
  const swiped = useRef(false);
  const reduced = useReducedMotion();
  const enabled = allowed.read || allowed.archive;

  const close = () => setOffset(0);
  useEffect(() => {
    if (offset === 0) return;
    closeOpen = close;
    return () => {
      if (closeOpen === close) closeOpen = null;
    };
  }, [offset]);

  const onPointerDown = (event: ReactPointerEvent) => {
    if (!enabled || event.pointerType === 'mouse' || !event.isPrimary) return;
    if (closeOpen && offset === 0) closeOpen();
    drag.current = { x: event.clientX, y: event.clientY, start: offset, axis: null, samples: [{ x: event.clientX, t: event.timeStamp }], id: event.pointerId };
    swiped.current = false;
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || event.pointerId !== d.id) return;
    const dx = event.clientX - d.x;
    if (!d.axis) {
      d.axis = axisOf(dx, event.clientY - d.y);
      if (d.axis === 'x') {
        swiped.current = true;
        setDragging(true);
        try {
          row.current?.setPointerCapture(event.pointerId);
        } catch {
          // The pointer is already gone.
        }
      }
    }
    if (d.axis !== 'x') return;
    d.samples = addSample(d.samples, { x: event.clientX, t: event.timeStamp });
    setOffset(swipeOffset(d.start, dx, row.current?.offsetWidth ?? 0, allowed));
  };
  const finish = (event: ReactPointerEvent, cancelled: boolean) => {
    const d = drag.current;
    if (!d || event.pointerId !== d.id) return;
    drag.current = null;
    setDragging(false);
    if (d.axis !== 'x') return;
    if (cancelled) return setOffset(0);
    const width = row.current?.offsetWidth ?? 0;
    const outcome = swipeOutcome(offset, width, velocity(d.samples, event.timeStamp), allowed);
    if (outcome.kind === 'commit') {
      // Archive slides the row away; Mark as read comes back, read.
      setOffset(outcome.action === 'archive' ? -width : 0);
      onAction(outcome.action);
    } else setOffset(restingOffset(outcome));
  };

  // A row that comes back (Undo) or stays (Mark as read) sits closed again.
  useEffect(() => {
    if (!dragging && Math.abs(offset) > 200) {
      const timer = setTimeout(() => setOffset(0), 1_500);
      return () => clearTimeout(timer);
    }
  }, [dragging, offset]);

  const side: SwipeAction | null = offset > 0 ? 'read' : offset < 0 ? 'archive' : null;
  const act = (action: SwipeAction) => {
    setOffset(action === 'archive' ? -(row.current?.offsetWidth ?? 0) : 0);
    onAction(action);
  };
  return (
    <div ref={row} className="relative overflow-hidden" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={(event) => finish(event, false)} onPointerCancel={(event) => finish(event, true)} data-remote-swipe-row>
      {side && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          onClick={() => act(side)}
          className={`absolute inset-0 flex items-center gap-2 px-6 text-ui font-semibold ${LOOK[side].className}`}
          data-remote-swipe-action={side}
        >
          {side === 'read' && LOOK.read.icon}
          <span>{LOOK[side].label}</span>
          {side === 'archive' && LOOK.archive.icon}
        </button>
      )}
      <div
        className={`relative bg-bg ${enabled ? 'touch-pan-y' : ''}`}
        style={{ transform: offset ? `translateX(${offset}px)` : undefined, transition: dragging || reduced ? 'none' : 'transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)' }}
        onClickCapture={(event) => {
          // The click a swipe ends with, or a tap on a row with its button out (which closes it), opens nothing.
          if (swiped.current || offset !== 0) {
            event.preventDefault();
            event.stopPropagation();
            swiped.current = false;
            if (!dragging) close();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
