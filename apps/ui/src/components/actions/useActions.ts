import { useCallback, useEffect, useState } from 'react';
import { isAbsolutePath, type ListedAction } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';

export { ACTION_ICON } from './actionIcon.ts';
export { ariaShortcut, formatShortcut, reservedShortcuts, shortcutFromEvent } from '../../lib/shortcuts.ts';

/** A project's actions (yours, shared and global), reloaded on demand. */
export function useProjectActionList(projectRoot: string | null) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [state, setState] = useState<{ actions: ListedAction[]; sharedFile: string | null; errors: string[] }>({ actions: [], sharedFile: null, errors: [] });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    // Sessions without a recorded folder have no project to hold actions.
    if (!client || !(projectRoot && isAbsolutePath(projectRoot))) {
      setState({ actions: [], sharedFile: null, errors: [] });
      return;
    }
    let cancelled = false;
    client.call('actions.list', { projectRoot }).then(
      (r) => !cancelled && setState(r),
      () => !cancelled && setState({ actions: [], sharedFile: null, errors: [] }),
    );
    return () => {
      cancelled = true;
    };
  }, [client, projectRoot, version]);

  // An import (in any window) can add, change or remove actions.
  useEffect(() => client?.on('settings.imported', () => setVersion((v) => v + 1)), [client]);

  return {
    ...state,
    reload: useCallback(() => setVersion((v) => v + 1), []),
    /** Changes the list at once (a save or delete), before the reload confirms it. */
    update: useCallback((change: (actions: ListedAction[]) => ListedAction[]) => setState((s) => ({ ...s, actions: change(s.actions) })), []),
  };
}
