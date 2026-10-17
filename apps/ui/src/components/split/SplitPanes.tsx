import { ArrowRightLeft, PanelBottomClose, PanelLeftClose, PanelRightClose, PanelTopClose, Replace } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useComputers } from '../../state/computersStore.ts';
import { parseRemoteRowId } from '../../state/remoteSelection.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { useTilingArea } from '../../state/tilingArea.ts';
import { computeLayout, constrain, edgeBand, fits, stableOrder, type Box } from '../../state/tilingGeometry.ts';
import { RemotePane } from '../computers/RemoteView.tsx';
import { TranscriptView } from '../transcript/TranscriptView.tsx';
import { useSize } from '../ui/useSize.ts';
import { PaneDivider } from './PaneDivider.tsx';
import { useTileDrag, type TileDrag } from './useTileDrag.ts';

const WHOLE: Box = { x: 0, y: 0, w: 1, h: 1 };
const pct = (n: number) => `${n * 100}%`;

/**
 * One session, or many in a tiling layout: side by side and stacked, mixed freely (see `state/tiling.ts` for the
 * tree). A pane shows a session of this computer or one of another computer's (its leaf is `remoteRowId`). The tree decides each pane's rectangle (`computeLayout`) and the panes are drawn as a flat list in a
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
        const leading = box.x < 1e-6 && box.y < 1e-6;
        const remote = parseRemoteRowId(id);
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
              {remote ? (
                <RemotePane remote={remote} pane={{ id, tiled, active: isActive, leading }} />
              ) : (
                <TranscriptView sessionId={id} tiled={tiled} active={isActive} leading={leading} />
              )}
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
function dropLabel(drag: TileDrag, open: boolean): { text: string; icon: typeof ArrowRightLeft } {
  const over = drag.over;
  if (!over) return { text: 'Drop on a pane', icon: ArrowRightLeft };
  if (over.kind === 'edge') {
    return {
      left: { text: 'Dock on the left, full height', icon: PanelLeftClose },
      right: { text: 'Dock on the right, full height', icon: PanelRightClose },
      top: { text: 'Dock on top, full width', icon: PanelTopClose },
      bottom: { text: 'Dock at the bottom, full width', icon: PanelBottomClose },
    }[over.side];
  }
  switch (over.zone) {
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
 * While something is dragged over the panes: a faint band along each edge of the window (dropping there docks
 * across its whole length), the five zones of the pane under the pointer (the dashed middle is the centre) and,
 * for the target, the region the dropped pane will take: where it ends up in the layout the drop makes, so a
 * window-edge dock shows the full-length column or row. When the result would not fit the window, the frame is in
 * the error colour with the reason. What is dragged follows the pointer by its title and says what dropping does.
 */
