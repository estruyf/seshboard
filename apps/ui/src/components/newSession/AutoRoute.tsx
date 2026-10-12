import { useEffect, useRef, useState } from 'react';
import type { RouteResult } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { Button } from '../ui/Button.tsx';
import { Kbd } from '../ui/Kbd.tsx';

/**
 * Auto model's routing for New session and the palette: `route` asks the engine which model to start on, while
 * `choosing` is true; Esc (or `stop`) gives up waiting, and `route` resolves to null so nothing starts and the
 * prompt and its images stay. The engine's call still finishes on its own (it takes at most a few seconds).
 */
export function useAutoRoute() {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [choosing, setChoosing] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  const stop = () => stopRef.current?.();

  // Esc stops choosing, before anything else hears it (the message box, a dialog around the palette).
  useEffect(() => {
    if (!choosing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      stop();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [choosing]);

  const route = (params: { profileId: string; prompt: string; imageCount: number }): Promise<RouteResult | null> => {
    if (!client) return Promise.resolve(null);
    setChoosing(true);
    return new Promise<RouteResult | null>((resolve) => {
      let settled = false;
      const finish = (result: RouteResult | null) => {
        if (settled) return;
        settled = true;
        stopRef.current = null;
        setChoosing(false);
        resolve(result);
      };
      stopRef.current = () => finish(null);
      // An engine error is a failure like any other: the session starts on the default model.
      client.call('model.route', params).then(finish, (error: Error) => finish({ ok: false, routeId: null, reason: error.message, tokens: 0, allowed: [] }));
    });
  };

  return { choosing, route, stop };
}

/** In place of Start while Auto is choosing: a spinner and "Choosing a model…", with "Esc stops" beside it. */
export function ChoosingModel({ onStop }: { onStop(): void }) {
  return (
    <span className="flex items-center gap-2" aria-live="polite" data-auto-route>
      <button type="button" onClick={onStop} className="flex items-center gap-1 text-meta text-muted hover:text-text" data-auto-route-stop>
        <Kbd keys="Esc" />
        stops
      </button>
      {/* Busy rather than disabled: it keeps its colour, and says what is happening. */}
      <Button variant="primary" size="lg" aria-disabled aria-busy onClick={() => {}}>
        <span aria-hidden className="size-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-on-accent/25 border-t-on-accent" />
        Choosing a model…
      </Button>
    </span>
  );
}
