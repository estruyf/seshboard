import { useEffect } from 'react';
import { useEngineConnection } from '../engine/useEngine.ts';
import { useSessions } from './sessionsStore.ts';

/** A reminder that came due stays under Reminders until you open its session: opening it (here) clears it. */
export function useReminderClear(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client) return;
    const clear = (id: string | null) => {
      if (!id || useSessions.getState().sessions.get(id)?.remindedAt == null) return;
      void client.call('sessions.clearReminder', { sessionIds: [id] }).catch(() => {});
    };
    clear(useSessions.getState().view === 'session' ? useSessions.getState().selectedId : null);
    return useSessions.subscribe((state, previous) => {
      if (state.view !== 'session') return;
      // Opened now, or the reminder came due while it was open.
      if (state.selectedId !== previous.selectedId || state.sessions !== previous.sessions) clear(state.selectedId);
    });
  }, [client]);
}