function DropPreview({ drag, area }: { drag: TileDrag; area: React.RefObject<HTMLDivElement | null> }) {
  const areaRect = area.current?.getBoundingClientRect();
  const local = useSessions((s) => s.sessions.get(drag.id)?.title ?? s.live.get(drag.id)?.name ?? null);
  const remote = useComputers((s) => {
    const ref = parseRemoteRowId(drag.id);
    return ref ? (s.lists.get(ref.computerId)?.sessions.find((session) => session.id === ref.sessionId)?.title ?? null) : null;
  });
  const title = local ?? remote ?? 'Session';
  const open = useSessions((s) => s.paneIds.includes(drag.id));
  const size = useTilingArea((s) => s.size);
  if (!areaRect || !size) return null;
  const over = drag.over;
  const place = (r: { left: number; top: number; width: number; height: number }) => ({ left: r.left, top: r.top, width: r.width, height: r.height });
  const bandX = edgeBand(size.width);
  const bandY = edgeBand(size.height);
  const bands: Record<'left' | 'right' | 'top' | 'bottom', { left: number; top: number; width: number; height: number }> = {
    left: { left: 0, top: 0, width: bandX, height: size.height },
    right: { left: size.width - bandX, top: 0, width: bandX, height: size.height },
    top: { left: 0, top: 0, width: size.width, height: bandY },
    bottom: { left: 0, top: size.height - bandY, width: size.width, height: bandY },
  };
  const target = over?.kind === 'pane' ? area.current?.querySelector<HTMLElement>(`[data-pane-slot="${CSS.escape(over.id)}"]`) : null;
  const rect = target?.getBoundingClientRect();
  const pane = rect ? { left: rect.left - areaRect.left, top: rect.top - areaRect.top, width: rect.width, height: rect.height } : null;
  // Where the dropped pane ends up in the layout the drop makes; for a drop that doesn't fit, what was aimed at.
  const landing = drag.tree ? computeLayout(constrain(drag.tree, size)).panes.find((p) => p.id === drag.id)?.box : null;
  const region = landing
    ? { left: landing.x * size.width, top: landing.y * size.height, width: landing.w * size.width, height: landing.h * size.height }
    : over?.kind === 'edge'
      ? bands[over.side]
      : pane;
  const blocked = over !== null && !drag.fits;
  const label = dropLabel(drag, open);
  const Icon = label.icon;
  const aimed = over !== null;
  return (
    <>
      {(['left', 'right', 'top', 'bottom'] as const).map((side) => (
        <div
          key={side}
          className={`pointer-events-none absolute z-30 border border-dashed ${over?.kind === 'edge' && over.side === side ? 'border-accent-ink/70 bg-accent/10' : 'border-accent-ink/25 bg-accent/5'}`}
          style={place(bands[side])}
          data-pane-drop-band={side}
        />
      ))}
      {pane && over?.kind === 'pane' && (
        // The zones of the pane under the pointer: the centre is the dashed box, the edges are what is around it.
        <div className="pointer-events-none absolute z-30" style={place(pane)} data-pane-drop-pane={over.id}>
          <div className="absolute inset-[25%] rounded-md border border-dashed border-accent-ink/50" />
        </div>
      )}
      {region && over && (
        <div
          className={`pointer-events-none absolute z-30 flex items-center justify-center rounded-md border-2 ${blocked ? 'border-error bg-error/10' : 'border-accent-ink bg-accent/15'}`}
          style={place(region)}
          data-pane-drop-target={over.kind === 'pane' ? over.id : 'edge'}
          data-pane-drop-zone={over.kind === 'pane' ? over.zone : over.side}
          data-pane-drop-edge={over.kind === 'edge' ? over.side : undefined}
          data-pane-drop-blocked={blocked || undefined}
        >
          <span className="overlay flex items-center gap-2 rounded-lg border px-3 py-2 text-ui font-medium text-text">
            <Icon size={14} aria-hidden />
            {blocked ? 'No room for that here' : label.text}
          </span>
        </div>
      )}
      <span
        className={`pointer-events-none fixed z-40 flex max-w-72 flex-col overlay rounded-lg border px-2.5 py-1 text-ui text-text ${blocked ? 'border-error' : aimed ? 'border-accent-ink' : ''}`}
        // Beside the pointer, on the other side of it near the window's right or bottom edge (where a window-edge drop is aimed).
        style={{
          ...(drag.point.x > window.innerWidth - 300 ? { right: window.innerWidth - drag.point.x + 14 } : { left: drag.point.x + 14 }),
          ...(drag.point.y > window.innerHeight - 80 ? { bottom: window.innerHeight - drag.point.y + 14 } : { top: drag.point.y + 14 }),
        }}
        data-pane-drag-ghost
        data-session-drag-ghost={drag.source === 'session' ? true : undefined}
      >
        <span className="truncate">{title}</span>
        <span className="truncate text-meta text-muted">{blocked ? 'No room for that here' : aimed ? label.text : drag.source === 'session' ? 'Drop on the panes to open it' : 'Drop on another pane'}</span>
      </span>
    </>
  );
}
