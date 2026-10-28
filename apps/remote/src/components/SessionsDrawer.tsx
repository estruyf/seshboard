import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type TouchEvent as ReactTouchEvent } from 'react';
import { dragPosition, drawerLabel, drawerWidth, settle, startsEdgeSwipe } from '../lib/drawer.ts';
import { addSample, axisOf, velocity, type Sample } from '../lib/gesture.ts';
import { useFinePointer, useReducedMotion } from '../lib/media.ts';
import { useOverlayHistory } from './overlayHistory.ts';
import { MenuIcon, RoundButton } from './ui.tsx';

/** How long the drawer takes to slide, and what is waited for before it leaves the page. */
const SLIDE_MS = 220;

/** Focus going back to the drawer button, a frame after it closed: a drawer that opens again first keeps it. */
let refocus = 0;

/**
 * The round menu button at the top left of every screen in drawer mode (a phone, or a wide screen whose sidebar
 * folded away): it opens the drawer, with a pink badge for what needs you elsewhere ("Sessions, 2 need you", else
 * "Menu").
 */
export function DrawerButton({ needsYou, onOpen }: { needsYou: number; onOpen: () => void }) {
  return (
    <RoundButton
      onClick={onOpen}
      aria-label={drawerLabel(needsYou)}
      aria-haspopup="dialog"
      data-remote-drawer-button
      data-remote-menu-button
      badge={
        needsYou > 0 && (
          <span aria-hidden className="absolute top-0 right-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-warn px-1 text-[10px] leading-none font-semibold text-bg tabular-nums ring-2 ring-bg" data-remote-drawer-badge>
            {needsYou}
          </span>
        )
      }
    >
      <MenuIcon />
    </RoundButton>
  );
}

/**
 * Follows an edge swipe (`lib/drawer.ts`): a finger that starts within 20px of the left edge and goes mostly right
 * drags the drawer out; let go, it snaps open or closed. `onDrag` gets how far it is open (px), null when the finger
 * lifts. Only while `enabled` (a screen with the drawer, closed).
 */
export function useEdgeSwipe({ enabled, onDrag, onSettle }: { enabled: boolean; onDrag: (position: number | null) => void; onSettle: (open: boolean) => void }) {
  const latest = useRef({ onDrag, onSettle });
  latest.current = { onDrag, onSettle };
  useEffect(() => {
    if (!enabled) return;
    let start: { x: number; y: number } | null = null;
    let axis: 'x' | 'y' | null = null;
    let samples: Sample[] = [];
    let dx = 0;
    const width = () => drawerWidth(window.innerWidth);
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (event.touches.length !== 1 || !touch || !startsEdgeSwipe(touch.clientX)) return;
      start = { x: touch.clientX, y: touch.clientY };
      axis = null;
      dx = 0;
      samples = [{ x: touch.clientX, t: event.timeStamp }];
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!start || !touch) return;
      dx = touch.clientX - start.x;
      if (!axis) {
        axis = axisOf(dx, touch.clientY - start.y);
        if (axis === 'y' || (axis === 'x' && dx < 0)) {
          start = null;
          return;
        }
      }
      if (axis !== 'x') return;
      if (event.cancelable) event.preventDefault();
      samples = addSample(samples, { x: touch.clientX, t: event.timeStamp });
      latest.current.onDrag(dragPosition('closed', dx, width()));
    };
    const onEnd = (event: TouchEvent) => {
      if (!start) return;
      const swiped = axis === 'x';
      start = null;
      latest.current.onDrag(null);
      if (swiped) latest.current.onSettle(settle('closed', dx, velocity(samples, event.timeStamp)) === 'open');
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, [enabled]);
}

/**
 * The drawer ("Menu"): 86% of the width, over the screen, on a 55% scrim. It closes with a tap on the scrim, a swipe
 * left, Escape, the back gesture (it adds a history entry while open, as sheets do) or picking a session. It follows
 * the finger, then snaps; with reduced motion it doesn't slide. A `dialog` with `aria-modal`: Tab stays inside, focus
 * goes to the search (with a keyboard, or opened from a search button; otherwise on a touch screen to the drawer, so
 * the keyboard doesn't come up over the list) and back to what opened it once it closes.
 *
 * `edge` is how far an edge swipe has pulled it out while the finger is still down (null otherwise).
 */
