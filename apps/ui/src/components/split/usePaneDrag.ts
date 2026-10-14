import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { useSessions, type Pane } from '../../state/sessionsStore.ts';
import { dragStarted, dropTarget, type Point, type Rect } from '../../state/splitLayout.ts';

/** A pane being dragged by its header, and the pane it is over (where it would land), if any. */
export interface PaneDrag {
  from: Pane;
  over: Pane | null;
}

/** Things in a header that keep their own clicks: a press on one never starts a drag. */
const OWN_CLICKS = 'button, a, input, textarea, select, [role="button"], [role="menuitem"], [role="radio"]';

/**
 * Dragging a pane by its header onto the other pane swaps them. Pointer events rather than HTML5 drag and drop:
 * they work the same in both layouts, can be cancelled with Esc, leave file drops on the message box alone (those
 * are real drag events) and can be driven by the smoke test. A press only becomes a drag once the pointer has
 * moved a few pixels, so clicks and the header's buttons work as before. The header part to grab carries
 * `data-pane-handle`; each pane's slot in `area` carries `data-pane-slot`.
 */
export function usePaneDrag(area: RefObject<HTMLElement | null>, enabled: boolean) {
  const [drag, setDrag] = useState<PaneDrag | null>(null);
  const stop = useRef<(() => void) | null>(null);

  // A split that closes, or an unmount, in the middle of a drag ends it.
  useEffect(() => {
    if (!enabled) stop.current?.();
  }, [enabled]);
  useEffect(() => () => stop.current?.(), []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || event.button !== 0 || !event.isPrimary) return;
      const target = event.target as HTMLElement;
      const handle = target.closest<HTMLElement>('[data-pane-handle]');
      const own = target.closest(OWN_CLICKS);
      const from = handle?.closest<HTMLElement>('[data-pane-slot]')?.dataset.paneSlot as Pane | undefined;
      if (!handle || !from || (own && handle.contains(own))) return;
      stop.current?.();

      const start: Point = { x: event.clientX, y: event.clientY };
      const rects = (): Record<Pane, Rect> => {
        const rect = (pane: Pane) => area.current?.querySelector(`[data-pane-slot="${pane}"]`)?.getBoundingClientRect() ?? { left: 0, top: 0, right: 0, bottom: 0 };
        return { main: rect('main'), split: rect('split') };
      };
      let dragging = false;

      const end = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', end);
        window.removeEventListener('keydown', key, true);
        window.removeEventListener('blur', end);
        document.documentElement.removeAttribute('data-pane-dragging');
        if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
        stop.current = null;
        setDrag(null);
      };
      const move = (e: PointerEvent) => {
        const point = { x: e.clientX, y: e.clientY };
        if (!dragging) {
          if (!dragStarted(start, point)) return;
          dragging = true;
          // Keep the pointer, even over the other pane's terminal or out of the window, and show it as a grab.
          try {
            handle.setPointerCapture(e.pointerId);
          } catch {
            // The pointer is already gone; the drag ends with its pointerup.
          }
          window.getSelection()?.removeAllRanges();
          document.documentElement.setAttribute('data-pane-dragging', '');
        }
        const over = dropTarget(from, point, rects());
        setDrag((current) => (current && current.from === from && current.over === over ? current : { from, over }));
      };
      const up = (e: PointerEvent) => {
        const landed = dragging ? dropTarget(from, { x: e.clientX, y: e.clientY }, rects()) : null;
        end();
        if (landed) useSessions.getState().swapPanes();
      };
      // Esc cancels the drag, and nothing else (the message box would stop Claude on it).
      const key = (e: KeyboardEvent) => {
        if (e.key !== 'Escape' || !dragging) return;
        e.preventDefault();
        e.stopPropagation();
        end();
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', end);
      window.addEventListener('keydown', key, true);
      window.addEventListener('blur', end);
      stop.current = end;
    },
    [area, enabled],
  );

  return { drag, onPointerDown };
}
