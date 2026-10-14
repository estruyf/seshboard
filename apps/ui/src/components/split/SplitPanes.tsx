import { ArrowRightLeft, PanelBottomClose, PanelLeftClose, PanelRightClose, PanelTopClose, Replace } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useSessions } from '../../state/sessionsStore.ts';
import type { Zone } from '../../state/tiling.ts';
import { useTilingArea } from '../../state/tilingArea.ts';
import { computeLayout, constrain, dropRegion, fits, stableOrder, type Box, type Rect } from '../../state/tilingGeometry.ts';
import { TranscriptView } from '../transcript/TranscriptView.tsx';
import { useSize } from '../ui/useSize.ts';
import { PaneDivider } from './PaneDivider.tsx';
import { useTileDrag, type TileDrag } from './useTileDrag.ts';

const WHOLE: Box = { x: 0, y: 0, w: 1, h: 1 };
const pct = (n: number) => `${n * 100}%`;

/**
 * One session, or many in a tiling layout: side by side and stacked, mixed freely (see `state/tiling.ts` for the
 * tree). The tree decides each pane's rectangle (`computeLayout`) and the panes are drawn as a flat list in a
 * fixed order (by session id), each positioned absolutely with percentages, so opening, closing, moving,
 * swapping or resizing a pane never moves or remounts a session that stays: its unsent message, scroll position
 * and Find are untouched. Moving a DOM element would reset its scroll and focus, and a nested render that
 * follows the tree would remount on every change of structure, so neither is used. A divider sits between each
 * two neighbours (`PaneDivider`). Clicking in a pane makes it the active one; dragging its header, or a
 * session's row in the sidebar, onto a pane shows where it would land (`useTileDrag`).
 *
 * When the window is too small for every pane at its minimum size (`fits`), only the active pane shows, over the
 * whole area; the others stay mounted and the layout is kept, so they come back when the window grows.
 */
export function SplitPanes() {
  const layout = useSessions((s) => s.layout);
  const active = useSessions((s) => s.selectedId);
  const area = useRef<HTMLDivElement>(null);
  const size = useSize(area);
  const drag = useTileDrag(area, true);

  // The sessions store decides whether another pane fits from the size measured here.
  useEffect(() => {
    useTilingArea.getState().set(size);
  }, [size]);
  useEffect(() => () => useTilingArea.getState().set(null), []);

  const ids = useMemo(() => stableOrder(layout), [layout]);
  const count = ids.length;
  const tiled = count > 1;
  const roomy = !layout || !size || fits(layout, size);
  // The layout as it shows in this window: sizes held to what each pane needs (the saved ones are untouched).
  const shown = useMemo(() => (layout && size ? constrain(layout, size) : layout), [layout, size]);
  const { panes, dividers } = useMemo(() => computeLayout(shown), [shown]);
  const boxes = new Map(panes.map((p) => [p.id, p.box]));

  return (
    <div ref={area} className="relative min-h-0 min-w-0 flex-1 overflow-hidden" data-split={tiled ? true : undefined} data-pane-count={count} data-split-fallback={tiled && !roomy ? true : undefined}>
      {tiled && !roomy && (
        // Its own strip above the pane, so it never covers the message box or a toast.
        <p className="absolute inset-x-0 top-0 z-20 flex h-7 items-center border-b border-border bg-card px-4 text-meta text-muted" data-pane-fallback-note>
          This window is too small for {count} panes, so only this one shows. Make it larger to see them all.
        </p>
      )}
      <div className={`absolute inset-x-0 bottom-0 ${tiled && !roomy ? 'top-7' : 'top-0'}`}>
      {ids.map((id) => {
        const isActive = id === active;
        const hidden = !roomy && !isActive;
        const box = roomy ? (boxes.get(id) ?? WHOLE) : WHOLE;
        return (
          <div
            key={id}
            className="absolute flex min-h-0 min-w-0 flex-col"
            style={{ left: pct(box.x), top: pct(box.y), width: pct(box.w), height: pct(box.h), visibility: hidden ? 'hidden' : undefined }}
            // Out of the way, but mounted: the Tab order and the screen reader skip it, its scroll and draft stay.
            inert={hidden || undefined}
            data-pane-slot={id}
            data-pane-hidden={hidden || undefined}
          >
            {/* The inactive pane dims as a whole, and brightens a little on hover to say a click makes it active. */}
            <div
              className={`flex min-h-0 min-w-0 flex-1 flex-col transition-opacity duration-150 ${
                drag?.source === 'pane' && drag.id === id ? 'opacity-50' : tiled && !isActive ? 'opacity-60 hover:opacity-85' : ''
              }`}
              onMouseDownCapture={tiled && !isActive ? () => useSessions.getState().focusPane(id) : undefined}
            >
              <TranscriptView sessionId={id} tiled={tiled} active={isActive} leading={box.x < 1e-6 && box.y < 1e-6} />
            </div>
          </div>
        );
      })}
      {roomy && size && shown && dividers.map((d) => <PaneDivider key={`${d.path.join('.')}:${d.index}`} divider={d} tree={shown} area={size} />)}
      </div>
      {drag && size && <DropPreview drag={drag} area={area} />}
    </div>
  );
}

