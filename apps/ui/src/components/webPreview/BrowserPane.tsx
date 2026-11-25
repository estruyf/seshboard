import { AppWindow, ArrowLeft, ArrowRight, ChevronDown, ChevronUp, Code, Copy, Ellipsis, ExternalLink, Globe, History, Link, LogOut, Pencil, Pin, Plus, RotateCw, Search, Smartphone, SquareDashedMousePointer, SquarePen, Star, Trash2, UserRound, Volume2, VolumeX, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent, type RefObject, type MouseEvent, type ReactNode } from 'react';
import { addressBarUrl, browserNavigation, copiedAddress, githubPage, type BrowserHistoryEntry, loadErrorText, shortUrl, startFromPageLabel, webPageUrl, WEB_PREVIEW_PHONE_WIDTH } from '@seshboard/protocol/client';
import { formatKeys, keysFor, matches } from '../../lib/shortcuts.ts';
import { askClearData, askRename, copyAddress, findInPage, pickElement, toggleDevTools, toggleMute, zoomPage } from '../../state/browserActions.ts';
import { popOutBrowser } from '../../state/browserWindow.ts';
import { browserPopoutSession } from '../../state/popoutsStore.ts';
import { bookmarkPage, useBookmarkOf } from '../../state/browserBookmarksStore.ts';
import { useBrowserFavorites } from '../../state/browserFavoritesStore.ts';
import { searchHistory } from '../../state/browserHistory.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { useQueueDrag } from '../queue/useQueueDrag.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useWebPreview } from '../../state/webPreviewStore.ts';
import { Button } from '../ui/Button.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Popover } from '../ui/Popover.tsx';
import { addressSuggestions, autoPick, type AddressSuggestion } from './addressSuggestions.ts';
import { tabMenu } from './tabMenu.tsx';
import { ProfileMark, ProfileSwitch, profileSwitchMenu, useNewTabMenu } from './ProfileMenus.tsx';
import { useBrowserProfiles } from '../../state/browserProfilesStore.ts';
import { BROWSER_OWNER, sameGroup, tabName, zoomLabel, type BrowserTab } from './browserTabs.ts';
import { NewTabSections } from './NewTabPage.tsx';
import { openFavoriteInTab } from '../../state/browserViewStore.ts';
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
  const listId = useId();
  const tabId = tab?.id ?? null;
  const bookmarked = useBookmarkOf(tab) !== undefined;
  // A GitHub pull request or issue: the bar offers a session from it.
  const github = browser && tab?.url ? githubPage(tab.url) : null;
  const [more, setMore] = useState<{ x: number; y: number } | null>(null);
  // The suggestions under the address bar (the browser on): open while typing, and the row picked with ↑↓ (null: the
  // first one if Enter should open it, `autoPick`; -1: what was typed).
  const [listOpen, setListOpen] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [history, setHistory] = useState<readonly BrowserHistoryEntry[]>([]);
  const favorites = useBrowserFavorites((s) => s.favorites);
  // Only the tab's own browser profile's pages: another profile's history is another account's.
  const profileId = tab?.profileId ?? null;
  useEffect(() => {
    if (!browser || !draft?.trim()) return;
    let current = true;
    void searchHistory(draft, 50, profileId).then((entries) => current && setHistory(entries));
    return () => {
      current = false;
    };
  }, [draft, browser, profileId]);
  const suggestions = useMemo(() => {
    if (!browser || !tab || !draft?.trim()) return [];
    // Pages from the last search still count while the next one runs: those that no longer match drop out.
    const owned = useWebPreview.getState().tabs.filter((t) => t.owner === tab.owner);
    return addressSuggestions(draft, { tabs: owned, favorites, history, currentTabId: tab.id });
  }, [browser, tab?.id, tab?.owner, draft, favorites, history]);
  const showList = listOpen && suggestions.length > 0;
  const highlighted = !showList ? -1 : (picked ?? (autoPick(suggestions, 'url' in readAddress(draft ?? '', browser)) ? 0 : -1));

  // A new, empty tab starts in the address bar.
  useEffect(() => {
    if (tab && !tab.url) address.current?.focus();
  }, [tabId]);
  // Leaving with the address bar focused: main stops keeping ⌘W for it.
  useEffect(() => () => window.seshboard?.setAddressFocus(false), []);
  // Picking an element: Escape in the app stops it (the page's own Escape does too), and so does leaving the tab.
  const picking = page.picking;
  useEffect(() => {
    if (!picking || !tabId) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      previewPage(tabId)?.cancelPick();
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previewPage(tabId)?.cancelPick();
    };
  }, [picking, tabId]);

  const closeList = () => {
    setListOpen(false);
    setPicked(null);
  };
  const open = (suggestion: AddressSuggestion) => {
    if (!tab) return;
    closeList();
    setRefused(null);
    setDraft(null);
    if (suggestion.tabId) useWebPreview.getState().selectTab(suggestion.tabId);
    else useWebPreview.getState().navigate(tab.id, suggestion.url);
  };
  const go = (event: FormEvent) => {
    event.preventDefault();
    if (!tab) return;
    const suggestion = suggestions[highlighted];
    if (suggestion) return open(suggestion);
    closeList();
    // Enter on the page's own address, untouched, loads it again, as a browser does.
    if (draft === null && tab.url) {
      setRefused(null);
      return reload();
    }
    const read = readAddress(draft ?? '', browser);
    if ('refused' in read) return setRefused(read.refused);
    setRefused(null);
    setDraft(null);
    useWebPreview.getState().navigate(tab.id, read.url);
  };
  const onAddressKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (showList && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setPicked(Math.max(-1, Math.min(suggestions.length - 1, highlighted + step)));
      return;
    }
    // The first Escape closes the suggestions.
    if (event.key === 'Escape' && showList) {
      event.preventDefault();
      event.stopPropagation();
      return closeList();
    }
    // Escape gives back the page's own address first; a second one closes the panel (the aside's handler).
    if (event.key !== 'Escape' || (draft === null && !refused)) return;
    event.preventDefault();
    event.stopPropagation();
    setDraft(null);
    setRefused(null);
  };
  // The bar shows the address without its scheme: a copy of it takes the full address, so other apps paste a link.
  const onAddressCopy = (event: ClipboardEvent<HTMLInputElement>) => {
    const field = event.currentTarget;
    const start = field.selectionStart ?? 0;
    const end = field.selectionEnd ?? 0;
    const full = tab?.url ? copiedAddress(tab.url, field.value, start, end) : null;
    if (!full) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', full);
    if (event.type !== 'cut') return;
    setDraft(field.value.slice(0, start) + field.value.slice(end));
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
        className={`@container/toolbar relative flex shrink-0 items-center gap-0.5 *:shrink-0 border-b border-border ${asHeader ? 'drag h-13 px-6 *:no-drag @max-[860px]:px-4' : 'px-2 py-1'}`}
        data-web-preview-toolbar=""
      >
        {lead}
        <Button variant="quiet" size="sm" iconOnly icon={<ArrowLeft size={13} aria-hidden />} aria-label="Back" disabled={!page.back} onClick={() => tab && previewPage(tab.id)?.back()} data-web-preview-back="" />
        <Button variant="quiet" size="sm" iconOnly icon={<ArrowRight size={13} aria-hidden />} aria-label="Forward" disabled={!page.forward} onClick={() => tab && previewPage(tab.id)?.forward()} className="@max-[360px]/toolbar:hidden" data-web-preview-forward="" />
        {page.loading ? (
          <Button variant="quiet" size="sm" iconOnly icon={<X size={13} aria-hidden />} aria-label="Stop loading" onClick={() => tab && previewPage(tab.id)?.stop()} data-web-preview-stop="" />
        ) : (
          <Button variant="quiet" size="sm" iconOnly icon={<RotateCw size={12} aria-hidden />} aria-label="Reload" disabled={!tab?.url} onClick={reload} data-web-preview-reload="" />
        )}
        {/* The address keeps room to type in a narrow panel: Pin, the star and Open in browser go to ⋯ (`NARROW_HIDDEN`), the sizes to one button, and Forward (in the palette and on the mouse) goes. */}
        <form onSubmit={go} className="relative mx-1 min-w-20 flex-1">
          {/* The page's address to the clipboard in one click, from inside the bar. */}
          {browser && tab?.url && (
            <Button
              variant="quiet"
              size="sm"
              iconOnly
              icon={<Link size={12} aria-hidden />}
              aria-label="Copy address"
              data-tooltip="Copy address"
              onClick={() => copyAddress(tab)}
              className="absolute top-0.5 left-0.5 z-1"
              data-browser-copy-address=""
            />
          )}
          <input
            ref={address}
            type="text"
            value={draft ?? (tab?.url ? shortUrl(tab.url) : '')}
            disabled={!tab}
            onChange={(e) => {
              setDraft(e.target.value);
              setRefused(null);
              setListOpen(true);
              setPicked(null);
            }}
            onFocus={(e) => {
              e.currentTarget.select();
              if (browser) window.seshboard?.setAddressFocus(true);
            }}
            onBlur={() => {
              window.seshboard?.setAddressFocus(false);
              closeList();
              if (!refused) setDraft(null);
            }}
            onKeyDown={onAddressKey}
            onCopy={onAddressCopy}
            onCut={onAddressCopy}
            placeholder={browser ? 'Type an address' : 'localhost:5173'}
            spellCheck={false}
            aria-label="Address"
            aria-invalid={refused ? true : undefined}
            role={browser ? 'combobox' : undefined}
            aria-autocomplete={browser ? 'list' : undefined}
            aria-expanded={browser ? showList : undefined}
            aria-controls={showList ? listId : undefined}
            aria-activedescendant={showList && highlighted >= 0 ? `${listId}-${highlighted}` : undefined}
            aria-keyshortcuts={browser ? formatKeys(keysFor('browser.address')) : undefined}
            className={`field h-7 w-full bg-card px-2 font-mono text-ui outline-none placeholder:text-faint ${browser && tab?.url ? 'pl-7' : ''} ${refused ? 'border-error' : ''}`}
            data-web-preview-address=""
            data-browser-address=""
            data-tab-id={tab?.id}
          />
          {showList && <SuggestionList id={listId} anchor={address} suggestions={suggestions} highlighted={highlighted} onPick={open} onHighlight={setPicked} onClose={closeList} />}
        </form>
        {/* A session from the GitHub pull request or issue: New session in the main window, in a checkout of its
            repository (main reads the address again). In a narrow panel only its icon shows. */}
        {github && tab && (
          <Button
            size="sm"
            icon={<SquarePen size={13} aria-hidden />}
            aria-label={startFromPageLabel(github)}
            data-tooltip={`${startFromPageLabel(github)} in ${github.repo}`}
            onClick={() => tab.url && window.seshboard?.startFromPage(tab.url)}
            className="mr-1"
            data-browser-start-session={`${github.type}:${github.number}`}
          >
            <span className={NARROW_HIDDEN}>Start session</span>
          </Button>
        )}
        {/* The tab's browser profile, and the way to move it to another. */}
        {browser && tab && <ProfileSwitch tab={tab} />}
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
            className={NARROW_HIDDEN}
            data-web-preview-pin=""
          />
        )}
        {browser && tab && (
          <Button
            variant="quiet"
            size="sm"
            iconOnly
            icon={<Star size={13} aria-hidden className={bookmarked ? 'fill-current' : undefined} />}
            aria-label={bookmarked ? 'Edit bookmark' : 'Bookmark this page'}
            data-tooltip={bookmarked ? 'Edit bookmark' : 'Bookmark this page'}
            shortcut="browser.bookmark"
            aria-pressed={bookmarked}
            selected={bookmarked}
            disabled={!tab.url}
            onClick={() => bookmarkPage(tab)}
            className={NARROW_HIDDEN}
            data-web-preview-bookmark=""
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
        {tab && tab.owner !== BROWSER_OWNER && (
          <Button
            variant="quiet"
            size="sm"
            iconOnly
            icon={<SquareDashedMousePointer size={13} aria-hidden />}
            aria-label={picking ? 'Stop picking' : 'Pick an element'}
            data-tooltip={picking ? 'Stop picking' : 'Pick an element for the message'}
            aria-pressed={picking}
            selected={picking}
            disabled={!tab.url || covered}
            onClick={() => pickElement(tab)}
            data-web-preview-pick=""
          />
        )}
        <Button variant="quiet" size="sm" iconOnly icon={<ExternalLink size={13} aria-hidden />} aria-label="Open in browser" data-tooltip="Open in browser" disabled={!tab?.url} onClick={() => tab?.url && window.open(tab.url, '_blank')} className={browser && tab ? NARROW_HIDDEN : ''} data-web-preview-open-external="" />
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
        {more && tab && <Menu x={more.x} y={more.y} entries={pageMenu(tab, bookmarked)} label="Page menu" onClose={() => setMore(null)} />}
        {trail}
        {/* Loading: a short segment that runs along the toolbar's bottom edge. */}
        {page.loading && <div aria-hidden className="page-progress absolute inset-x-0 -bottom-px h-0.5" data-web-preview-progress="" />}
      </div>
      {/* From the first tab: each has its ×, and + opens another. */}
      {browser && tabs && tabs.length > 0 && <TabStrip tabs={tabs} activeId={tab?.id ?? null} onNewTab={onNewTab} />}
      {picking && (
        <Notice inline className="shrink-0 px-3 py-1.5 text-meta text-muted" icon={<SquareDashedMousePointer size={12} aria-hidden />} data-web-preview-picking="">
          Click an element to add it to the message. <Kbd keys="Esc" tone="plain" /> stops.
        </Notice>
      )}
      {tab?.url && page.find.open && <FindBar key={tab.id} tabId={tab.id} focus={page.find.focus} matches={page.find.matches} active={page.find.active} />}
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
        {tab && !tab.url && <EmptyTab tabId={tab.id} owner={tab.owner} offers={offers} browser={browser} />}
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

/**
 * The session's tabs under the toolbar: pinned ones first, each with × on hover, then +. A double click renames one, a
 * right click shows its menu (`tabMenu`).
 * Drag a tab (or ⌥← ⌥→ on it) to move it, inside its group. Scrolls sideways, keeping the tab in front in view.
 */
function TabStrip({ tabs, activeId, onNewTab }: { tabs: readonly BrowserTab[]; activeId: string | null; onNewTab?(): void }) {
  const strip = useRef<HTMLDivElement>(null);
  const confirming = useWebPreview((s) => s.confirming);
  // A tab's menu (`tabMenu`), at the pointer, or under the tab from the keyboard (Shift+F10).
  const [menu, setMenu] = useState<{ x: number; y: number; tab: BrowserTab } | null>(null);
  const openMenu = (event: MouseEvent<HTMLElement>, tab: BrowserTab) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ x: event.clientX || rect.left, y: event.clientY || rect.bottom, tab });
  };
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const drag = useQueueDrag({
    ids: () => tabsRef.current.map((t) => t.id),
    move: (id, to) => useWebPreview.getState().move(id, to),
    mime: 'application/x-seshboard-browser-tab',
    axis: 'x',
    canDrop: (dragged, target) => sameGroup(tabsRef.current.find((t) => t.id === dragged), tabsRef.current.find((t) => t.id === target)),
  });
  const focusTab = (id: string) => requestAnimationFrame(() => strip.current?.querySelector<HTMLElement>(`[data-browser-tab="${CSS.escape(id)}"]`)?.focus());
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId]);
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const moving = (event.target as HTMLElement).closest<HTMLElement>('[data-browser-tab]')?.dataset.browserTab;
    if (moving && matches(event.nativeEvent, 'browser.move-tab')) {
      event.preventDefault();
      useWebPreview.getState().step(moving, event.key === 'ArrowLeft' ? -1 : 1);
      focusTab(moving);
      return;
    }
    const index = tabs.findIndex((t) => t.id === activeId);
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    if (!next) return;
    event.preventDefault();
    useWebPreview.getState().selectTab(next.id);
    focusTab(next.id);
  };
  const profileMenu = useNewTabMenu(tabs[0]?.owner ?? null);
  return (
    <div className="flex shrink-0 items-center gap-0.5 border-b border-border px-1.5 py-1">
      <div ref={strip} role="tablist" aria-label="Tabs" onKeyDown={onKey} className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]" data-web-preview-tabs="">
        {tabs.map((t) => {
          const selected = t.id === activeId;
          const asking = confirming === t.id;
          const mark = drag.markFor(t.id);
          return (
            <div key={t.id} className={`group relative flex h-7 max-w-44 min-w-24 shrink-0 items-center rounded-md ${selected ? 'bg-selected text-text' : 'text-muted hover:bg-border/45 hover:text-text'} ${drag.dragging === t.id ? 'opacity-50' : ''}`} {...drag.props(t.id)}>
              {mark && <span aria-hidden className={`pointer-events-none absolute inset-y-1 w-0.5 rounded-full bg-accent-ink ${mark === 'before' ? '-left-px' : '-right-px'}`} data-browser-tab-drop={mark} />}
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
                onContextMenu={(e) => openMenu(e, t)}
                className={`flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2 text-left text-ui ${hasSound(t) ? 'pr-11' : 'pr-6'}`}
                data-browser-tab={t.id}
                data-browser-pinned={t.pinned ? '' : undefined}
                data-browser-confirm-close={asking ? '' : undefined}
              >
                <TabIcon tab={t} />
                <TabTitle tab={t} confirming={asking} />
                <ProfileMark tab={t} />
                {t.pinned && !asking && <Pin size={10} aria-hidden className="shrink-0 text-faint" />}
              </button>
              <SoundButton tab={t} className="right-6" />
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
      {onNewTab && <Button variant="quiet" size="sm" iconOnly icon={<Plus size={13} aria-hidden />} aria-label="New tab" shortcut="browser.new-tab" onClick={onNewTab} onContextMenu={profileMenu.onContextMenu} className="shrink-0" data-browser-new-tab="" />}
      {onNewTab && profileMenu.button}
      {menu && <Menu x={menu.x} y={menu.y} entries={tabMenu(menu.tab)} label={`${tabName(menu.tab)} menu`} onClose={() => setMenu(null)} />}
    </div>
  );
}

/**
 * The address bar's suggestions under it: open tabs (Switch to tab), favourites and pages from the history. The rows
 * keep the focus in the address bar (a press doesn't take it), so typing goes on and ↑↓ move the highlight.
 */
function SuggestionList({ id, anchor, suggestions, highlighted, onPick, onHighlight, onClose }: {
  id: string;
  anchor: RefObject<HTMLInputElement | null>;
  suggestions: readonly AddressSuggestion[];
  highlighted: number;
  onPick(suggestion: AddressSuggestion): void;
  onHighlight(index: number): void;
  onClose(): void;
}) {
  const rect = anchor.current?.getBoundingClientRect();
  if (!rect) return null;
  return (
    <Popover id={id} x={rect.left} y={rect.bottom + 4} width={rect.width} anchor={anchor} closeOnEscape={false} onClose={onClose} role="listbox" aria-label="Suggestions" data-browser-suggestions="">
      {suggestions.map((s, i) => (
        <div
          key={s.url}
          id={`${id}-${i}`}
          role="option"
          aria-selected={i === highlighted}
          onMouseDown={(e) => e.preventDefault()}
          onMouseMove={() => i !== highlighted && onHighlight(i)}
          onClick={() => onPick(s)}
          className={`flex cursor-default items-center gap-2 px-3 py-1 text-ui ${i === highlighted ? 'bg-accent/15' : ''}`}
          data-browser-suggestion={s.kind}
        >
          <SuggestionIcon suggestion={s} />
          {s.title && <span className="max-w-[60%] min-w-0 shrink-0 truncate text-text">{s.title}</span>}
          <span className="min-w-0 flex-1 truncate font-mono text-meta text-muted">{shortUrl(s.url)}</span>
          {s.kind === 'tab' && <span className="shrink-0 pl-2 text-meta text-faint">Switch to tab</span>}
        </div>
      ))}
    </Popover>
  );
}

/** A suggestion's page icon when it has one, else what it is: an open tab, a favourite or a page from the history. */
function SuggestionIcon({ suggestion }: { suggestion: AddressSuggestion }) {
  if (suggestion.favicon) return <TabIcon tab={suggestion} />;
  const Icon = suggestion.kind === 'tab' ? AppWindow : suggestion.kind === 'favorite' ? Star : History;
  return <Icon size={12} aria-hidden className="shrink-0 text-faint" />;
}

/**
 * A speaker on a tab whose page plays sound, crossed out while it is muted. A click mutes or unmutes the tab. It sits
 * beside the tab's own button (a button can't hold another), so `className` places it.
 */
export function SoundButton({ tab, className }: { tab: BrowserTab; className: string }) {
  if (!tab.muted && !tab.audible) return null;
  return (
    <button
      type="button"
      aria-label={tab.muted ? `Unmute ${tabName(tab)}` : `Mute ${tabName(tab)}`}
      data-tooltip={tab.muted ? 'Unmute tab' : 'Mute tab'}
      onClick={() => toggleMute(tab)}
      className={`absolute flex size-5 items-center justify-center rounded hover:bg-border/60 hover:text-text ${tab.muted ? 'text-faint' : 'text-muted'} ${className}`}
      data-browser-tab-sound={tab.id}
      data-browser-tab-muted={tab.muted ? '' : undefined}
      data-browser-tab-audible={tab.audible && !tab.muted ? '' : undefined}
    >
      {tab.muted ? <VolumeX size={11} aria-hidden /> : <Volume2 size={11} aria-hidden />}
    </button>
  );
}

/** Whether a tab shows its speaker, so its button leaves room for it. */
export function hasSound(tab: Pick<BrowserTab, 'audible' | 'muted'>): boolean {
  return tab.audible || tab.muted;
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

/** Toolbar buttons that go to the ⋯ menu in a narrow toolbar, so the address bar keeps its room. */
export const NARROW_HIDDEN = '@max-[520px]/toolbar:hidden';

/**
 * The toolbar's ⋯: what is used less often for the page on screen, and Clear all browsing data. Pin, the bookmark,
 * Open in browser, a session's Open browser in new window and the Browser profile are here too, as a narrow toolbar
 * hides their buttons.
 */
function pageMenu(tab: BrowserTab, bookmarked: boolean): MenuEntry[] {
  const blank = !tab.url;
  return [
    { label: tab.pinned ? 'Unpin tab' : 'Pin tab', icon: <Pin size={13} aria-hidden />, disabled: blank, onSelect: () => (tab.pinned ? useWebPreview.getState().unpin(tab.id) : useWebPreview.getState().pin(tab.id)), data: { 'data-page-pin': true } },
    { label: bookmarked ? 'Edit bookmark…' : 'Bookmark this page…', icon: <Star size={13} aria-hidden />, hint: formatKeys(keysFor('browser.bookmark')), disabled: blank, onSelect: () => bookmarkPage(tab), data: { 'data-page-bookmark': true } },
    { label: 'Open in browser', icon: <ExternalLink size={13} aria-hidden />, disabled: blank, onSelect: () => tab.url && window.open(tab.url, '_blank'), data: { 'data-page-open-external': true } },
    ...(tab.owner !== BROWSER_OWNER && !browserPopoutSession ? [{ label: 'Open browser in new window', icon: <AppWindow size={13} aria-hidden />, onSelect: () => popOutBrowser(tab.owner), data: { 'data-page-pop-out': true } }] : []),
    // The toolbar's profile switch, which the narrowest toolbar hides.
    { label: 'Browser profile', icon: <UserRound size={13} aria-hidden />, submenu: profileSwitchMenu(tab, useBrowserProfiles.getState().profiles).filter((entry) => typeof entry !== 'object' || !('heading' in entry)), data: { 'data-page-profile': true } },
    'separator',
    { label: 'Rename tab…', icon: <Pencil size={13} aria-hidden />, onSelect: () => askRename(tab), data: { 'data-page-rename': true } },
    { label: 'Copy address', icon: <Copy size={13} aria-hidden />, disabled: blank, onSelect: () => copyAddress(tab) },
    'separator',
    { label: 'Find in page', icon: <Search size={13} aria-hidden />, disabled: blank, onSelect: () => findInPage(tab), data: { 'data-page-find': true } },
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

/** Find in page: the word to look for, the count of matches, and steps through them. Escape closes it. */
function FindBar({ tabId, focus, matches, active }: { tabId: string; focus: number; matches: number; active: number }) {
  const field = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, [focus]);
  const step = (direction: 'next' | 'previous') => text && previewPage(tabId)?.find(text, direction);
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      previewPage(tabId)?.closeFind();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      step(event.shiftKey ? 'previous' : 'next');
    }
  };
  const none = text !== '' && matches === 0;
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1" role="search" data-browser-find="" data-tab-id={tabId}>
      <input
        ref={field}
        type="text"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          previewPage(tabId)?.find(e.target.value);
        }}
        onKeyDown={onKey}
        placeholder="Find in page"
        spellCheck={false}
        aria-label="Find in page"
        aria-invalid={none ? true : undefined}
        className={`field h-7 min-w-0 flex-1 bg-card px-2 text-ui outline-none placeholder:text-faint ${none ? 'border-error' : ''}`}
        data-browser-find-input=""
      />
      <span className="min-w-14 text-right text-meta text-muted tabular-nums" aria-live="polite" data-browser-find-count="">
        {text === '' ? '' : none ? 'No matches' : `${active} of ${matches}`}
      </span>
      <Button variant="quiet" size="sm" iconOnly icon={<ChevronUp size={13} aria-hidden />} aria-label="Previous match" data-tooltip="Previous match" disabled={matches === 0} onClick={() => step('previous')} data-browser-find-previous="" />
      <Button variant="quiet" size="sm" iconOnly icon={<ChevronDown size={13} aria-hidden />} aria-label="Next match" data-tooltip="Next match" disabled={matches === 0} onClick={() => step('next')} data-browser-find-next="" />
      <Button variant="quiet" size="sm" iconOnly icon={<X size={13} aria-hidden />} aria-label="Close find" data-tooltip="Close find" onClick={() => previewPage(tabId)?.closeFind()} data-browser-find-close="" />
    </div>
  );
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
  return <img src={tab.favicon} alt="" aria-hidden width={size} height={size} className="shrink-0 rounded-sm" data-favicon onError={() => setBroken(tab.favicon)} />;
}

/** An empty tab: the servers running in the session, or where to type, then favourites, bookmarks and closed tabs (the browser on). */
function EmptyTab({ tabId, owner, offers, browser }: { tabId: string; owner: string; offers: readonly ServerOffer[]; browser: boolean }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center-safe gap-3 overflow-y-auto bg-sidebar px-6 py-8 text-center" data-web-preview-empty="">
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
        <div className="mt-3 flex w-full justify-center">
          <NewTabSections owner={owner} onOpen={(url) => useWebPreview.getState().navigate(tabId, url)} onFavorite={(url) => openFavoriteInTab(tabId, url)} />
        </div>
      )}
    </div>
  );
}

export { BackToConversation, PanelSize } from '../transcript/PanelSize.tsx';
