import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './ui.tsx';

/** Open sheets, so only the top one takes Escape and the back gesture. */
const stack: number[] = [];
let nextId = 1;
/**
 * A sheet closed by a button or Escape takes back its history entry with `history.back()`, which lands a moment later.
 * Until it has, its popstate is nobody's back gesture, and a sheet opening meanwhile (Changes, then Commit) waits to add
 * its own entry.
 */
let goingBack: Promise<void> | null = null;

function takeBackEntry(): void {
  goingBack = new Promise((resolve) => {
    const done = () => {
      window.removeEventListener('popstate', done);
      clearTimeout(timer);
      // After every popstate listener has seen it: theirs run after this one.
      setTimeout(() => {
        goingBack = null;
        resolve();
      });
    };
    // A browser that doesn't fire it (nothing to go back to) mustn't hold sheets back for ever.
    const timer = setTimeout(done, 500);
    window.addEventListener('popstate', done);
  });
  history.back();
}

/**
 * A bottom sheet on a phone, a dialog in the middle on a wide screen: a grabber, a title and a close button, a
 * scrolling body and an optional footer. It closes with a swipe down on the grabber or the title, Escape, a tap on the
 * scrim, or the back gesture (it adds a history entry while open).
 */
export function Sheet({ title, subtitle, onClose, children, footer, label, hook, tall = false }: { title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; label?: string; hook?: string; tall?: boolean }) {
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const viaHistory = useRef(false);

  useEffect(() => {
    const id = nextId++;
    stack.push(id);
    const before = document.activeElement as HTMLElement | null;
    panel.current?.focus({ preventScroll: true });
    // The back gesture closes the sheet, not the screen under it. A tick later, so StrictMode's trial mount adds nothing.
    let pushed = false;
    let cancelled = false;
    const add = () => {
      if (cancelled) return;
      pushed = true;
      history.pushState({ ...(history.state as object | null), sheet: id }, '');
    };
    const push = setTimeout(() => (goingBack ? void goingBack.then(add) : add()));
    const onPop = () => {
      if (goingBack || !pushed || stack.at(-1) !== id) return;
      viaHistory.current = true;
      closeRef.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || stack.at(-1) !== id || event.defaultPrevented) return;
      event.preventDefault();
      closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('keydown', onKey);
      clearTimeout(push);
      cancelled = true;
      stack.splice(stack.indexOf(id), 1);
      // Closed another way: take back the history entry it added.
      if (pushed && !viaHistory.current && (history.state as { sheet?: number } | null)?.sheet === id) takeBackEntry();
      before?.focus({ preventScroll: true });
    };
  }, []);

  const grab = {
    onPointerDown: (event: PointerEvent) => {
      if ((event.target as HTMLElement).closest('button')) return;
      start.current = event.clientY;
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent) => {
      if (start.current !== null) setDrag(Math.max(0, event.clientY - start.current));
    },
    onPointerUp: () => {
      if (start.current === null) return;
      start.current = null;
      if (drag > 80) onClose();
      setDrag(0);
    },
    onPointerCancel: () => {
      start.current = null;
      setDrag(0);
    },
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center md:items-center md:p-6" data-remote-sheet={hook}>
      <div aria-hidden className="scrim-in absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label ?? (typeof title === 'string' ? title : undefined)}
        tabIndex={-1}
        style={drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined}
        className={`sheet-in overlay relative flex w-full flex-col rounded-t-2xl outline-none md:max-w-xl md:rounded-2xl ${tall ? 'h-[88dvh] md:h-[80dvh]' : 'max-h-[88dvh] md:max-h-[80dvh]'}`}
      >
        <div {...grab} className="shrink-0 touch-none px-4 pt-2 md:pt-3">
          <div aria-hidden className="mx-auto mb-2 h-1 w-9 rounded-full bg-edge md:hidden" />
          <div className="flex items-start gap-2 pb-2">
            <div className="min-w-0 flex-1">
              <h2 className="text-title font-semibold">{title}</h2>
              {subtitle && <p className="text-meta text-muted">{subtitle}</p>}
            </div>
            <Button variant="quiet" size="md" aria-label="Close" onClick={onClose} className="-mr-2 px-2!">
              <X className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3">{children}</div>
        {footer && <div className="safe-bottom shrink-0 border-t border-border px-4 pt-3 md:pb-3">{footer}</div>}
        {!footer && <div className="safe-bottom shrink-0 md:hidden" />}
      </div>
    </div>
  );
}
