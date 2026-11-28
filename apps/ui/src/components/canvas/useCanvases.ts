import { useCallback, useEffect, useState } from 'react';
import { isAbsolutePath, type CanvasListed } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';

const NONE: CanvasListed[] = [];

/**
 * The canvases a session in `cwd` can open (docs/canvases.md), with what each is doing. Read again when the engine says
 * one changed, and when the window comes back to the front: an agent may have written a canvas meanwhile.
 */
export function useCanvases(cwd: string | null): { canvases: CanvasListed[]; reload(): void } {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [state, setState] = useState<{ folder: string | null; canvases: CanvasListed[] }>({ folder: null, canvases: NONE });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!client || !(cwd && isAbsolutePath(cwd))) {
      setState({ folder: null, canvases: NONE });
      return;
    }
    let cancelled = false;
    client.call('canvases.list', { cwd }).then(
      (r) => !cancelled && setState({ folder: r.folder, canvases: r.canvases.length ? r.canvases : NONE }),
      () => !cancelled && setState({ folder: null, canvases: NONE }),
    );
    return () => {
      cancelled = true;
    };
  }, [client, cwd, version]);

  const folder = state.folder;
  useEffect(() => client?.on('canvases.changed', (event) => (folder === null || event.folder === folder) && reload()), [client, folder, reload]);
  useEffect(() => {
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [reload]);

  return { canvases: state.canvases, reload };
}
