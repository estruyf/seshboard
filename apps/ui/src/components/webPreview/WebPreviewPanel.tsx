import { Globe, X } from 'lucide-react';
import { type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { shortUrl } from '@seshboard/protocol/client';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useWebPreview, type PanelWeb } from '../../state/webPreviewStore.ts';
import { ASK_MAX_SHARE, ASK_MIN_WIDTH, askWidthForKey } from '../ask/askWidth.ts';
import { Button } from '../ui/Button.tsx';
import { BackToConversation, BrowserPane, PanelSize } from './BrowserPane.tsx';
import type { ServerOffer } from './serverOffers.ts';
import { previewPage } from './webPreviewPages.ts';

interface WebPreviewPanelProps {
  sessionId: string;
  web: PanelWeb;
  /** The servers running in the session, for an empty tab. */
  offers: readonly ServerOffer[];
  width: number;
  onWidth(width: number): void;
  /** Other panels are open too: this row of tabs stands in for the header's buttons. */
  tabs?: (actions: ReactNode) => ReactNode;
}

/**
 * A session's Browser (with the browser off, its running dev server) on the right next to the conversation, a tab
 * beside Changes, Ask and the rest, or the whole session area in Full. The toolbar, tab strip and page are the
 * `BrowserPane`; the pages live at the end of the window (`webPreviewPages.ts`), so they keep running while another tab
 * or session is on screen. Main checks them: their own partition, no Node, outside links in the browser while it is off.
 */
export function WebPreviewPanel({ sessionId, web, offers, width, onWidth, tabs }: WebPreviewPanelProps) {
  const browser = usePreferences((s) => s.prefs.browserEnabled);
  const close = () => useWebPreview.getState().close(sessionId);
  const full = browser && web.full;
  const setFull = (on: boolean) => useWebPreview.getState().setFull(sessionId, on);

  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[role=menu], [role=dialog], [role=alertdialog]')) return;
    event.preventDefault();
    if (full) setFull(false);
    else close();
  };
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startWidth = width;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    // The page would take the pointer while it crosses it.
    const page = web.tab ? previewPage(web.tab.id) : undefined;
    page?.setPointer(false);
    const move = (e: globalThis.PointerEvent) => onWidth(startWidth + (startX - e.clientX));
    const up = () => {
      page?.setPointer(true);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  };
  const resizeByKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = askWidthForKey(event.key, width, window.innerWidth);
    if (next === null) return;
    event.preventDefault();
    onWidth(next);
  };

  const label = browser ? 'Close browser' : 'Close web preview';
  const actions = <Button variant="quiet" size="sm" iconOnly icon={<X size={14} aria-hidden />} aria-label={label} data-web-preview-close="" onClick={close} />;
  const newTab = () => useWebPreview.getState().openTab(sessionId, null);

  return (
    <aside
      aria-label={browser ? 'Browser' : 'Web preview'}
      tabIndex={-1}
      onKeyDown={onKey}
      className={full ? 'relative flex min-w-0 flex-1 flex-col bg-sidebar outline-none' : 'relative flex max-w-[85%] min-w-0 shrink-0 flex-col bg-sidebar outline-none forced-colors:border-l'}
      style={full ? undefined : { width }}
      data-web-preview=""
      data-web-preview-full={full ? '' : undefined}
    >
      {!full && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={browser ? 'Browser width' : 'Web preview width'}
          aria-valuenow={width}
          aria-valuemin={ASK_MIN_WIDTH}
          aria-valuemax={Math.round(window.innerWidth * ASK_MAX_SHARE)}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={resizeByKey}
          className="absolute inset-y-0 -left-0.5 z-20 w-1 cursor-col-resize hover:bg-accent-ink/40 focus-visible:bg-accent-ink/40"
          data-tooltip="Drag (or use ← →) to resize"
        />
      )}
      {tabs && !full ? (
        tabs(actions)
      ) : !browser ? (
        <header className="flex shrink-0 items-center gap-2 px-3 pt-2.5 pb-2">
          <Globe size={16} aria-hidden className="shrink-0 text-accent-ink" />
          <h2 className="min-w-0 flex-1 truncate text-ui font-semibold text-text">{web.tab?.url ? shortUrl(web.tab.url) : 'Web preview'}</h2>
          <div className="flex shrink-0 items-center">{actions}</div>
        </header>
      ) : null}
      <BrowserPane
        tab={web.tab}
        tabs={web.tabs}
        onNewTab={newTab}
        offers={offers}
        lead={full ? <BackToConversation onClick={() => setFull(false)} /> : undefined}
        trail={
          browser ? (
            <>
              <PanelSize full={full} onChange={setFull} />
              {(!tabs || full) && actions}
            </>
          ) : undefined
        }
      />
    </aside>
  );
}
