import { webPageUrl } from '@seshboard/protocol/client';
import { modKey } from '../../lib/shortcuts.ts';
import { openFavorite } from '../../state/browserViewStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useWebPreview } from '../../state/webPreviewStore.ts';

/**
 * A web link clicked in a terminal, with the browser on: a session's terminal opens it in the session's browser (a tab
 * already on that address comes to the front), the window's own terminal in the Browser view. ⌘-click (Ctrl-click),
 * the browser off or a link that is no web page leaves it to the system browser, as before.
 */
export function openTerminalLink(event: MouseEvent, uri: string, sessionId: string | null): void {
  const plain = !modKey(event) && !event.shiftKey && !event.altKey;
  const url = plain && usePreferences.getState().prefs.browserEnabled ? webPageUrl(uri) : null;
  if (!url) {
    window.open(uri, '_blank');
    return;
  }
  if (sessionId) useWebPreview.getState().open(sessionId, url);
  else openFavorite(url);
}
