import { ArrowLeft, ArrowRight, ExternalLink, Globe, RotateCw, X } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { browserAddress, shortUrl } from '@seshboard/protocol/client';
import { closeBrowser, ensureBrowserPage, useBrowser } from '../../state/browserStore.ts';
import { SidebarToggle } from '../sidebar/SidebarToggle.tsx';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { BROWSER_PAGE, openBrowserPage, registerSlot, usePageState } from '../webPreview/webPreviewPages.ts';

/**
 * The browser: a page from the web (a pull request, a CI run) as a main view beside the sessions. The page itself is
 * not in here: it lives at the end of the window (`webPreviewPages.ts`), so it keeps its place, sign-in and scroll
 * while a session is on screen, and is drawn over this view's slot. Main checks it: web addresses only, its own
 * partition, no Node.
 */
export function BrowserView() {
  const url = useBrowser((s) => s.url);
  const page = usePageState(BROWSER_PAGE);
  // What is being typed in the address bar; null shows the page's own address.
  const [draft, setDraft] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const slot = useCallback((element: HTMLDivElement | null) => registerSlot(BROWSER_PAGE, element), []);
  // Back and forward through the app's history can land here after the browser was closed: open it afresh.
  useEffect(() => void ensureBrowserPage(), []);

  const go = (event: FormEvent) => {
    event.preventDefault();
    const next = browserAddress(draft ?? '');
    setRefused(next === null);
    if (!next) return;
    setDraft(null);
    useBrowser.setState({ url: next });
    ensureBrowserPage().load(next);
  };
  const onAddressKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape' || (draft === null && !refused)) return;
    event.preventDefault();
    event.stopPropagation();
    setDraft(null);
    setRefused(false);
  };
  const reload = () => openBrowserPage()?.reload(url);
  const failure = url ? page.failure : null;

  return (
    <div className="@container flex h-full min-h-0 flex-col bg-bg" data-browser="">
      <header className="drag flex h-13 shrink-0 items-center gap-1 px-4" data-browser-toolbar="">
        <SidebarToggle />
        <Globe size={16} aria-hidden className="mr-1 shrink-0 text-muted" />
        <div className="no-drag flex min-w-0 flex-1 items-center gap-0.5">
          <Button variant="quiet" size="sm" iconOnly icon={<ArrowLeft size={14} aria-hidden />} aria-label="Back" disabled={!page.back} onClick={() => openBrowserPage()?.back()} data-browser-back="" />
          <Button variant="quiet" size="sm" iconOnly icon={<ArrowRight size={14} aria-hidden />} aria-label="Forward" disabled={!page.forward} onClick={() => openBrowserPage()?.forward()} data-browser-forward="" />
          {page.loading ? (
            <Button variant="quiet" size="sm" iconOnly icon={<X size={14} aria-hidden />} aria-label="Stop loading" onClick={() => openBrowserPage()?.stop()} data-browser-stop="" />
          ) : (
            <Button variant="quiet" size="sm" iconOnly icon={<RotateCw size={13} aria-hidden />} aria-label="Reload" disabled={!url} onClick={reload} data-browser-reload="" />
          )}
          <form onSubmit={go} className="mx-1 min-w-0 flex-1">
            <input
              type="text"
              value={draft ?? (url ? shortUrl(url) : '')}
              onChange={(e) => {
                setDraft(e.target.value);
                setRefused(false);
              }}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={() => !refused && setDraft(null)}
              onKeyDown={onAddressKey}
              placeholder="github.com"
              spellCheck={false}
              aria-label="Address"
              aria-invalid={refused || undefined}
              className={`h-7 w-full rounded-md border bg-card px-2 font-mono text-ui text-text outline-none placeholder:text-faint focus:border-link ${refused ? 'border-error' : 'border-edge'}`}
              data-browser-address=""
            />
          </form>
          <Button variant="quiet" size="sm" iconOnly icon={<ExternalLink size={13} aria-hidden />} aria-label="Open in your browser" data-tooltip="Open in your browser" disabled={!url} onClick={() => url && window.open(url, '_blank')} data-browser-open-external="" />
          <Button variant="quiet" size="sm" iconOnly icon={<X size={14} aria-hidden />} aria-label="Close browser" data-tooltip="Close browser" onClick={closeBrowser} data-browser-close="" />
        </div>
      </header>
      {refused && (
        <Notice inline tone="error" className="shrink-0 px-4 py-1.5 text-meta" data-browser-refused="">
          Type an address, such as github.com.
        </Notice>
      )}
      <div className="relative min-h-0 flex-1">
        {/* The page is drawn over this slot; with a failed load it stays parked behind the notice. */}
        <div ref={slot} className="size-full" data-covered={failure ? '' : undefined} data-browser-slot="" />
        {failure && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center" data-browser-unreachable="">
            <p className="text-body text-text">Could not open {shortUrl(failure.url || url!)}</p>
            <p className="text-meta text-muted">{failure.description}</p>
            <Button size="sm" icon={<RotateCw size={11} aria-hidden />} onClick={reload} data-browser-retry="">
              Retry
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
