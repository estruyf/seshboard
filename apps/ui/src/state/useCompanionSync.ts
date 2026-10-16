import { useEffect } from 'react';
import { useEngineConnection } from '../engine/useEngine.ts';
import { newDraftKey } from './drafts.ts';
import { useDrafts } from './draftsStore.ts';
import { useLinks } from './linksStore.ts';
import { usePreferences } from './preferencesStore.ts';
import { localSessionId } from './remoteSelection.ts';
import { useSessions } from './sessionsStore.ts';

/**
 * The VS Code companion, window side: tells the engine which session is on screen (context goes there first) and
 * which sessions the sidebar lists (the editor lists the same), adds
 * the context the editor sends as chips (to a session, or New session on a folder), and shows a session when asked.
 * Nothing is ever sent to Claude from here: the chips wait in the message box until you send.
 */
export function useCompanionSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const view = useSessions((s) => s.view);
  const selectedId = useSessions((s) => s.selectedId);
  const focused = view === 'session' ? localSessionId(selectedId) : null;
  const scope = usePreferences((s) => s.prefs.sessionScope);

  useEffect(() => {
    if (client) void client.call('companion.focus', { sessionId: focused, scope }).catch(() => {});
  }, [client, focused, scope]);

  useEffect(() => {
    if (!client) return;
    const offs = [
      client.on('companion.context', ({ deliveryId, target, items, reveal }) => {
        let error: string | null = null;
        try {
          if (target.kind === 'session') {
            useDrafts.getState().addContext(target.sessionId, items);
            if (reveal) {
              useSessions.getState().select(target.sessionId);
              useDrafts.getState().requestFocus(target.sessionId);
            }
          } else {
            useDrafts.getState().addContext(newDraftKey(target.cwd), items);
            // New session on that folder, as a link would open it; the chips are already in its box.
            if (reveal) void useLinks.getState().open({ action: 'new-session', cwd: target.cwd, prompt: null, project: null, repo: null, autostart: false, question: false });
          }
          if (reveal) window.switchboard?.focusWindow();
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }
        void client.call('companion.received', { deliveryId, error }).catch(() => {});
      }),
      client.on('companion.reveal', ({ sessionId }) => {
        useSessions.getState().select(sessionId);
        window.switchboard?.focusWindow();
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [client]);
}
