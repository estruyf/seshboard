import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useSessions } from '../../state/sessionsStore.ts';
import { equalize, type Tile } from '../../state/tiling.ts';
import { boundaryOf, dividerKey, moveDivider, moveDividerByKey, snapBoundary, type DividerBox, type Size } from '../../state/tilingGeometry.ts';

/**
 * The line between two panes that sit side by side or one above the other. Drag it to resize, use ← → (or ↑ ↓
 * between stacked panes; Home and End go as far as the minimum sizes allow), and double-click it for equal
 * sizes. It is also the border between the panes, so it is always there, a line of one pixel with a wider
 * place to grab. The divider works on `tree`, the layout as it is shown (sizes already held to the minimums),
 * and only the two panes beside it change. Sizes live in the layout tree in the sessions store.
 */
export function PaneDivider({ divider, tree, area }: { divider: DividerBox; tree: Tile; area: Size }) {
  const [dragging, setDragging] = useState(false);
  const vertical = divider.direction === 'row';
  const extent = vertical ? divider.split.w * area.width : divider.split.h * area.height;
  const { path, index } = divider;
  const commit = (next: Tile) => useSessions.getState().resizePanes(next);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    target.focus({ preventScroll: true });
    setDragging(true);
    const origin = vertical ? event.clientX : event.clientY;
    const first = divider.boundary;
    const move = (e: globalThis.PointerEvent) => {
      const wanted = first + ((vertical ? e.clientX : e.clientY) - origin) / extent;
      commit(moveDivider(tree, path, index, snapBoundary(tree, path, index, wanted, extent), extent));
    };
    const end = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
      setDragging(false);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (dividerKey(divider.direction, event.key) === null) return;
    event.preventDefault();
    commit(moveDividerByKey(tree, path, index, event.key, extent));
  };

  // What the minimum sizes allow, for assistive technology: the edge's place as a percentage of the split.
  const percent = (boundary: number | null) => Math.round((boundary ?? 0) * 100);
  const lowest = percent(boundaryOf(moveDivider(tree, path, index, 0, extent), path, index));
  const highest = percent(boundaryOf(moveDivider(tree, path, index, 1, extent), path, index));

  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label="Resize panes"
      aria-valuenow={percent(divider.boundary)}
      aria-valuemin={lowest}
      aria-valuemax={highest}
      tabIndex={0}
      onPointerDown={startDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={() => commit(equalize(tree, path))}
      data-tooltip={vertical ? 'Drag (or use ← →) to resize. Double-click for equal sizes' : 'Drag (or use ↑ ↓) to resize. Double-click for equal sizes'}
      data-pane-divider={divider.direction}
      data-pane-divider-at={`${path.join('.')}:${index}`}
      data-dragging={dragging || undefined}
      // `no-drag`: the divider can sit over a pane's header, which is the window's drag region and would take the mouse.
      className={`group no-drag absolute z-20 flex items-center justify-center outline-none ${vertical ? 'w-2.5 cursor-col-resize' : 'h-2.5 cursor-row-resize'}`}
      style={
        vertical
          ? { left: `calc(${divider.line.x * 100}% - 5px)`, top: `${divider.line.y * 100}%`, height: `${divider.line.h * 100}%` }
          : { top: `calc(${divider.line.y * 100}% - 5px)`, left: `${divider.line.x * 100}%`, width: `${divider.line.w * 100}%` }
      }
    >
      <span aria-hidden className={`absolute bg-border transition-colors group-hover:bg-muted group-focus-visible:bg-accent-ink group-data-dragging:bg-accent-ink ${vertical ? 'inset-y-0 w-px' : 'inset-x-0 h-px'}`} />
      <span
        aria-hidden
        className={`relative rounded-full bg-faint/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-data-dragging:opacity-100 ${vertical ? 'h-9 w-1' : 'h-1 w-9'}`}
      />
    </div>
  );
}
