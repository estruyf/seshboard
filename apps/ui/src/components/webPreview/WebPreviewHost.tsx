import { useEffect, useRef } from 'react';
import { shownElsewhere, usePopouts } from '../../state/popoutsStore.ts';
import { useRightPanel } from '../../state/rightPanelStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { toast } from '../../state/toastStore.ts';
import { browserOn, useWebPreview } from '../../state/webPreviewStore.ts';
import { noteFavicon } from '../../state/browserFavoritesStore.ts';
import { localPreviewUrl } from '@seshboard/protocol/client';
import { usePreferences } from '../../state/preferencesStore.ts';
import { BROWSER_OWNER, LIVE_PAGES, livePages } from './browserTabs.ts';
import { shrinkIcon } from './shrinkIcon.ts';
import { listenForBrowserAgent } from './browserAgentTarget.ts';
import { keepPages, placePages, previewPage, tabOfContents } from './webPreviewPages.ts';

/** A browser change that can move or cover a page: a panel shown, hidden or resized, another tab in front, a tab opened or closed, a new tab getting its first address, phone width. */
function movesPages(now: ReturnType<typeof useWebPreview.getState>, before: ReturnType<typeof useWebPreview.getState>): boolean {
  if (now.panels !== before.panels || now.full !== before.full || now.active !== before.active) return true;
  if (now.tabs === before.tabs) return false;
  if (now.tabs.length !== before.tabs.length) return true;
  return now.tabs.some((tab, i) => {
    const old = before.tabs[i]!;
    return tab.id !== old.id || !tab.url !== !old.url || tab.phone !== old.phone;
  });
}

/** How many frames a page follows its slot after something moved, to keep up with an animation (the sidebar folding). */
const FOLLOW_FRAMES = 20;

/**
 * The window's web preview pages (`webPreviewPages.ts`): one per browser tab shown lately, at most `LIVE_PAGES` (a tab
 * of a session in a pop-out has its page there). Loads what the store asks, reloads on the palette's request, keeps the
 * pages over their panels, hands the app's shortcuts typed in a page to the app, opens a page's new windows as tabs and
 * says when a download was refused. Mount once per window.
 */
