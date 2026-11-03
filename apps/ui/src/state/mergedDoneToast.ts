import { useEffect } from 'react';
import { useEngineConnection } from '../engine/useEngine.ts';
import { mergedDoneText } from './mergedDoneText.ts';
import { toast } from './toastStore.ts';

/**
 * The engine moves sessions whose pull request merged to Done by itself; once a window has focus it says so, in one
 * event for the batch. The window in front shows one toast, and Undo reopens them (so the merge doesn't move them again).
 */
export function useMergedDoneToast(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client) return;
    return client.on('sessions.mergedDone', ({ sessions }) => {
      if (sessions.length === 0 || !document.hasFocus()) return;
      toast(mergedDoneText(sessions), {
        icon: 'archive',
        undo: () => {
          for (const { id } of sessions) void client.call('sessions.setFlags', { sessionId: id, archived: false }).catch(() => {});
        },
      });
    });
  }, [client]);
}
