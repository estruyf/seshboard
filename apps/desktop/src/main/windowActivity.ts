/**
 * Whether a window is in the foreground, from main, which knows it for sure: a page can't tell when the keys are in a
 * `<webview>` or when the app was switched away from while one had them. The renderer pauses its endless animations while
 * its window is not (`apps/ui/src/lib/windowActivity.ts`). Pure, for testing: `trackWindowActivity` gets the window
 * through a small interface.
 */

/** The window events that can change whether it is in front. */
export const ACTIVITY_EVENTS = ['focus', 'blur', 'show', 'hide', 'minimize', 'restore'] as const;

export interface ActivityWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  isMinimized(): boolean;
  isFocused(): boolean;
  on(event: (typeof ACTIVITY_EVENTS)[number], listener: () => void): unknown;
}

/** Shown, not minimised and focused: the window somebody is using. */
export function windowIsActive(win: Pick<ActivityWindow, 'isDestroyed' | 'isVisible' | 'isMinimized' | 'isFocused'>): boolean {
  return !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused();
}

/** Tells `send` when the window moves to or from the foreground (once per change, not per event). */
export function trackWindowActivity(win: ActivityWindow, send: (active: boolean) => void): void {
  let last = windowIsActive(win);
  const check = () => {
    const now = windowIsActive(win);
    if (now === last) return;
    last = now;
    send(now);
  };
  for (const event of ACTIVITY_EVENTS) win.on(event, check);
}
