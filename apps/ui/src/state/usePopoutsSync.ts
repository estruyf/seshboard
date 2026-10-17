import { useEffect } from 'react';
import { usePopouts } from './popoutsStore.ts';
import { useSessions } from './sessionsStore.ts';

/** Follows which sessions have a window of their own; in the main window, a session that pops out leaves its pane. */
export function usePopoutsSync(): void {
  useEffect(() => {
    const bridge = window.switchboard;
    if (!bridge) return;
    const close = (ids: readonly string[]) => {
      if (!bridge.popout && ids.length > 0) useSessions.getState().closeSessions(ids);
    };
    close([...usePopouts.getState().ids]);
    return bridge.onPopoutsChanged((ids) => {
      const before = usePopouts.getState().ids;
      usePopouts.getState().setIds(ids);
      close(ids.filter((id) => !before.has(id)));
    });
  }, []);
}