export function SessionsDrawer({ open, edge, onClose, focusSearch = false, children }: { open: boolean; edge: number | null; onClose: () => void; /** Opened from a search button: the search takes the focus, on a touch screen too. */ focusSearch?: boolean; children: ReactNode }) {
  const [screen, setScreen] = useState(() => window.innerWidth);
  const width = drawerWidth(screen);
  const visible = open || edge !== null;
  const [mounted, setMounted] = useState(visible);
  /** In at its closed place for a frame, so opening slides. */
  const [placed, setPlaced] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const onResize = () => setScreen(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useLayoutEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    setPlaced(false);
    if (!mounted) return;
    const timer = setTimeout(() => setMounted(false), reduced ? 0 : SLIDE_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  useEffect(() => {
    if (!mounted || !visible) return;
    const frame = requestAnimationFrame(() => setPlaced(true));
    return () => cancelAnimationFrame(frame);
  }, [mounted, visible]);

  if (!mounted) return null;

  // How far it is open, in px: the edge swipe, a drag to close, or where it rests.
  const position = edge ?? drag ?? (open && placed ? width : 0);
  const following = edge !== null || drag !== null;
  const transition = following || reduced ? 'none' : `transform ${SLIDE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity ${SLIDE_MS}ms ease-out`;
  return (
    <div className="fixed inset-0 z-40" data-remote-drawer={open ? 'open' : 'closed'}>
      <div aria-hidden className="absolute inset-0 bg-black" style={{ opacity: (0.55 * position) / width, transition }} onClick={onClose} />
      <DrawerPanel width={width} position={position} transition={transition} open={open} focusSearch={focusSearch} onClose={onClose} onDrag={setDrag}>
        {children}
      </DrawerPanel>
    </div>
  );
}

function DrawerPanel({ width, position, transition, open, focusSearch, onClose, onDrag, children }: { width: number; position: number; transition: string; open: boolean; focusSearch: boolean; onClose: () => void; onDrag: (position: number | null) => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const fine = useFinePointer();
  const gesture = useRef<{ x: number; y: number; axis: 'x' | 'y' | null; samples: Sample[]; dx: number } | null>(null);

  // Focus in when it opens, back to what opened it (the menu or the search button) when it closes.
  useEffect(() => {
    if (!open) return;
    cancelAnimationFrame(refocus);
    const before = document.activeElement as HTMLElement | null;
    const search = panel.current?.querySelector<HTMLElement>('[data-remote-search]');
    ((fine || focusSearch) && search ? search : panel.current)?.focus({ preventScroll: true });
    return () => {
      refocus = requestAnimationFrame(() => {
        const button = document.querySelector<HTMLElement>('[data-remote-drawer-button]');
        (before?.isConnected && before !== document.body ? before : button)?.focus({ preventScroll: true });
      });
    };
  }, [open, fine]);

  const onTouchStart = (event: ReactTouchEvent) => {
    const touch = event.touches[0];
    if (!open || event.touches.length !== 1 || !touch) return;
    gesture.current = { x: touch.clientX, y: touch.clientY, axis: null, samples: [{ x: touch.clientX, t: event.timeStamp }], dx: 0 };
  };
  const onTouchMove = (event: ReactTouchEvent) => {
    const g = gesture.current;
    const touch = event.touches[0];
    if (!g || !touch) return;
    g.dx = touch.clientX - g.x;
    if (!g.axis) g.axis = axisOf(g.dx, touch.clientY - g.y);
    if (g.axis !== 'x') return;
    g.samples = addSample(g.samples, { x: touch.clientX, t: event.timeStamp });
    onDrag(dragPosition('open', g.dx, width));
  };
  const onTouchEnd = (event: ReactTouchEvent) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.axis !== 'x') return;
    onDrag(null);
    if (settle('open', g.dx, velocity(g.samples, event.timeStamp)) === 'closed') onClose();
  };

  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-label="Menu"
      tabIndex={-1}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => {
        gesture.current = null;
        onDrag(null);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        // Tab stays inside.
        const items = [...(panel.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])') ?? [])].filter((el) => el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0]!;
        const last = items.at(-1)!;
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      className="absolute inset-y-0 left-0 flex touch-pan-y flex-col bg-sidebar shadow-[var(--sb-overlay-shadow)] outline-none"
      style={{ width, transform: `translateX(${position - width}px)`, transition }}
      data-remote-drawer-panel
    >
      {open && <DrawerHistory onClose={onClose} />}
      {children}
    </div>
  );
}

/** While the drawer is open (not while an edge swipe pulls it): a history entry, so Back closes it, and Escape. */
function DrawerHistory({ onClose }: { onClose: () => void }) {
  useOverlayHistory(onClose);
  return null;
}
