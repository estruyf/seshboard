import { useEffect, useRef } from 'react';
import { sessionKey, maximizeStep } from '../../lib/sessionKeys.ts';
import { isActiveHost, useHosts } from '../../state/hostsStore.ts';
import { popOut, popoutSession } from '../../state/popoutsStore.ts';
import { toggleTerminalPanel } from '../../state/rightPanelStore.ts';
import { useReadMode } from '../../state/readModeStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { useTerminals } from '../../state/terminalsStore.ts';
import { useOpenIn } from '../OpenInButton.tsx';

/** What the window's session shortcuts act on right now. */
export interface SessionKeyTarget {
  /** The panel the terminal keys work on: the session's, or the window's own outside a session. Null for none. */
  terminalOwner: string | null;
  /** The session Open in editor and Open in new window work on, or null (not in a session view). */
  sessionId: string | null;
}

/**
 * The shortcuts that act on the window's session (keys in `lib/shortcuts.ts`): the terminal (hide or show, maximize),
 * Open in editor, Open in new window and Read the last reply. The main window and a pop-out both use it, each saying what it is showing
 * (`target`), so a pop-out's session has the same keys as a pane. The terminal passes these keys on to the window
 * (XTerm.tsx), so they work there too.
 */
export function useSessionShortcuts(target: () => SessionKeyTarget): void {
  const openIn = useOpenIn();
  const targetRef = useRef(target);
  targetRef.current = target;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = sessionKey(event, popoutSession !== null);
      if (!key) return;
      const { terminalOwner, sessionId } = targetRef.current();
      if (key === 'terminal.maximize') {
        // The terminal takes the whole view, or gives it back. Closed, it opens maximized.
        if (!terminalOwner) return;
        event.preventDefault();
        const { openFor, togglePanel, setMaximized } = useTerminals.getState();
        if (maximizeStep(openFor.has(terminalOwner)) === 'toggle') setMaximized(terminalOwner);
        else {
          togglePanel(terminalOwner);
          setMaximized(terminalOwner, true);
        }
      } else if (key === 'terminal.toggle') {
        // The panel of the session in the active pane; outside a session, the window's own.
        if (!terminalOwner) return;
        event.preventDefault();
        toggleTerminalPanel(terminalOwner);
      } else if (key === 'session.new-window') {
        if (!sessionId) return;
        event.preventDefault();
        popOut(sessionId);
      } else if (key === 'read.toggle') {
        // Reading mode closes from anywhere; otherwise it opens at the last reply of the session in view.
        const read = useReadMode.getState();
        if (read.open) {
          event.preventDefault();
          read.close();
        } else if (sessionId) {
          event.preventDefault();
          read.openLast(sessionId);
        }
      } else if (key === 'editor.open') {
        if (!sessionId) return;
        const { sessions, live } = useSessions.getState();
        const host = useHosts.getState().hosts.get(sessionId);
        const cwd = (isActiveHost(host) ? host.cwd : null) ?? sessions.get(sessionId)?.cwd ?? live.get(sessionId)?.cwd;
        if (cwd) {
          event.preventDefault();
          void openIn(cwd).catch(() => {});
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openIn]);
}
