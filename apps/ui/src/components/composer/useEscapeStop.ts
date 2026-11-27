import { useEffect, useState } from 'react';
import { usePreferences } from '../../state/preferencesStore.ts';
import { ESCAPE_AGAIN_MS, escapeToStop } from './escapeStop.ts';

/**
 * Esc in a message box while the agent works. `press` stops it at once, or, with "Press Esc twice to stop" on
 * (the default), arms the stop: `armed` is true for a moment and the box says to press Esc again.
 */
export function useEscapeStop(running: boolean, stop: (() => void) | undefined) {
  const twice = usePreferences((p) => p.prefs.escapeTwiceToStop);
  const [armedAt, setArmedAt] = useState<number | null>(null);
  useEffect(() => {
    if (armedAt === null) return;
    const timer = setTimeout(() => setArmedAt(null), ESCAPE_AGAIN_MS);
    return () => clearTimeout(timer);
  }, [armedAt]);
  // A turn that ends by itself leaves nothing to stop.
  useEffect(() => {
    if (!running) setArmedAt(null);
  }, [running]);
  const press = () => {
    const now = Date.now();
    if (escapeToStop(armedAt, now, twice) === 'arm') return setArmedAt(now);
    setArmedAt(null);
    stop?.();
  };
  return { armed: armedAt !== null && running, twice, press };
}
