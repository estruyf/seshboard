import { Columns2, Rows2 } from 'lucide-react';
import { shownOrientation } from '../../state/splitLayout.ts';
import { useSplitLayout } from '../../state/splitLayoutStore.ts';
import { Button } from '../ui/Button.tsx';

/**
 * Puts the two panes one above the other, or side by side again (⌘⇧O does the same): an icon button in the
 * second pane's header, next to its ×, showing the layout it switches to. It hides in a narrow pane, where the
 * header has no room to spare (the shortcut and the command palette still work). In a window too short to
 * stack the panes it says so, and a click gets the same explanation.
 */
export function SplitOrientationControl() {
  const preferred = useSplitLayout((s) => s.orientation);
  const tooShort = useSplitLayout((s) => s.tooShort);
  const shown = shownOrientation(preferred, tooShort);
  const next = shown === 'side' ? 'stacked' : 'side';
  const label = next === 'stacked' ? 'Stack panes' : 'Show panes side by side';
  return (
    <Button
      variant="quiet"
      iconOnly
      icon={next === 'stacked' ? <Rows2 size={15} aria-hidden /> : <Columns2 size={15} aria-hidden />}
      aria-label={label}
      shortcut="pane.orientation"
      data-tooltip={next === 'stacked' && tooShort ? 'Stacking needs a taller window' : undefined}
      onClick={() => useSplitLayout.getState().choose(next)}
      className="no-drag shrink-0 @max-[420px]:hidden"
      data-split-orientation-toggle
      data-split-shown={shown}
    />
  );
}
