import { terminalOwner, type TerminalView } from '../terminal/appTerminal.ts';
import { localSessionId } from '../../state/remoteSelection.ts';
import { useOverlay } from '../../state/overlayStore.ts';
import { useSessions, type MainView } from '../../state/sessionsStore.ts';

/*
 * What the main window's keys and its title bar share: Go to (⌘P), and whose terminal ⌘J works on. One function each,
 * so the button and the key never drift apart.
 */

/** What the main area shows, as the terminal sees it: Home is the session view without a session. */
export function terminalView(view: MainView, sessionId: string | null): TerminalView {
  return view === 'new' ? 'new-session' : view === 'session' ? (sessionId ? 'session' : 'home') : view;
}

/**
 * The panel ⌘J and ⌘⇧J work on: the session's in the active pane, the window's own elsewhere (Settings too). None
 * for a session on another computer: its terminal is there.
 */
export function currentTerminalOwner(): string | null {
  const { view, selectedId } = useSessions.getState();
  return terminalOwner(terminalView(view, selectedId), localSessionId(selectedId));
}

/** ⌘P and the title bar's search field: Go to a session or project, or closes it when it is open. */
export function openGoTo(): void {
  useOverlay.getState().togglePalette('goto');
}