/** The word for what a drop would do, and its icon. */
function dropLabel(drag: TileDrag, zone: Zone, open: boolean): { text: string; icon: typeof ArrowRightLeft } {
  switch (zone) {
    case 'left':
      return { text: 'Dock on the left', icon: PanelLeftClose };
    case 'right':
      return { text: 'Dock on the right', icon: PanelRightClose };
    case 'top':
      return { text: 'Dock above', icon: PanelTopClose };
    case 'bottom':
      return { text: 'Dock below', icon: PanelBottomClose };
    default:
      return drag.source === 'session' && !open ? { text: 'Replace this session', icon: Replace } : { text: 'Swap panes', icon: ArrowRightLeft };
  }
}

/**
 * While something is dragged over a pane: the pane's five zones (the dashed middle is the centre) and, over the
 * zone under the pointer, the region the dropped pane would take, in the accent; when the result would not fit
 * the window, in the error colour with the reason. A dragged session also follows the pointer by its title.
 */
function DropPreview({ drag, area }: { drag: TileDrag; area: React.RefObject<HTMLDivElement | null> }) {
  const areaRect = area.current?.getBoundingClientRect();
  const title = useSessions((s) => s.sessions.get(drag.id)?.title ?? s.live.get(drag.id)?.name ?? 'Session');
  const open = useSessions((s) => s.paneIds.includes(drag.id));
  if (!areaRect) return null;
  const target = drag.over ? area.current?.querySelector<HTMLElement>(`[data-pane-slot="${CSS.escape(drag.over.id)}"]`) : null;
  // A plain object: a DOMRect's fields are getters, which spreading (as `dropRegion` does) would lose.
  const rect = target?.getBoundingClientRect();
  const paneRect: Rect | null = rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null;
  const local = (r: Rect): Rect => ({ left: r.left - areaRect.left, top: r.top - areaRect.top, right: r.right - areaRect.left, bottom: r.bottom - areaRect.top });
  const place = (r: Rect) => ({ left: r.left, top: r.top, width: r.right - r.left, height: r.bottom - r.top });
  const pane = paneRect ? local(paneRect) : null;
  const region = paneRect && drag.over ? local(dropRegion(paneRect, drag.over.zone)) : null;
  const label = drag.over ? dropLabel(drag, drag.over.zone, open) : null;
  const Icon = label?.icon;
  const blocked = drag.over !== null && !drag.fits;
  return (
    <>
      {pane && (
        // The zones of the pane under the pointer: the centre is the dashed box, the edges are what is around it.
        <div className="pointer-events-none absolute z-30" style={place(pane)} data-pane-drop-pane={drag.over!.id}>
          <div className="absolute inset-[25%] rounded-md border border-dashed border-accent-ink/50" />
        </div>
      )}
      {region && label && Icon && drag.over && (
        <div
          className={`pointer-events-none absolute z-30 flex items-center justify-center rounded-md border-2 ${blocked ? 'border-error bg-error/10' : 'border-accent-ink bg-accent/15'}`}
          style={place(region)}
          data-pane-drop-target={drag.over.id}
          data-pane-drop-zone={drag.over.zone}
          data-pane-drop-blocked={blocked || undefined}
        >
          <span className="overlay flex items-center gap-2 rounded-lg border px-3 py-2 text-ui font-medium text-text">
            <Icon size={14} aria-hidden />
            {blocked ? 'No room for that here' : label.text}
          </span>
        </div>
      )}
      {drag.source === 'session' && (
        <span
          className="pointer-events-none fixed z-40 max-w-64 truncate overlay rounded-lg border px-2.5 py-1 text-ui text-text"
          style={{ left: drag.point.x + 14, top: drag.point.y + 14 }}
          data-session-drag-ghost
        >
          {title}
        </span>
      )}
    </>
  );
}
