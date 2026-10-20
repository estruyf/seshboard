import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useShownSidebar, useSidebar } from '../../state/sidebarStore.ts';
import { SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, snapFromCollapsed, snapWidth, stepState, type SidebarSnap } from '../../state/sidebarWidth.ts';
import { Sidebar } from './Sidebar.tsx';
import { SidebarRail } from './SidebarRail.tsx';

/**
 * The sidebar's right edge (the window's left edge while it is closed). Dragging snaps between open,
 * the rail and closed as you go (`snapWidth`); ← and → step through the same states (`stepState`);
 * a double-click opens it at the default width.
 */
function SidebarResizeHandle({ fitted, onDragging }: { fitted: SidebarSnap; onDragging(dragging: boolean): void }) {
  const { state, width: shown } = fitted;

  const apply = (next: { state: typeof state; width: number }) => {
    const store = useSidebar.getState();
    if (next.state === 'open') store.setWidth(next.width);
    store.setState(next.state);
  };

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const start = useSidebar.getState();
    const startX = event.clientX;
    // From where the edge is on screen, which a small window may have narrowed.
    const startShown = shown;
    // Dragged out of the rail (or from the window's edge), it opens at a width you had before.
    const collapsed = state !== 'open';
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    onDragging(true);
    const move = (e: globalThis.PointerEvent) => {
      const x = startShown + (e.clientX - startX);
      const snap = collapsed ? snapFromCollapsed(x, start.width) : snapWidth(x);
      apply(snap);
    };
    const up = () => {
      onDragging(false);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const store = useSidebar.getState();
    apply(stepState({ state: store.state, width: store.width }, event.key === 'ArrowLeft' ? 'left' : 'right'));
  };

  return (
    <div
      onPointerDown={startResize}
      onKeyDown={onKeyDown}
      onDoubleClick={() => apply({ state: 'open', width: SIDEBAR_DEFAULT_WIDTH })}
      tabIndex={0}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={shown}
      aria-valuemin={0}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuetext={state === 'open' ? `${shown} pixels` : state === 'minimal' ? 'Minimal' : 'Closed'}
      data-tooltip={state === 'closed' ? 'Drag to show the sidebar' : 'Drag to resize, double-click to reset'}
      className={`no-drag absolute inset-y-0 z-20 w-1.5 cursor-col-resize outline-none hover:bg-accent/40 focus-visible:bg-accent-ink/60 ${state === 'closed' ? 'left-0' : '-right-[3px]'}`}
      data-sidebar-resize
    />
  );
}

/**
 * The sidebar in its three states: open (the full list, at the width you dragged it to), minimal (the
 * 80px rail) or closed (nothing, the session view takes the window). Changing state eases the width
 * over 150ms (none with reduced motion), except while dragging the open edge, which follows the pointer.
 */
export function SidebarShell({ inert = false }: { inert?: boolean }) {
  const saved = useSidebar((s) => s.state);
  // In a small window (or zoomed in) the sidebar narrows, or shows as the rail, so the session view
  // keeps its room; the saved state and width come back as the window grows.
  const fitted = useShownSidebar();
  const state = fitted.state;
  const [dragging, setDragging] = useState(false);
  const animate = !dragging || state !== 'open';
  return (
    <div
      className={`relative h-full shrink-0 ${animate ? 'transition-[width] duration-150 ease-out motion-reduce:transition-none' : ''}`}
      style={{ width: fitted.width }}
      data-sidebar
      inert={inert}
      data-sidebar-state={state}
      data-sidebar-fitted={state !== saved || undefined}
      data-sidebar-dragging={dragging || undefined}
    >
      <div className="h-full overflow-hidden">
        {state === 'open' ? <Sidebar /> : state === 'minimal' ? <SidebarRail /> : null}
      </div>
      <SidebarResizeHandle fitted={fitted} onDragging={setDragging} />
    </div>
  );
}
