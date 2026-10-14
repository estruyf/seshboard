import { ArrowRightLeft } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useSessions } from '../../state/sessionsStore.ts';
import { effectiveOrientation, paneElements, stackedBlocked } from '../../state/splitLayout.ts';
import { useSplitLayout } from '../../state/splitLayoutStore.ts';
import { TranscriptView } from '../transcript/TranscriptView.tsx';
import { useHeight } from '../ui/useHeight.ts';
import { usePaneDrag } from './usePaneDrag.ts';

/**
 * One session, or two side by side or one above the other. Every case shares this tree and each pane is keyed
 * by its session, so opening, closing or swapping a split never remounts a session that stays (its unsent
 * message, scroll and Find). The elements keep a fixed order (`paneElements`) and CSS `order` puts each pane
 * first or second, so a swap moves no element, which would reset its scroll position and focus. Clicking in a
 * pane makes it the active one; dragging its header onto the other pane swaps them.
 */
export function SplitPanes() {
  const mainId = useSessions((s) => s.mainId);
  const splitId = useSessions((s) => s.splitId);
  const activePane = useSessions((s) => s.activePane);
  const preferred = useSplitLayout((s) => s.orientation);
  const area = useRef<HTMLDivElement>(null);
  const areaHeight = useHeight(area);
  const orientation = effectiveOrientation(preferred, areaHeight);
  const tooShort = stackedBlocked(areaHeight);
  const elements = paneElements(mainId, splitId);
  const split = elements.length === 2;
  const { drag, onPointerDown } = usePaneDrag(area, split);

  useEffect(() => useSplitLayout.getState().setTooShort(tooShort), [tooShort]);

  return (
    <div
      ref={area}
      className={`flex min-h-0 min-w-0 flex-1 ${orientation === 'stacked' ? 'flex-col' : ''}`}
      data-split={split ? true : undefined}
      data-split-orientation={split ? orientation : undefined}
      onPointerDown={onPointerDown}
    >
      {elements.map(({ id, pane, position }) => (
        <div key={id} className="relative flex min-h-0 min-w-0 flex-1 flex-col" style={{ order: position }} data-pane-slot={pane ?? undefined}>
          {/* The inactive pane dims as a whole, and brightens a little on hover to say a click makes it active. */}
          <div
            className={`flex min-h-0 min-w-0 flex-1 flex-col transition-opacity duration-150 ${position === 1 ? (orientation === 'stacked' ? 'border-t border-border' : 'border-l border-border') : ''} ${
              drag?.from === pane ? 'opacity-50' : pane && activePane !== pane ? 'opacity-60 hover:opacity-85' : ''
            }`}
            onMouseDownCapture={pane ? () => useSessions.getState().focusPane(pane) : undefined}
          >
            <TranscriptView sessionId={id} pane={pane} active={pane ? activePane === pane : true} />
          </div>
          {pane && drag?.over === pane && (
            // Where the dragged pane lands: a frame in the accent and a label, over the whole pane.
            <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-accent/10 ring-2 ring-accent-ink ring-inset" data-pane-drop-target={pane}>
              <span className="overlay flex border items-center gap-2 rounded-lg px-3 py-2 text-ui font-medium text-text">
                <ArrowRightLeft size={14} aria-hidden />
                Swap panes
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
