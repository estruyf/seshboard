import { Maximize, Minus, Plus, ScanSearch } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Button } from '../ui/Button.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { diagramLink, followDiagramLink } from './mermaidLinks.ts';
import { actualSize, fitView, panBy, wheelFactor, zoomAt, ZOOM_STEP, type DiagramView } from './mermaidZoom.ts';

/** How far an arrow key moves the diagram. */
const KEY_PAN = 48;

/**
 * A diagram larger, in a dialog of its own: the wheel (or a pinch) zooms where the pointer is, dragging moves it, and the
 * buttons and keys (`+`, `-`, `0` to fit, `1` for its own size, the arrows) do the same from the keyboard. It opens fitted to the
 * dialog. Escape closes it, as every dialog.
 */
export function MermaidOverlay({ svg, size, onClose }: { svg: string; size: { width: number; height: number }; onClose(): void }) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<DiagramView | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const viewport = () => {
    const rect = box.current!.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  };

  useLayoutEffect(() => {
    setView(fitView(size, viewport()));
  }, [size]);

  // The wheel needs a listener that may cancel it (React's own is passive), or the dialog's scroller would move too.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      setView((v) => (v ? zoomAt(v, wheelFactor(event.deltaY, event.deltaMode), event.clientX - rect.left, event.clientY - rect.top) : v));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = (factor: number) => setView((v) => (v ? zoomAt(v, factor, viewport().width / 2, viewport().height / 2) : v));
  const fit = () => setView(fitView(size, viewport()));
  const own = () => setView(actualSize(size, viewport()));

  const onPointerDown = (event: PointerEvent) => {
    // A press on a link in the diagram is a click on it, which capturing the pointer would swallow.
    if (event.button !== 0 || diagramLink(event.target as Element).anchor) return;
    drag.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    const from = drag.current;
    if (!from) return;
    drag.current = { x: event.clientX, y: event.clientY };
    setView((v) => (v ? panBy(v, event.clientX - from.x, event.clientY - from.y) : v));
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const handled = (() => {
      switch (event.key) {
        case '+':
        case '=':
          return zoomBy(ZOOM_STEP), true;
        case '-':
          return zoomBy(1 / ZOOM_STEP), true;
        case '0':
          return fit(), true;
        case '1':
          return own(), true;
        case 'ArrowLeft':
          return setView((v) => (v ? panBy(v, KEY_PAN, 0) : v)), true;
        case 'ArrowRight':
          return setView((v) => (v ? panBy(v, -KEY_PAN, 0) : v)), true;
        case 'ArrowUp':
          return setView((v) => (v ? panBy(v, 0, KEY_PAN) : v)), true;
        case 'ArrowDown':
          return setView((v) => (v ? panBy(v, 0, -KEY_PAN) : v)), true;
        default:
          return false;
      }
    })();
    if (handled) event.preventDefault();
  };

  const actions = (
    <>
      <span className="mr-1 min-w-10 text-right text-meta text-muted tabular-nums" data-mermaid-zoom>
        {view ? `${Math.round(view.scale * 100)}%` : ''}
      </span>
      <Button variant="quiet" size="sm" iconOnly icon={<Minus size={13} aria-hidden />} aria-label="Zoom out" onClick={() => zoomBy(1 / ZOOM_STEP)} data-mermaid-zoom-out />
      <Button variant="quiet" size="sm" iconOnly icon={<Plus size={13} aria-hidden />} aria-label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)} data-mermaid-zoom-in />
      <Button variant="quiet" size="sm" iconOnly icon={<Maximize size={13} aria-hidden />} aria-label="Fit to window" onClick={fit} data-mermaid-fit />
      <Button variant="quiet" size="sm" iconOnly icon={<ScanSearch size={13} aria-hidden />} aria-label="Actual size" onClick={own} data-mermaid-actual />
    </>
  );

  return (
    <Dialog title="Diagram" subtitle="Scroll to zoom, drag to move" width="full" flush headerActions={actions} initialFocus={box} onClose={onClose} data-mermaid-overlay="">
      <div
        ref={box}
        tabIndex={0}
        role="group"
        aria-label="Diagram. Scroll or press plus and minus to zoom, drag or use the arrow keys to move."
        className="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden bg-bg outline-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={onKeyDown}
        onClick={followDiagramLink}
        data-mermaid-viewport
      >
        <div
          // The SVG is what Mermaid returned under `securityLevel: 'strict'`.
          className="absolute top-0 left-0 select-none [&_svg]:block [&_svg]:h-full [&_svg]:w-full [&_svg]:max-w-none!"
          style={{ width: size.width, height: size.height, transformOrigin: '0 0', transform: view ? `translate(${view.x}px, ${view.y}px) scale(${view.scale})` : undefined, visibility: view ? 'visible' : 'hidden' }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </Dialog>
  );
}
