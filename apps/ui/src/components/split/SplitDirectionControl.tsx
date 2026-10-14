import { Columns2, Rows2 } from 'lucide-react';
import { useSessions } from '../../state/sessionsStore.ts';
import { parentSplit } from '../../state/tiling.ts';
import { Button } from '../ui/Button.tsx';

/**
 * Turns the split this pane is in the other way: side by side becomes stacked, and back (the shortcut and the
 * command palette do the same for the active pane). An icon button in a pane's header next to its ×, showing
 * the direction it switches to. It hides in a narrow pane, where the header has no room to spare.
 */
export function SplitDirectionControl({ sessionId }: { sessionId: string }) {
  const direction = useSessions((s) => parentSplit(s.layout, sessionId)?.split.direction ?? null);
  if (!direction) return null;
  const toStacked = direction === 'row';
  return (
    <Button
      variant="quiet"
      iconOnly
      icon={toStacked ? <Rows2 size={15} aria-hidden /> : <Columns2 size={15} aria-hidden />}
      aria-label={toStacked ? 'Stack these panes' : 'Put these panes side by side'}
      shortcut="pane.orientation"
      onClick={() => {
        // The pane whose button it is becomes the active one, so the flip is of its own split.
        useSessions.getState().focusPane(sessionId);
        useSessions.getState().flipSplit();
      }}
      className="no-drag shrink-0 @max-[420px]:hidden"
      data-split-direction-toggle
      data-split-direction={direction}
    />
  );
}
