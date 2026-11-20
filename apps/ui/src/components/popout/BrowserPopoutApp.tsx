import { SquareArrowDownLeft, X } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useReadyReport } from '../../engine/useReadyReport.ts';
import { currentPlatform } from '../../lib/platform.ts';
import { useBrowserBookmarksSync } from '../../state/browserBookmarksStore.ts';
import { useBrowserFavoritesSync } from '../../state/browserFavoritesStore.ts';
import { useBrowserHistorySync } from '../../state/browserHistory.ts';
import { browserKey } from '../../state/browserKeys.ts';
import { useBrowserProfilesSync } from '../../state/browserProfilesStore.ts';
import { useBrowserTabsSync } from '../../state/browserTabsSync.ts';
import { useBrowserWindowTabs } from '../../state/browserWindow.ts';
import { usePreferencesSync } from '../../state/preferencesStore.ts';
import { useProjectsSync } from '../../state/projectsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { useTerminals, useTerminalsSync } from '../../state/terminalsStore.ts';
import { useThemesSync } from '../../state/themeStore.ts';
import { useSessionsSync } from '../../state/useSessionsSync.ts';
import { browserOn, useSessionWeb, useWebPreview } from '../../state/webPreviewStore.ts';
import { Button } from '../ui/Button.tsx';
import { ToastLayer } from '../ui/Toast.tsx';
import { TooltipLayer } from '../ui/Tooltip.tsx';
import { BrowserPane } from '../webPreview/BrowserPane.tsx';
import { sessionServerOffers } from '../webPreview/serverOffers.ts';
import { WebPreviewHost } from '../webPreview/WebPreviewHost.tsx';

/**
 * A session's browser in a window of its own (`?browserpopout=<id>`), to put on another display: the session's tabs and
 * nothing else, while the session stays in its own window. Its tabs came from that window and go back to it with Move
 * back, the close button or when the last one closes (`browserWindow.ts`). The session's agent drives its pages here.
 * It saves nothing of the main window's; its pinned tabs are saved as in the main window.
 */
export function BrowserPopoutApp({ sessionId }: { sessionId: string }) {
  // The tabs first: the pinned tabs' sync starts from what was handed over.
  useBrowserWindowTabs(sessionId);
  useSessionsSync();
  useProjectsSync();
  useTerminalsSync();
  usePreferencesSync();
  useThemesSync();
  useBrowserTabsSync();
  useBrowserFavoritesSync();
  useBrowserHistorySync();
  useBrowserBookmarksSync();
  useBrowserProfilesSync();
  useReadyReport();

  const title = useSessions((s) => s.sessions.get(sessionId)?.title ?? s.live.get(sessionId)?.name ?? null);
  useEffect(() => {
    document.title = title ? `Browser · ${title} · Seshboard` : 'Browser · Seshboard';
  }, [title]);

  // ⌘T, ⌘L, ⌘W, ⌘F, ⌘⇧T and bookmarking work here as in the session's panel.
  useEffect(() => {
    const scope = { browserView: false, sessionId, root: '[data-browser-window]' };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !browserOn()) return;
      if (browserKey(event, scope)) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sessionId]);

  const web = useSessionWeb(sessionId);
  const terminals = useTerminals((s) => s.terminals);
  const offers = useMemo(() => sessionServerOffers(terminals.values(), sessionId), [terminals, sessionId]);

  return (
    <div className="@container flex h-full min-h-0 flex-col bg-sidebar" data-browser-window={sessionId}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {web && (
          <BrowserPane
            tab={web.tab}
            tabs={web.tabs}
            onNewTab={() => useWebPreview.getState().openTab(sessionId, null)}
            offers={offers}
            asHeader
            // The traffic lights sit over the toolbar's left end (macOS); elsewhere the window has its own title bar.
            lead={currentPlatform() === 'darwin' ? <span className="w-15 shrink-0" aria-hidden /> : undefined}
            trail={
              <>
                <Button
                  variant="quiet"
                  size="sm"
                  iconOnly
                  icon={<SquareArrowDownLeft size={14} aria-hidden />}
                  data-browser-move-back=""
                  onClick={() => window.seshboard?.popInBrowser()}
                  data-tooltip="Move back to the session"
                  aria-label="Move back to the session"
                  className="no-drag"
                />
                <Button
                  variant="quiet"
                  size="sm"
                  iconOnly
                  icon={<X size={14} aria-hidden />}
                  data-close-window=""
                  onClick={() => window.close()}
                  data-tooltip="Close window (the tabs go back to the session)"
                  aria-label="Close window"
                  className="no-drag"
                />
              </>
            }
          />
        )}
      </div>
      <WebPreviewHost />
      <ToastLayer />
      <TooltipLayer />
    </div>
  );
}
