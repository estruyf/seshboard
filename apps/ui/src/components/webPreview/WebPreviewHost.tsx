import { useEffect, useRef } from 'react';
import { shownElsewhere, usePopouts } from '../../state/popoutsStore.ts';
import { useRightPanel } from '../../state/rightPanelStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { toast } from '../../state/toastStore.ts';
import { browserOn, useWebPreview } from '../../state/webPreviewStore.ts';
import { BROWSER_OWNER, livePages } from './browserTabs.ts';
import { keepPages, placePages, previewPage, tabOfContents } from './webPreviewPages.ts';

/** How many frames a page follows its slot after something moved, to keep up with an animation (the sidebar folding). */
const FOLLOW_FRAMES = 20;

/**
 * The window's web preview pages (`webPreviewPages.ts`): one per browser tab shown lately, at most `LIVE_PAGES` (a tab
 * of a session in a pop-out has its page there). Loads what the store asks, reloads on the palette's request, keeps the
 * pages over their panels, hands the app's shortcuts typed in a page to the app, opens a page's new windows as tabs and
 * says when a download was refused. Mount once per window.
 */
export function WebPreviewHost() {
  const tabs = useWebPreview((s) => s.tabs);
  const active = useWebPreview((s) => s.active);
  const reloads = useWebPreview((s) => s.reloads);
  const popouts = usePopouts((s) => s.ids);

  useEffect(() => {
    const state = useWebPreview.getState();
    const wanted = livePages(state).filter((id) => {
      const owner = state.tabs.find((t) => t.id === id)?.owner;
      return owner === BROWSER_OWNER || (owner !== undefined && !shownElsewhere(owner));
    });
    keepPages(new Set(wanted));
    for (const id of wanted) {
      const tab = state.tabs.find((t) => t.id === id)!;
      const page = previewPage(id);
      if (!page || !tab.url || page.loaded === tab.seq) continue;
      page.loaded = tab.seq;
      page.load(tab.url);
    }
  }, [tabs, active, popouts]);

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
  useEffect(
    () =>
      window.seshboard?.onWebPreviewKeys(({ contentsId, keys }) => {
        const tabId = contentsId ? tabOfContents(contentsId) : undefined;
        const target = contentsId === 0 ? document.activeElement : tabId ? previewPage(tabId)?.element : undefined;
        target?.dispatchEvent(new KeyboardEvent('keydown', { ...keys, bubbles: true, cancelable: true }));
      }),
    [],
  );

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
    const offs = [useSessions.subscribe(follow), useRightPanel.subscribe(follow), useWebPreview.subscribe(follow)];
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
