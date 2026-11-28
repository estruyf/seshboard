import { useEffect } from 'react';
import { canvasTab } from '../components/ask/askWidth.ts';
import { canvasPageKey, keepCanvasPages } from '../components/canvas/canvasPages.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { useCanvasPanels, viewedCanvases } from './canvasPanelStore.ts';
import { useRightPanel } from './rightPanelStore.ts';

/**
 * Canvases, window side (docs/canvases.md):
 * - when a session's agent opens a canvas (`open_canvas`), the session's side panel shows it, in front;
 * - the engine hears which canvases this window has open, so one that no window has open stops after a while;
 * - a canvas closed in a session loses its page there (an open one keeps it behind other panels).
 */
export function useCanvasSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(
    () =>
      client?.on('canvases.show', ({ sessionId, id, cwd }) => {
        useCanvasPanels.getState().setOpen(sessionId, id, true, cwd);
        useRightPanel.getState().setTab(sessionId, canvasTab(id));
      }),
    [client],
  );

  useEffect(() => {
    if (!client) return;
    // A new connection knows nothing of this window: everything open is told again.
    let told = new Set<string>();
    const tell = () => {
      const { open, folders } = useCanvasPanels.getState();
      const now = viewedCanvases(open, folders);
      const say = (entry: string, viewing: boolean) => {
        const [cwd, id] = entry.split('\n') as [string, string];
        void client.call('canvases.view', { cwd, id, viewing }).catch(() => {});
      };
      for (const entry of now) if (!told.has(entry)) say(entry, true);
      for (const entry of told) if (!now.has(entry)) say(entry, false);
      told = now;
      keepCanvasPages(new Set([...open].flatMap(([sessionId, ids]) => ids.map((id) => canvasPageKey(sessionId, id)))));
    };
    tell();
    return useCanvasPanels.subscribe(tell);
  }, [client]);
}
