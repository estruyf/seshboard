import { openPanelLauncher } from './panelLauncherStore.ts';
import { usePreferences } from './preferencesStore.ts';

/**
 * Settings › Conversation › Open the side panel in new sessions: a session you start opens with the empty side panel
 * beside it. Quiet, so the message box keeps the focus.
 */
export function openSidePanelOnStart(sessionId: string): void {
  if (usePreferences.getState().prefs.sidePanelOnNewSession) openPanelLauncher(sessionId, { quiet: true });
}
