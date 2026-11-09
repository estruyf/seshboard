import { useEffect, useRef } from 'react';
import { shownElsewhere, usePopouts } from '../../state/popoutsStore.ts';
import { useRightPanel } from '../../state/rightPanelStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { useWebPreview } from '../../state/webPreviewStore.ts';
import { keepPages, placePages, previewPage } from './webPreviewPages.ts';

/** How many frames a page follows its slot after something moved, to keep up with an animation (the sidebar folding). */
const FOLLOW_FRAMES = 20;

/**
 * The window's web preview pages (`webPreviewPages.ts`): one per session with its Web tab open and shown in this window
 * (a session in a pop-out has its page there). Loads what the store asks, reloads on the palette's request, keeps the
 * pages over their panels, and hands the app's shortcuts typed in a page to the app. Mount once per window.
 */
export function WebPreviewHost() {
  const sessions = useWebPreview((s) => s.sessions);
  const reloads = useWebPreview((s) => s.reloads);
  const popouts = usePopouts((s) => s.ids);

  useEffect(() => {
    keepPages(new Set([...sessions.keys()].filter((id) => !shownElsewhere(id))));
    for (const [id, web] of sessions) {
      const page = previewPage(id);
      if (!page || !web.url || page.loaded === web.seq) continue;
      page.loaded = web.seq;
      page.load(web.url);
    }
  }, [sessions, popouts]);

  // Only a request made while this window is open: counts from before it are old news.
  const seenReloads = useRef(reloads);
  useEffect(() => {
    for (const [id, count] of reloads) {
      if (seenReloads.current.get(id) === count) continue;
      previewPage(id)?.reload(useWebPreview.getState().sessions.get(id)?.url ?? null);
    }
    seenReloads.current = reloads;
  }, [reloads]);

  // The app's shortcuts typed in a page: main takes them from the page and hands them here, to run as if typed in the app.
  useEffect(
    () =>
      window.seshboard?.onWebPreviewKeys(({ contentsId, keys }) => {
        const id = [...useWebPreview.getState().sessions.keys()].find((sessionId) => previewPage(sessionId)?.contentsId() === contentsId);
        const page = id ? previewPage(id) : undefined;
        page?.element.dispatchEvent(new KeyboardEvent('keydown', { ...keys, bubbles: true, cancelable: true }));
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
