import { useSyncExternalStore } from 'react';

/**
 * Whether this window is in the foreground, as an attribute on `<html>` (`data-blurred` while it is not), so
 * styles.css can pause the animations that never end (spinners, pulses, the working panel) while nobody is using the
 * window: each frame of them costs the renderer and the GPU. Every window type loads this (main.tsx): the main
 * window, pop-outs, the menu bar panel and Quick start.
 *
 * Main says when the window moves to or from the foreground (`window.seshboard.onWindowActive`: shown, not minimised,
 * focused), as the page can't tell when the keys are in a browser page (`<webview>`) of the window, or when the app was
 * switched away from while one had them. The page's own `visibilityState` is the second input. Without that bridge
 * (the renderer in a plain browser) the window's focus and blur stand in.
 */
export const BLURRED_ATTRIBUTE = 'data-blurred';

/** What the watcher reads of the page and of main, so a test can stand in for them. */
export interface ActivityEnvironment {
  bridge?: { windowActive: boolean; onWindowActive(listener: (active: boolean) => void): () => void };
  win: { addEventListener(type: 'focus' | 'blur', listener: () => void): void; removeEventListener(type: 'focus' | 'blur', listener: () => void): void };
  doc: {
    hasFocus(): boolean;
    visibilityState: string;
    documentElement: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void };
    addEventListener(type: 'visibilitychange', listener: () => void): void;
    removeEventListener(type: 'visibilitychange', listener: () => void): void;
  };
}

let active = true;
const listeners = new Set<() => void>();

/** Whether the window is in the foreground right now (true before the watcher starts, and where there is none). */
export const isWindowActive = () => active;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/**
 * Re-renders when the window moves to or from the foreground. A panel that restarts its animations when the window comes
 * back (`WorkingPanel`) uses it, so all of them start in step again.
 */
export function useWindowActive(): boolean {
  return useSyncExternalStore(subscribe, isWindowActive, () => true);
}

/** Keeps `data-blurred` on `<html>` and `useWindowActive` in step with the window. Returns the function that stops watching. */
export function watchWindowActivity({ bridge, win, doc }: ActivityEnvironment): () => void {
  let fromMain = bridge ? bridge.windowActive : doc.hasFocus();
  const apply = () => {
    const next = fromMain && doc.visibilityState !== 'hidden';
    if (next) doc.documentElement.removeAttribute(BLURRED_ATTRIBUTE);
    else doc.documentElement.setAttribute(BLURRED_ATTRIBUTE, '');
    if (next === active) return;
    active = next;
    for (const listener of [...listeners]) listener();
  };
  const offBridge = bridge?.onWindowActive((next) => {
    fromMain = next;
    apply();
  });
  const onFocus = () => {
    fromMain = true;
    apply();
  };
  const onBlur = () => {
    fromMain = false;
    apply();
  };
  if (!bridge) {
    win.addEventListener('focus', onFocus);
    win.addEventListener('blur', onBlur);
  }
  doc.addEventListener('visibilitychange', apply);
  apply();
  return () => {
    offBridge?.();
    if (!bridge) {
      win.removeEventListener('focus', onFocus);
      win.removeEventListener('blur', onBlur);
    }
    doc.removeEventListener('visibilitychange', apply);
    active = true;
    doc.documentElement.removeAttribute(BLURRED_ATTRIBUTE);
  };
}
