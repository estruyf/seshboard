import { Kbd } from '../ui/Kbd.tsx';

/** In a message box's footer after the first Esc, while "Press Esc twice to stop" is on: a second one stops the agent. */
export function EscapeStopHint({ armed, agent = 'Claude' }: { armed: boolean; agent?: string }) {
  // Always in the DOM, so a screen reader hears it when it appears.
  return (
    <span role="status" aria-live="polite" className={`text-meta text-text ${armed ? '' : 'sr-only'}`} data-escape-stop-hint={armed || undefined}>
      {armed ? (
        <>
          Press <Kbd keys="escape" /> again to stop {agent}
        </>
      ) : null}
    </span>
  );
}