export function WebPreviewHost() {
  // What decides the live pages and what they load: each tab's id, when it was shown, and the address it was asked to
  // load (`seq`). A page's new title, icon or address as it browses changes none of it.
  const pagesKey = useWebPreview((s) => s.tabs.map((t) => `${t.id}:${t.lastShownAt}:${t.seq}:${t.url ? 1 : 0}`).join('|'));
  const panels = useWebPreview((s) => s.panels);
  const active = useWebPreview((s) => s.active);
  const reloads = useWebPreview((s) => s.reloads);
  const popouts = usePopouts((s) => s.ids);
  const browser = usePreferences((s) => s.prefs.browserEnabled);
  // What is on screen: the Browser view, or the sessions in the panes.
  const view = useSessions((s) => s.view);
  const paneIds = useSessions((s) => s.paneIds);
  const selectedId = useSessions((s) => s.selectedId);

  useEffect(() => {
    const state = useWebPreview.getState();
    // Each panel on screen keeps its tab in front live, however many were picked since.
    const owners = [...(view === 'browser' ? [BROWSER_OWNER] : []), ...new Set([...paneIds, ...(selectedId ? [selectedId] : [])])].filter((owner) => owner === BROWSER_OWNER || state.panels.has(owner));
    const keep = owners.flatMap((owner) => state.active.get(owner) ?? []);
    const wanted = livePages(state, LIVE_PAGES, {
      keep,
      // A pop-out shows its session's pages; with the browser off, only this computer's pages run (the dev server preview).
      allowed: (tab) => (tab.owner === BROWSER_OWNER || !shownElsewhere(tab.owner)) && (browser || localPreviewUrl(tab.url!) !== null),
    });
    keepPages(new Set(wanted));
    for (const id of wanted) {
      const tab = state.tabs.find((t) => t.id === id)!;
      const page = previewPage(id);
      if (!page || !tab.url || page.loaded === tab.seq) continue;
      page.loaded = tab.seq;
      page.load(tab.url);
    }
  }, [pagesKey, panels, active, popouts, browser, view, paneIds, selectedId]);

  // Only a request made while this window is open: counts from before it are old news.
  const seenReloads = useRef(reloads);
  useEffect(() => {
    for (const [id, count] of reloads) {
      if (seenReloads.current.get(id) === count) continue;
      previewPage(id)?.reload(useWebPreview.getState().tabs.find((t) => t.id === id)?.url ?? null);
    }
    seenReloads.current = reloads;
  }, [reloads]);

  // The app's shortcuts typed in a page: main takes them from the page and hands them here, to run as if typed in the
  // app. Id 0 is ⌘W from the browser's address bar, which main kept from closing the window.
  useEffect(() => {
    // What a handed key opens can take the focus (the palette, a dialog, the address bar). The window's document moves
    // it, but Chromium leaves the keyboard with the page: main then sends what is typed there to the window, until the
    // page has the focus again (a click in it).
    let from: number | null = null;
    let until = 0;
    const onFocus = (event: FocusEvent) => {
      const to = event.target;
      if (!(to instanceof HTMLElement)) return;
      if (to.tagName === 'WEBVIEW') {
        from = null;
        window.seshboard?.keysToWindow(null);
        return;
      }
      if (from === null || Date.now() > until) return;
      window.seshboard?.keysToWindow(from);
      from = null;
    };
    document.addEventListener('focusin', onFocus, true);
    const off = window.seshboard?.onWebPreviewKeys(({ contentsId, keys }) => {
      const tabId = contentsId ? tabOfContents(contentsId) : undefined;
      const page = tabId ? previewPage(tabId)?.element : undefined;
      const target = contentsId === 0 ? document.activeElement : page;
      if (page && contentsId) {
        from = contentsId;
        until = Date.now() + 1_000;
      }
      target?.dispatchEvent(new KeyboardEvent('keydown', { ...keys, bubbles: true, cancelable: true }));
    });
    return () => {
      document.removeEventListener('focusin', onFocus, true);
      off?.();
    };
  }, []);

  // Claude's browser tools ask this window for a session's page (main/browserAgent.ts).
  useEffect(() => listenForBrowserAgent(), []);

  // A page's new window becomes a tab of the same owner; a refused download says so, with the browser instead.
  useEffect(
    () =>
      window.seshboard?.onWebPreviewEvent((event) => {
        if (!browserOn()) return;
        const tabId = tabOfContents(event.contentsId);
        const tab = tabId ? useWebPreview.getState().tabs.find((t) => t.id === tabId) : undefined;
        if (event.kind === 'popup') {
          if (tab) useWebPreview.getState().openTab(tab.owner, event.url);
          return;
        }
        if (event.kind === 'audio') {
          if (tab) useWebPreview.getState().heard(tab.id, event.audible);
          return;
        }
        if (event.kind === 'favicon') {
          if (!tab || !event.url.startsWith('data:image/')) return;
          void shrinkIcon(event.url).then((icon) => {
            // The tab may have gone to another address meanwhile (the address bar): this icon is the old page's.
            const now = useWebPreview.getState().tabs.find((t) => t.id === tab.id);
            if (!icon || !now || now.seq !== tab.seq) return;
            useWebPreview.getState().iconed(now.id, icon);
            noteFavicon(now.url, icon);
          });
          return;
        }
        toast("Downloads aren't supported here yet. Open in browser.", {
          icon: 'browser',
          actions: event.url ? [{ label: 'Open in browser', onSelect: () => void window.open(event.url, '_blank'), data: { 'data-web-preview-download-open': true } }] : undefined,
          data: { 'data-web-preview-download-refused': true },
        });
      }),
    [],
  );

  // Anything that can move a panel: the pages follow it for a few frames.
  useEffect(() => {
    let frames = 0;
    let raf = 0;
    const tick = () => {
      raf = 0;
      placePages();
      if (--frames > 0) raf = requestAnimationFrame(tick);
    };
    const follow = () => {
      frames = FOLLOW_FRAMES;
      raf ||= requestAnimationFrame(tick);
    };
    window.addEventListener('resize', follow);
    document.addEventListener('transitionrun', follow, true);
    document.addEventListener('transitionend', follow, true);
    document.addEventListener('pointerup', follow, true);
    // Only changes that can move a panel: a page's new title or address, or a session's streamed reply, can't.
    const offs = [
      useSessions.subscribe((now, before) => (now.view !== before.view || now.selectedId !== before.selectedId || now.layout !== before.layout) && follow()),
      useRightPanel.subscribe(follow),
      useWebPreview.subscribe((now, before) => movesPages(now, before) && follow()),
    ];
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', follow);
      document.removeEventListener('transitionrun', follow, true);
      document.removeEventListener('transitionend', follow, true);
      document.removeEventListener('pointerup', follow, true);
      offs.forEach((off) => off());
    };
  }, []);

  return null;
}
