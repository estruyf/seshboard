import { X } from 'lucide-react';
import { useSessions } from '../../state/sessionsStore.ts';
import { Button } from '../ui/Button.tsx';
import { SplitDirectionControl } from './SplitDirectionControl.tsx';

/**
 * The end of a pane's header, as in a local session's: with several panes, turn its split and close the pane;
 * alone, close the session and go Home (`closeTooltip` says what that leaves running).
 */
export function PaneClose({ id, tiled, closeTooltip }: { id: string; tiled: boolean; closeTooltip: string }) {
  if (!tiled) {
    return (
      <Button
        variant="quiet"
        iconOnly
        icon={<X size={15} />}
        onClick={() => useSessions.getState().closeSession()}
        data-tooltip={closeTooltip}
        aria-label="Close session"
        className="no-drag shrink-0"
        data-close-session
      />
    );
  }
  return (
    <>
      <SplitDirectionControl sessionId={id} />
      <Button
        variant="quiet"
        iconOnly
        icon={<X size={15} />}
        data-close-pane
        onClick={() => useSessions.getState().closePane(id)}
        aria-label="Close this pane"
        shortcut="pane.close"
        className="no-drag shrink-0"
      />
    </>
  );
}
