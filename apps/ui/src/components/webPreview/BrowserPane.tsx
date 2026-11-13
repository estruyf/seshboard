import { ArrowLeft, ArrowRight, ChevronLeft, Code, Copy, Ellipsis, ExternalLink, Globe, LogOut, Pencil, Pin, Plus, RotateCw, Smartphone, Star, Trash2, Volume2, VolumeX, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { addressBarUrl, browserNavigation, loadErrorText, shortUrl, webPageUrl, WEB_PREVIEW_PHONE_WIDTH } from '@seshboard/protocol/client';
import { formatKeys, keysFor } from '../../lib/shortcuts.ts';
import { askClearData, askRename, copyAddress, toggleDevTools, toggleMute, zoomPage } from '../../state/browserActions.ts';
import { toggleFavorite, useFavoriteOf } from '../../state/browserFavoritesStore.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useWebPreview } from '../../state/webPreviewStore.ts';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { tabName, zoomLabel, type BrowserTab } from './browserTabs.ts';
import { FavoriteTiles } from './FavoriteTiles.tsx';
import type { ServerOffer } from './serverOffers.ts';
import { previewPage, registerSlot, usePageState } from './webPreviewPages.ts';

/** Why the address bar refused what was typed: not an address at all, or an address the browser won't open. */
type Refusal = 'not-address' | 'scheme' | 'local-only';

/** What was typed, as the browser loads it, or why not. */
export function readAddress(text: string, browser: boolean): { url: string } | { refused: Refusal } {
  const url = addressBarUrl(text, { anyHost: browser });
  if (url) return { url };
  if (!browser) return { refused: 'local-only' };
  return /^[a-z][a-z0-9+.-]*:/i.test(text.trim()) && !/^[^/:]+:\d+([/?#]|$)/.test(text.trim()) ? { refused: 'scheme' } : { refused: 'not-address' };
}

interface BrowserPaneProps {
  /** The tab on screen; null with no tab (the Browser view before one is picked). */
  tab: BrowserTab | null;
  /** The owner's tabs, for the strip under the toolbar; left out where the tabs are listed elsewhere (the Browser view). */
  tabs?: readonly BrowserTab[];
  /** Opens a new tab for the owner (the strip's +, ⌘T). */
  onNewTab?(): void;
  /** The servers running in the session, for an empty tab. */
  offers?: readonly ServerOffer[];
  /** Before the toolbar's buttons: ‹ Conversation in Full. */
  lead?: ReactNode;
  /** After the toolbar's buttons: the panel's sizes and close. */
  trail?: ReactNode;
  /** With no tab: the empty state. */
  empty?: ReactNode;
  /**
   * The toolbar is the view's header (the Browser view, which has no title row with a tab open): the header's height and
   * padding (`PANE_HEADER`), and the window's drag handle between its controls. `lead` puts the sidebar toggle first.
   */
  asHeader?: boolean;
}

/**
 * A browser tab's toolbar (back, forward, reload, the address bar, pin, open in browser), its tab strip and the slot its
 * page is drawn over. The page itself lives at the end of the window (`webPreviewPages.ts`), so it keeps running while
 * another tab, view or session is in front. Shared by a session's Browser panel and the Browser view. With Browser
 * (preview) off, it is the web preview as it always was: local addresses only, one page, no strip or pin.
 */
export function BrowserPane({ tab, tabs, onNewTab, offers = [], lead, trail, empty, asHeader = false }: BrowserPaneProps) {
  const browser = usePreferences((s) => s.prefs.browserEnabled);
  const page = usePageState(tab?.id ?? null);
  // What is being typed in the address bar; null shows the page's own address.
  const [draft, setDraft] = useState<string | null>(null);
  const [refused, setRefused] = useState<Refusal | null>(null);
  const slot = useCallback((element: HTMLDivElement | null) => {
    if (tab) registerSlot(tab.id, element);
  }, [tab?.id]);
  const address = useRef<HTMLInputElement>(null);
  const tabId = tab?.id ?? null;
  const favorite = useFavoriteOf(tab?.url ?? null) !== undefined;
  const [more, setMore] = useState<{ x: number; y: number } | null>(null);

  // A new, empty tab starts in the address bar.
  useEffect(() => {
    if (tab && !tab.url) address.current?.focus();
  }, [tabId]);
  // Leaving with the address bar focused: main stops keeping ⌘W for it.
  useEffect(() => () => window.seshboard?.setAddressFocus(false), []);

  const go = (event: FormEvent) => {
    event.preventDefault();
    if (!tab) return;
    const read = readAddress(draft ?? '', browser);
    if ('refused' in read) return setRefused(read.refused);
    setRefused(null);
    setDraft(null);
    useWebPreview.getState().navigate(tab.id, read.url);
  };
  const onAddressKey = (event: KeyboardEvent<HTMLInputElement>) => {
    // Escape gives back the page's own address first; a second one closes the panel (the aside's handler).
    if (event.key !== 'Escape' || (draft === null && !refused)) return;
    event.preventDefault();
    event.stopPropagation();
    setDraft(null);
    setRefused(null);
  };
  const reload = () => tab && previewPage(tab.id)?.reload(tab.url);
  const failure = tab?.url ? page.failure : null;
  const covered = !tab?.url || !!failure || page.crashed;
  const typed = draft ?? '';
  const refusedWeb = refused === 'scheme' && browserNavigation(typed) === 'stay' ? webPageUrl(typed) : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        className={`relative flex shrink-0 items-center gap-0.5 border-b border-border ${asHeader ? 'drag h-13 px-6 *:no-drag @max-[860px]:px-4' : 'px-2 py-1'}`}
        data-web-preview-toolbar=""
      >
        {lead}
        <Button variant="quiet" size="sm" iconOnly icon={<ArrowLeft size={13} aria-hidden />} aria-label="Back" disabled={!page.back} onClick={() => tab && previewPage(tab.id)?.back()} data-web-preview-back="" />
        <Button variant="quiet" size="sm" iconOnly icon={<ArrowRight size={13} aria-hidden />} aria-label="Forward" disabled={!page.forward} onClick={() => tab && previewPage(tab.id)?.forward()} data-web-preview-forward="" />
        {page.loading ? (
          <Button variant="quiet" size="sm" iconOnly icon={<X size={13} aria-hidden />} aria-label="Stop loading" onClick={() => tab && previewPage(tab.id)?.stop()} data-web-preview-stop="" />
        ) : (
          <Button variant="quiet" size="sm" iconOnly icon={<RotateCw size={12} aria-hidden />} aria-label="Reload" disabled={!tab?.url} onClick={reload} data-web-preview-reload="" />
        )}
        <form onSubmit={go} className="mx-1 min-w-0 flex-1">
          <input
            ref={address}
            type="text"
            value={draft ?? (tab?.url ? shortUrl(tab.url) : '')}
            disabled={!tab}
            onChange={(e) => {
              setDraft(e.target.value);
              setRefused(null);
            }}
            onFocus={(e) => {
              e.currentTarget.select();
              if (browser) window.seshboard?.setAddressFocus(true);
            }}
            onBlur={() => {
              window.seshboard?.setAddressFocus(false);
              if (!refused) setDraft(null);
            }}
            onKeyDown={onAddressKey}
            placeholder={browser ? 'Type an address' : 'localhost:5173'}
            spellCheck={false}
            aria-label="Address"
            aria-invalid={refused ? true : undefined}
            aria-keyshortcuts={browser ? formatKeys(keysFor('browser.address')) : undefined}
            className={`h-7 w-full rounded-md border bg-card px-2 font-mono text-ui text-text outline-none placeholder:text-faint focus:border-link ${refused ? 'border-error' : 'border-edge'}`}
            data-web-preview-address=""
            data-browser-address=""
            data-tab-id={tab?.id}
          />
        </form>
        {browser && tab && (
          <Button
            variant="quiet"
            size="sm"
            iconOnly
            icon={<Pin size={13} aria-hidden />}
            aria-label={tab.pinned ? 'Unpin tab' : 'Pin tab'}
            data-tooltip={tab.pinned ? 'Unpin tab' : 'Pin tab: keep it after a restart'}
            aria-pressed={tab.pinned}
            selected={tab.pinned}
            disabled={!tab.url}
            onClick={() => (tab.pinned ? useWebPreview.getState().unpin(tab.id) : useWebPreview.getState().pin(tab.id))}
            data-web-preview-pin=""
          />
        )}
        {browser && tab && (
          <Button
            variant="quiet"
            size="sm"
            iconOnly
            icon={<Star size={13} aria-hidden className={favorite ? 'fill-current' : undefined} />}
            aria-label={favorite ? 'Remove from favourites' : 'Add to favourites'}
            data-tooltip={favorite ? 'Remove from favourites' : 'Add to favourites'}
            shortcut="browser.favorite"
            aria-pressed={favorite}
            selected={favorite}
            disabled={!tab.url}
            onClick={() => toggleFavorite(tab)}
            data-web-preview-favorite=""
          />
        )}
        {!browser && <Button
          variant="quiet"
          size="sm"
          iconOnly
          icon={<Smartphone size={13} aria-hidden />}
          aria-label={tab?.phone ? 'Full width' : 'Phone width'}
          aria-pressed={tab?.phone ?? false}
          selected={tab?.phone ?? false}
          disabled={!tab}
          onClick={() => tab && useWebPreview.getState().setPhone(tab.id, !tab.phone)}
          data-web-preview-phone=""
        />}
        {/* Zoomed: how much, and a click for 100%. */}
        {tab && tab.zoom !== 1 && (
          <Button variant="quiet" size="sm" onClick={() => zoomPage(tab, 0)} data-tooltip="Back to 100%" aria-label={`Zoom ${zoomLabel(tab.zoom)}. Back to 100%`} data-web-preview-zoom={zoomLabel(tab.zoom)}>
            <span className="tabular-nums">{zoomLabel(tab.zoom)}</span>
          </Button>
        )}
        <Button variant="quiet" size="sm" iconOnly icon={<ExternalLink size={13} aria-hidden />} aria-label="Open in browser" data-tooltip="Open in browser" disabled={!tab?.url} onClick={() => tab?.url && window.open(tab.url, '_blank')} data-web-preview-open-external="" />
        {browser && tab && (
          <Button
            variant="quiet"
            size="sm"
            iconOnly
            icon={<Ellipsis size={13} aria-hidden />}
            aria-label="More for this page"
            aria-haspopup="menu"
            aria-expanded={more !== null}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setMore(more ? null : { x: rect.right - 220, y: rect.bottom + 4 });
            }}
            data-web-preview-more=""
          />
        )}
        {more && tab && <Menu x={more.x} y={more.y} entries={pageMenu(tab)} label="Page menu" onClose={() => setMore(null)} />}
        {trail}
        {/* Loading: a thin line under the toolbar. */}
        {page.loading && <div aria-hidden className="absolute inset-x-0 -bottom-px h-0.5 animate-pulse bg-accent-ink" data-web-preview-progress="" />}
      </div>
      {/* From the first tab: each has its ×, and + opens another. */}
      {browser && tabs && tabs.length > 0 && <TabStrip tabs={tabs} activeId={tab?.id ?? null} onNewTab={onNewTab} />}
      {refused && (
        <Notice inline tone="error" className="shrink-0 px-3 py-1.5 text-meta" data-web-preview-refused={refused}>
          {refused === 'local-only' ? 'Only addresses on this computer open here, such as localhost:3000.' : refused === 'scheme' ? "Seshboard can't open this address" : 'Type an address'}
          {refusedWeb && (
            <Button size="sm" className="ml-2" icon={<ExternalLink size={11} aria-hidden />} onClick={() => window.open(refusedWeb, '_blank')}>
              Open in browser
            </Button>
          )}
        </Notice>
      )}
      <div className={`relative min-h-0 flex-1 ${tab?.phone ? 'flex justify-center bg-code py-3' : ''}`}>
        {/* The page is drawn over this slot; with nothing to show (no address, a failed load) it stays parked. */}
        {tab && (
          <div
            ref={slot}
            className={tab.phone ? 'h-full shrink-0 overflow-hidden rounded-lg shadow-lg' : 'size-full'}
            style={tab.phone ? { width: WEB_PREVIEW_PHONE_WIDTH } : undefined}
            data-covered={covered ? '' : undefined}
            data-web-preview-slot=""
          />
        )}
        {!tab && empty}
        {tab && !tab.url && <EmptyTab tabId={tab.id} offers={offers} browser={browser} />}
        <div aria-live="polite" className="contents">
          {failure && !page.crashed && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-sidebar px-6 text-center" data-web-preview-unreachable="">
              {browser ? (
                <>
                  <p className="text-body text-text">Couldn't open this page</p>
                  <p className="text-meta text-muted">{loadErrorText(failure.description)}</p>
                  <div className="flex gap-2">
                    <Button size="sm" icon={<RotateCw size={11} aria-hidden />} onClick={reload} data-web-preview-retry="">
                      Try again
                    </Button>
                    <Button size="sm" icon={<ExternalLink size={11} aria-hidden />} onClick={() => window.open(failure.url || tab!.url!, '_blank')}>
                      Open in browser
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-body text-text">Nothing is running at {shortUrl(failure.url || tab!.url!)}</p>
                  <p className="text-meta text-muted">{loadErrorText(failure.description)}</p>
                  <Button size="sm" icon={<RotateCw size={11} aria-hidden />} onClick={reload} data-web-preview-retry="">
                    Retry
                  </Button>
                </>
              )}
            </div>
          )}
          {page.crashed && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-sidebar px-6 text-center" data-web-preview-crashed="">
              <p className="text-body text-text">This page stopped</p>
              <Button size="sm" icon={<RotateCw size={11} aria-hidden />} onClick={reload}>
                Reload
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The session's tabs under the toolbar: pinned ones first, each with × on hover, then +. A double click renames one. Scrolls sideways, keeping the tab in front in view. */
function TabStrip({ tabs, activeId, onNewTab }: { tabs: readonly BrowserTab[]; activeId: string | null; onNewTab?(): void }) {
  const strip = useRef<HTMLDivElement>(null);
  const confirming = useWebPreview((s) => s.confirming);
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId]);
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const index = tabs.findIndex((t) => t.id === activeId);
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    if (!next) return;
    event.preventDefault();
    useWebPreview.getState().selectTab(next.id);
    requestAnimationFrame(() => strip.current?.querySelector<HTMLElement>(`[data-browser-tab="${CSS.escape(next.id)}"]`)?.focus());
  };
  return (
    <div className="flex shrink-0 items-center gap-0.5 border-b border-border px-1.5 py-1">
      <div ref={strip} role="tablist" aria-label="Tabs" onKeyDown={onKey} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]" data-web-preview-tabs="">
        {tabs.map((t) => {
          const selected = t.id === activeId;
          const asking = confirming === t.id;
          return (
            <div key={t.id} className={`group relative flex h-7 max-w-44 min-w-24 shrink-0 items-center rounded-md ${selected ? 'bg-selected text-text' : 'text-muted hover:bg-border/45 hover:text-text'}`}>
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                aria-label={tabLabel(t, asking)}
                tabIndex={selected ? 0 : -1}
                onClick={() => useWebPreview.getState().selectTab(t.id)}
                onDoubleClick={() => askRename(t)}
                onMouseDown={middleDown}
                onAuxClick={(e) => middleClose(e, t.id)}
                className="flex h-full min-w-0 flex-1 items-center gap-1.5 pr-6 pl-2 text-left text-ui"
                data-browser-tab={t.id}
                data-browser-pinned={t.pinned ? '' : undefined}
                data-browser-confirm-close={asking ? '' : undefined}
              >
                <TabIcon tab={t} />
                <TabTitle tab={t} confirming={asking} />
                <SoundMark tab={t} />
                {t.pinned && !asking && <Pin size={10} aria-hidden className="shrink-0 text-faint" />}
              </button>
              <button
                type="button"
                aria-label={asking ? `Close ${tabName(t)} (pinned)` : `Close ${tabName(t)}`}
                onClick={() => useWebPreview.getState().askClose(t.id)}
                className={`absolute right-1 flex size-5 items-center justify-center rounded hover:bg-border/60 focus-visible:opacity-100 ${asking ? 'text-error opacity-100' : 'text-muted opacity-0 group-hover:opacity-100 hover:text-text'}`}
                data-browser-tab-close={t.id}
              >
                <X size={11} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
      {onNewTab && <Button variant="quiet" size="sm" iconOnly icon={<Plus size={13} aria-hidden />} aria-label="New tab" shortcut="browser.new-tab" onClick={onNewTab} data-browser-new-tab="" />}
    </div>
  );
}

/** A speaker on a tab whose page plays sound, crossed out while it is muted. */
export function SoundMark({ tab, size = 11 }: { tab: Pick<BrowserTab, 'audible' | 'muted'>; size?: number }) {
  if (tab.muted) return <VolumeX size={size} aria-label="Muted" role="img" className="shrink-0 text-faint" data-browser-tab-muted="" />;
  if (tab.audible) return <Volume2 size={size} aria-label="Playing sound" role="img" className="shrink-0 text-muted" data-browser-tab-audible="" />;
  return null;
}

/** A tab's name for screen readers: its title, pinned, or the question a first ask to close a pinned tab raises. */
export function tabLabel(tab: BrowserTab, confirming: boolean): string {
  if (confirming) return `${tabName(tab)}, pinned. Close again to close it`;
  return tab.pinned ? `${tabName(tab)}, pinned` : tabName(tab);
}

/** A tab's title; after a first ask to close a pinned tab, the question until it is asked again or the time runs out. */
export function TabTitle({ tab, confirming }: { tab: BrowserTab; confirming: boolean }) {
  if (confirming) return <span className="min-w-0 flex-1 truncate text-error">Close pinned tab?</span>;
  return <span className="min-w-0 flex-1 truncate">{tabName(tab)}</span>;
}

/** The toolbar's ⋯: what is used less often for the page on screen, and Clear all browsing data. */
function pageMenu(tab: BrowserTab): MenuEntry[] {
  const blank = !tab.url;
  return [
    { label: 'Rename tab…', icon: <Pencil size={13} aria-hidden />, onSelect: () => askRename(tab), data: { 'data-page-rename': true } },
    { label: 'Copy address', icon: <Copy size={13} aria-hidden />, disabled: blank, onSelect: () => copyAddress(tab) },
    'separator',
    { label: 'Zoom in', icon: <ZoomIn size={13} aria-hidden />, disabled: blank, onSelect: () => zoomPage(tab, 1) },
    { label: 'Zoom out', icon: <ZoomOut size={13} aria-hidden />, disabled: blank, onSelect: () => zoomPage(tab, -1) },
    { label: tab.zoom === 1 ? 'Actual size' : `Actual size (now ${zoomLabel(tab.zoom)})`, disabled: blank || tab.zoom === 1, onSelect: () => zoomPage(tab, 0) },
    tab.muted
      ? { label: 'Unmute tab', icon: <Volume2 size={13} aria-hidden />, onSelect: () => toggleMute(tab), data: { 'data-page-unmute': true } }
      : { label: 'Mute tab', icon: <VolumeX size={13} aria-hidden />, disabled: blank, onSelect: () => toggleMute(tab), data: { 'data-page-mute': true } },
    { label: 'Developer tools', icon: <Code size={13} aria-hidden />, disabled: blank, onSelect: () => toggleDevTools(tab), data: { 'data-page-devtools': true } },
    'separator',
    { label: 'Clear data for this site…', icon: <LogOut size={13} aria-hidden />, disabled: blank, onSelect: () => askClearData(tab), data: { 'data-page-clear-site': true } },
    { label: 'Clear all browsing data…', icon: <Trash2 size={13} aria-hidden />, onSelect: () => askClearData(null), data: { 'data-page-clear-all': true } },
  ];
}

/** A middle press on a tab: no scrolling, the click that follows closes it (`middleClose`). */
export function middleDown(event: MouseEvent<HTMLElement>): void {
  if (event.button === 1) event.preventDefault();
}

/** A middle click closes the tab, as in a browser; a pinned one takes a second (`askClose`). */
export function middleClose(event: MouseEvent<HTMLElement>, tabId: string): void {
  if (event.button !== 1) return;
  event.preventDefault();
  useWebPreview.getState().askClose(tabId);
}

/** A tab's icon (or a favourite's): the page's own, or a globe. */
export function TabIcon({ tab, size = 12 }: { tab: Pick<BrowserTab, 'favicon'>; size?: number }) {
  // Which icon failed to draw: a new one gets its chance.
  const [broken, setBroken] = useState<string | null>(null);
  if (!tab.favicon || broken === tab.favicon) return <Globe size={size} aria-hidden className="shrink-0 text-faint" />;
  return <img src={tab.favicon} alt="" aria-hidden width={size} height={size} className="shrink-0 rounded-sm" onError={() => setBroken(tab.favicon)} />;
}

/** An empty tab: the servers running in the session, or where to type, and the favourites (the browser on). */
function EmptyTab({ tabId, offers, browser }: { tabId: string; offers: readonly ServerOffer[]; browser: boolean }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-y-auto bg-sidebar px-6 py-4 text-center" data-web-preview-empty="">
      <Globe size={22} aria-hidden className="text-faint" />
      {offers.length > 0 ? (
        <>
          <p className="text-ui text-muted">Running in this session:</p>
          <div className="flex flex-col items-stretch gap-1.5">
            {offers.map((offer) => (
              <Button key={offer.url} size="sm" onClick={() => useWebPreview.getState().navigate(tabId, offer.url)} data-web-preview-offer={offer.url}>
                <span className="font-mono">{shortUrl(offer.url)}</span>
                <span className="text-muted">{offer.title}</span>
              </Button>
            ))}
          </div>
        </>
      ) : (
        <p className="max-w-64 text-ui text-muted">
          {browser ? `Type an address above (${formatKeys(keysFor('browser.address'))}).` : 'Run your dev server from a project action or the terminal, or type its address above.'}
        </p>
      )}
      {browser && (
        <div className="mt-3 flex w-full justify-center text-left">
          <FavoriteTiles onOpen={(url) => useWebPreview.getState().navigate(tabId, url)} />
        </div>
      )}
    </div>
  );
}

/** The panel's sizes: beside the conversation, or the whole session area. */
export function PanelSize({ full, onChange }: { full: boolean; onChange(full: boolean): void }) {
  return (
    <SegmentedControl
      mode="radio"
      size="sm"
      label="Panel size"
      value={full ? 'full' : 'side'}
      onChange={(value: 'side' | 'full') => onChange(value === 'full')}
      segments={[
        { value: 'side', label: 'Side', data: { 'data-web-preview-size': 'side' } },
        { value: 'full', label: 'Full', data: { 'data-web-preview-size': 'full' } },
      ]}
      className="ml-1"
    />
  );
}

/** ‹ Conversation, on the left of the toolbar in Full. */
export function BackToConversation({ onClick }: { onClick(): void }) {
  return (
    <Button variant="quiet" size="sm" icon={<ChevronLeft size={13} aria-hidden />} onClick={onClick} className="mr-1" data-web-preview-conversation="">
      Conversation
    </Button>
  );
}
