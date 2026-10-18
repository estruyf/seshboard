import { useEffect } from 'react';
import { popoutSession, provideSessionView } from './popoutsStore.ts';
import { readSessionView, receiveSessionView, subscribeSessionViews } from './sessionView.ts';
import { sameView, type SessionViewState } from './sessionViewState.ts';

/**
 * A session's panels travel with it between windows, through main and in memory only (never saved: a pop-out writes
 * none of the main window's state). The main window gives a session's panels to the pop-out it opens
 * (`provideSessionView`, read by `popOut()`) and takes them back when the pop-out goes, however it goes.
 */
export function useSessionViewHandoff(): void {
  useEffect(() => {
    const bridge = window.switchboard;
    if (!bridge) return;
    provideSessionView((sessionId) => ({ ...readSessionView(sessionId) }));
    const off = bridge.onViewReturned((sessionId, view) => receiveSessionView(sessionId, view));
    return () => {
      provideSessionView(null);
      off();
    };
  }, []);
}

/**
 * In a pop-out: keeps main up to date with how its session's panels stand, so main has them when the window goes
 * (Move back to main window, ×, the close button or archiving). Changes of one action go as one message, sent at once:
 * a closing window may not get another turn. Sizes aren't part of a view, so dragging an edge sends nothing.
 */
export function usePopoutViewReport(sessionId: string): void {
  useEffect(() => {
    const bridge = window.switchboard;
    if (!bridge || popoutSession !== sessionId) return;
    let sent: SessionViewState | null = null;
    let queued = false;
    const send = () => {
      queued = false;
      const view = readSessionView(sessionId);
      if (sent && sameView(sent, view)) return;
      sent = view;
      bridge.reportView({ ...view });
    };
    const off = subscribeSessionViews(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(send);
    });
    // Once at the start: what the pop-out opened with, and what it restored of its own.
    send();
    return off;
  }, [sessionId]);
}
