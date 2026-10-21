import { useEffect, useRef, useState, type RefObject } from 'react';
import { useReadMode } from '../../state/readModeStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { planDrop } from '../../state/paneState.ts';
import type { Tile } from '../../state/tiling.ts';
import { useTilingArea } from '../../state/tilingArea.ts';
import { dragStarted, dropAt, type DropTarget, type Point, type Rect } from '../../state/tilingGeometry.ts';

/** Where a drag comes from: a pane's header (the pane moves) or a session's row in the sidebar (it opens in the pane it lands on). */
export type DragSource = 'pane' | 'session';

/** A drag in progress: what is dragged, where the pointer is, and the pane and part of it under it, if any. */
export interface TileDrag {
  source: DragSource;
  /** The dragged pane's session, or the session of the sidebar row. */
  id: string;
  point: Point;
  over: DropTarget | null;
  /** Dropping here would give a layout that fits. When it does not, the drop is refused. */
  fits: boolean;
  /** The layout the drop would make (null when there is no target or it would not fit). */
  tree: Tile | null;
}

/** Things in a header or a row that keep their own clicks: a press on one never starts a drag. */
const OWN_CLICKS = 'button, a, input, textarea, select, [role="button"], [role="menuitem"], [role="radio"]';
/** A session's row in the open sidebar, or its button in the rail. Only in a session list: reading mode carries `data-session-id` too. */
const SESSION_ROW = '[data-session-list] [data-session-id], [data-sidebar-rail-row]';

/**
 * Dragging a pane by its header, or a session by its row in the sidebar (or rail), onto a pane to arrange the
 * layout: five drop zones per pane (the four edges dock beside it, the centre swaps, or replaces for a session
 * from the sidebar), with Esc to cancel. Pointer events rather than HTML5 drag and drop: they work the same
 * everywhere, can be cancelled with Esc, leave the message box's file drops alone (those are real drag events),
 * work over a terminal, and can be driven by the smoke test. A press only becomes a drag once the pointer has
 * moved a few pixels, so clicks and the header's buttons work as before; a drag that began on a row swallows the
 * click that follows. Sidebar lists are virtualised, but only the row being pressed matters, and it is on screen.
 * The header part to grab carries `data-pane-handle`; each pane's slot in `area` carries `data-pane-slot`.
 *
 * With `enabled` false (another view is on screen) no drag starts and one in progress ends.
 */
export function useTileDrag(area: RefObject<HTMLElement | null>, enabled: boolean): TileDrag | null {
  const [drag, setDrag] = useState<TileDrag | null>(null);
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled) stop.current?.();
  }, [enabled]);
  useEffect(() => () => stop.current?.(), []);

  useEffect(() => {
    if (!enabled) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary || event.altKey || event.shiftKey || event.metaKey || event.ctrlKey) return;
      // Reading mode covers the panes: a press there selects text, and its session list has nothing to drop onto.
      if (useReadMode.getState().open !== null) return;
      const target = event.target as HTMLElement | null;
      if (!target?.closest) return;
      const { paneIds } = useSessions.getState();
      let source: DragSource;
      let grab: HTMLElement;
      let id: string | undefined;
      const handle = target.closest<HTMLElement>('[data-pane-handle]');
      const row = handle ? null : target.closest<HTMLElement>(SESSION_ROW);
      if (handle && area.current?.contains(handle)) {
        // Moving a pane needs somewhere to move it to.
        if (paneIds.length < 2) return;
        source = 'pane';
        grab = handle;
        id = handle.closest<HTMLElement>('[data-pane-slot]')?.dataset.paneSlot;
      } else if (row) {
        source = 'session';
        grab = row;
        id = row.dataset.sessionId ?? row.dataset.sidebarRailRow;
      } else return;
      const own = target.closest(OWN_CLICKS);
      if (!id || (own && own !== grab && grab.contains(own))) return;
      stop.current?.();

      const start: Point = { x: event.clientX, y: event.clientY };
      const panes = (): Array<{ id: string; rect: Rect }> =>
        [...(area.current?.querySelectorAll<HTMLElement>('[data-pane-slot]:not([data-pane-hidden])') ?? [])].map((el) => ({ id: el.dataset.paneSlot!, rect: el.getBoundingClientRect() }));
      const at = (point: Point): Pick<TileDrag, 'over' | 'fits' | 'tree'> => {
        const box = area.current?.getBoundingClientRect();
        const bounds: Rect = box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom } : { left: 0, top: 0, right: 0, bottom: 0 };
        const over = dropAt(source === 'pane' ? id : null, point, panes(), bounds);
        const none = { over: null, fits: true, tree: null };
        if (!over) return none;
        // A session already open moves like a pane does; dropped on its own pane, or where it already is, nothing would change.
        const plan = planDrop(useSessions.getState().layout, id, over, useTilingArea.getState().size);
        if (plan.kind === 'nothing') return none;
        return plan.kind === 'ok' ? { over, fits: true, tree: plan.tree } : { over, fits: false, tree: null };
      };
      let dragging = false;

      const swallowClick = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
      };
      const noNativeDrag = (e: Event) => e.preventDefault();
      const end = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', end);
        window.removeEventListener('keydown', key, true);
        window.removeEventListener('blur', end);
        window.removeEventListener('dragstart', noNativeDrag, true);
        document.documentElement.removeAttribute('data-pane-dragging');
        if (grab.hasPointerCapture?.(event.pointerId)) grab.releasePointerCapture(event.pointerId);
        // The click that ends a drag from a row would open the session: let it pass without doing anything.
        if (dragging && source === 'session') {
          window.addEventListener('click', swallowClick, { capture: true, once: true });
          setTimeout(() => window.removeEventListener('click', swallowClick, true), 0);
        }
        stop.current = null;
        setDrag(null);
      };
      const move = (e: PointerEvent) => {
        const point = { x: e.clientX, y: e.clientY };
        if (!dragging) {
          if (!dragStarted(start, point)) return;
          dragging = true;
          // Keep the pointer, even over another pane's terminal or out of the window, and show it as a grab.
          try {
            grab.setPointerCapture(e.pointerId);
          } catch {
            // The pointer is already gone; the drag ends with its pointerup.
          }
          window.getSelection()?.removeAllRanges();
          document.documentElement.setAttribute('data-pane-dragging', '');
        }
        const next: TileDrag = { source, id, point, ...at(point) };
        setDrag(next);
      };
      const up = (e: PointerEvent) => {
        const landed = dragging ? at({ x: e.clientX, y: e.clientY }) : null;
        end();
        if (!landed?.over) return;
        // A drop that doesn't fit says so (the store toasts) and changes nothing.
        useSessions.getState().dropOn(id, landed.over);
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
      window.addEventListener('dragstart', noNativeDrag, true);
      stop.current = end;
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [area, enabled]);

  return drag;
}
