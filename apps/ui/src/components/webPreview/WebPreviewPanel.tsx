import { ArrowLeft, ArrowRight, ExternalLink, Globe, RotateCw, Smartphone, X } from 'lucide-react';
import { useCallback, useState, type FormEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { addressBarUrl, shortUrl, WEB_PREVIEW_PHONE_WIDTH } from '@seshboard/protocol/client';
import { useWebPreview, type SessionWeb } from '../../state/webPreviewStore.ts';
import { ASK_MAX_SHARE, ASK_MIN_WIDTH, askWidthForKey } from '../ask/askWidth.ts';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import type { ServerOffer } from './serverOffers.ts';
import { previewPage, registerSlot, usePageState } from './webPreviewPages.ts';

interface WebPreviewPanelProps {
  sessionId: string;
  web: SessionWeb;
  /** The servers running in the session's terminals, for the empty page. */
  offers: readonly ServerOffer[];
  width: number;
  onWidth(width: number): void;
  /** Other panels are open too: this row of tabs stands in for the header's buttons. */
  tabs?: (actions: ReactNode) => ReactNode;
}

/**
 * A session's running dev server on the right next to the conversation, a tab beside Changes, Ask and the rest. The
 * page itself is not in here: it lives at the end of the window (`webPreviewPages.ts`), so it keeps running while
 * another tab or session is on screen, and is drawn over this panel's slot. Main checks it: local addresses only, its
 * own partition, no Node; outside links open in the browser.
 */
export function WebPreviewPanel({ sessionId, web, offers, width, onWidth, tabs }: WebPreviewPanelProps) {
  const page = usePageState(sessionId);
  // What is being typed in the address bar; null shows the page's own address.
  const [draft, setDraft] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const slot = useCallback((element: HTMLDivElement | null) => registerSlot(sessionId, element), [sessionId]);
  const close = () => useWebPreview.getState().close(sessionId);
  const reload = () => previewPage(sessionId)?.reload(web.url);

  const go = (event: FormEvent) => {
    event.preventDefault();
    const url = addressBarUrl(draft ?? '');
    setRefused(url === null);
    if (!url) return;
    setDraft(null);
    useWebPreview.getState().open(sessionId, url);
  };
  const onAddressKey = (event: KeyboardEvent<HTMLInputElement>) => {
    // Escape gives back the page's own address first; a second one closes the panel (the aside's handler).
    if (event.key !== 'Escape' || (draft === null && !refused)) return;
    event.preventDefault();
    event.stopPropagation();
    setDraft(null);
    setRefused(false);
  };

  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[role=menu], [role=dialog], [role=alertdialog]')) return;
    event.preventDefault();
    close();
  };
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startWidth = width;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    // The page would take the pointer while it crosses it.
    previewPage(sessionId)?.setPointer(false);
    const move = (e: globalThis.PointerEvent) => onWidth(startWidth + (startX - e.clientX));
    const up = () => {
      previewPage(sessionId)?.setPointer(true);
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

  const actions = <Button variant="quiet" size="sm" iconOnly icon={<X size={14} aria-hidden />} aria-label="Close web preview" data-web-preview-close="" onClick={close} />;
  const failure = web.url ? page.failure : null;

  return (
    <aside
      aria-label="Web preview"
      tabIndex={-1}
      onKeyDown={onKey}
      className="relative flex max-w-[85%] min-w-0 shrink-0 flex-col bg-sidebar outline-none forced-colors:border-l"
      style={{ width }}
      data-web-preview=""
      data-web-preview-loading={page.loading ? '' : undefined}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Web preview width"
        aria-valuenow={width}
        aria-valuemin={ASK_MIN_WIDTH}
        aria-valuemax={Math.round(window.innerWidth * ASK_MAX_SHARE)}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={resizeByKey}
        className="absolute inset-y-0 -left-0.5 z-20 w-1 cursor-col-resize hover:bg-accent-ink/40 focus-visible:bg-accent-ink/40"
        data-tooltip="Drag (or use ← →) to resize"
      />
      {tabs ? (
        tabs(actions)
      ) : (
        <header className="flex shrink-0 items-center gap-2 px-3 pt-2.5 pb-2">
          <Globe size={16} aria-hidden className="shrink-0 text-accent-ink" />
          <h2 className="min-w-0 flex-1 truncate text-ui font-semibold text-text">{web.url ? shortUrl(web.url) : 'Web preview'}</h2>
          <div className="flex shrink-0 items-center">{actions}</div>
        </header>
      )}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border px-2 py-1" data-web-preview-toolbar="">
        <Button variant="quiet" size="sm" iconOnly icon={<ArrowLeft size={13} aria-hidden />} aria-label="Back" disabled={!page.back} onClick={() => previewPage(sessionId)?.back()} data-web-preview-back="" />
        <Button variant="quiet" size="sm" iconOnly icon={<ArrowRight size={13} aria-hidden />} aria-label="Forward" disabled={!page.forward} onClick={() => previewPage(sessionId)?.forward()} data-web-preview-forward="" />
        {page.loading ? (
          <Button variant="quiet" size="sm" iconOnly icon={<X size={13} aria-hidden />} aria-label="Stop loading" onClick={() => previewPage(sessionId)?.stop()} data-web-preview-stop="" />
        ) : (
          <Button variant="quiet" size="sm" iconOnly icon={<RotateCw size={12} aria-hidden />} aria-label="Reload" disabled={!web.url} onClick={reload} data-web-preview-reload="" />
        )}
        <form onSubmit={go} className="mx-1 min-w-0 flex-1">
          <input
            type="text"
            value={draft ?? (web.url ? shortUrl(web.url) : '')}
            onChange={(e) => {
              setDraft(e.target.value);
              setRefused(false);
            }}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => !refused && setDraft(null)}
            onKeyDown={onAddressKey}
            placeholder="localhost:5173"
            spellCheck={false}
            aria-label="Address"
            aria-invalid={refused || undefined}
            className={`h-7 w-full rounded-md border bg-card px-2 font-mono text-ui text-text outline-none placeholder:text-faint focus:border-link ${refused ? 'border-error' : 'border-edge'}`}
            data-web-preview-address=""
          />
        </form>
        <Button
          variant="quiet"
          size="sm"
          iconOnly
          icon={<Smartphone size={13} aria-hidden />}
          aria-label={web.phone ? 'Full width' : 'Phone width'}
          aria-pressed={web.phone}
          selected={web.phone}
          onClick={() => useWebPreview.getState().setPhone(sessionId, !web.phone)}
          data-web-preview-phone=""
        />
        <Button variant="quiet" size="sm" iconOnly icon={<ExternalLink size={13} aria-hidden />} aria-label="Open in browser" disabled={!web.url} onClick={() => web.url && window.open(web.url, '_blank')} data-web-preview-open-external="" />
      </div>
      {refused && (
        <Notice inline tone="error" className="shrink-0 px-3 py-1.5 text-meta" data-web-preview-refused="">
          Only addresses on this computer open here, such as localhost:3000.
        </Notice>
      )}
      <div className={`relative min-h-0 flex-1 ${web.phone ? 'flex justify-center bg-code py-3' : ''}`}>
        {/* The page is drawn over this slot; with nothing to show (no address, a failed load) it stays parked. */}
        <div
          ref={slot}
          className={web.phone ? 'h-full shrink-0 overflow-hidden rounded-lg shadow-lg' : 'size-full'}
          style={web.phone ? { width: WEB_PREVIEW_PHONE_WIDTH } : undefined}
          data-covered={!web.url || failure ? '' : undefined}
          data-web-preview-slot=""
        />
        {!web.url && <EmptyPage sessionId={sessionId} offers={offers} />}
        {failure && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-sidebar px-6 text-center" data-web-preview-unreachable="">
            <p className="text-body text-text">Nothing is running at {shortUrl(failure.url || web.url!)}</p>
            <p className="text-meta text-muted">{failure.description}</p>
            <Button size="sm" icon={<RotateCw size={11} aria-hidden />} onClick={reload} data-web-preview-retry="">
              Retry
            </Button>
          </div>
        )}
      </div>
    </aside>
  );
}

/** Before a page is picked: the servers running in the session, or how to get one. */
function EmptyPage({ sessionId, offers }: { sessionId: string; offers: readonly ServerOffer[] }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-sidebar px-6 text-center" data-web-preview-empty="">
      <Globe size={22} aria-hidden className="text-faint" />
      {offers.length > 0 ? (
        <>
          <p className="text-ui text-muted">Running in this session:</p>
          <div className="flex flex-col items-stretch gap-1.5">
            {offers.map((offer) => (
              <Button key={offer.url} size="sm" onClick={() => useWebPreview.getState().open(sessionId, offer.url)} data-web-preview-offer={offer.url}>
                <span className="font-mono">{shortUrl(offer.url)}</span>
                <span className="text-muted">{offer.title}</span>
              </Button>
            ))}
          </div>
        </>
      ) : (
        <p className="max-w-64 text-ui text-muted">Run your dev server from a project action or the terminal, or type its address above.</p>
      )}
    </div>
  );
}
