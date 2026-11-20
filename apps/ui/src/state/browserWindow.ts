import { useEffect } from 'react';
import { handoffOf, parseHandoff, type BrowserHandoff } from '../components/webPreview/browserHandoff.ts';
import { addElementToMessage, quoteInMessage } from './browserActions.ts';
import { browserElsewhere, browserPopoutSession, useBrowserPopouts } from './popoutsStore.ts';
import { useWebPreview } from './webPreviewStore.ts';

/*
 * A session's browser in a window of its own (a browser window), so it can go on another display while the session stays
 * where it is. Every tab moves there through main, and back when the window goes (Move back, its close button, its last
 * tab). Meanwhile the session's window has none of its tabs: its Browser button, ⌘⇧B and links in the conversation bring
 * the browser window to the front instead.
 */

/** Moves a session's browser, with all its tabs, to a window of its own, or brings that window to the front. */
export function popOutBrowser(sessionId: string): void {
  const bridge = window.seshboard;
  if (!bridge) return;
  if (browserElsewhere(sessionId) || browserPopoutSession) return bridge.popOutBrowser(sessionId);
  const count = useWebPreview.getState().tabs.filter((t) => t.owner === sessionId).length;
  // Marked first: the pinned tabs' sync must see they moved, not that they were closed.
  useBrowserPopouts.getState().leaving(sessionId, count);
  const handoff = useWebPreview.getState().takeOut(sessionId);
  bridge.popOutBrowser(sessionId, { ...handoff });
}

/**
 * Follows which sessions have their browser in a window of its own, and takes their tabs back when that window goes. In
 * the main window and pop-outs: main gives the tabs to the window that shows the session then.
 */
export function useBrowserPopoutsSync(): void {
  useEffect(() => {
    const bridge = window.seshboard;
    if (!bridge || browserPopoutSession) return;
    const offs = [
      bridge.onBrowserPopoutsChanged((tabs) => useBrowserPopouts.getState().setTabs(tabs)),
      bridge.onBrowserReturned((sessionId, tabs, show) => {
        const handoff = parseHandoff(tabs, sessionId);
        if (handoff) useWebPreview.getState().adopt(sessionId, handoff, show);
      }),
      // A quote or an element from the browser window, for the session's message here.
      bridge.onBrowserMessage((sessionId, item) => {
        if (item.kind === 'quote') quoteInMessage({ owner: sessionId }, item.text, item.url);
        else addElementToMessage({ owner: sessionId }, item.element);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);
}

const sameHandoff = (a: BrowserHandoff, b: BrowserHandoff) =>
  a.active === b.active && a.tabs.length === b.tabs.length && a.tabs.every((t, i) => {
    const o = b.tabs[i]!;
    return t.id === o.id && t.url === o.url && t.title === o.title && t.name === o.name && t.favicon === o.favicon && t.pinned === o.pinned && t.position === o.position && t.phone === o.phone && t.zoom === o.zoom && t.muted === o.muted && t.profileId === o.profileId && t.favoriteId === o.favoriteId;
  });

/**
 * In a browser window: puts the tabs it was handed, keeps main up to date with them (so they go back with every change
 * kept), shows addresses sent from the session's window, and closes the window when its last tab closes.
 */
export function useBrowserWindowTabs(sessionId: string): void {
  useEffect(() => {
    const bridge = window.seshboard;
    if (!bridge) return;
    const handoff = parseHandoff(bridge.browserPopoutTabs, sessionId);
    if (handoff) useWebPreview.getState().adopt(sessionId, handoff, true);
    // With none handed over (a session's Browser button before it had a tab), an empty tab.
    useWebPreview.getState().open(sessionId);

    let sent: BrowserHandoff | null = null;
    let queued = false;
    const send = () => {
      queued = false;
      const now = handoffOf(useWebPreview.getState(), sessionId);
      if (sent && sameHandoff(sent, now)) return;
      sent = now;
      bridge.reportBrowserTabs({ ...now });
    };
    const off = useWebPreview.subscribe((state, previous) => {
      if (state.tabs === previous.tabs && state.active === previous.active) return;
      // The last tab closed: main hears there are none (so none come back), then the window goes.
      if (!state.tabs.some((t) => t.owner === sessionId)) {
        send();
        window.close();
        return;
      }
      if (queued) return;
      queued = true;
      queueMicrotask(send);
    });
    send();
    const offUrl = bridge.onBrowserOpenUrl((url) => useWebPreview.getState().open(sessionId, url));
    return () => {
      off();
      offUrl();
    };
  }, [sessionId]);
}
