/** What a scroll event's target needs to answer "do you hold this node?" (a DOM `Node`; the window has no `contains`). */
export interface ScrollTargetLike {
  contains?(node: unknown): boolean;
}

/**
 * Whether a scroll somewhere in the page leaves a fixed-position menu behind its button. Only a scroller that
 * holds the button moves it (the window, a dialog's body); one that doesn't (the transcript, which scrolls
 * itself to the bottom whenever Claude writes, or the menu's own list) can't, so the menu stays open.
 * `scroll` doesn't bubble, so the listener sees every scroller in the page through capture.
 */
export function scrollMovesAnchor(target: ScrollTargetLike | null, anchor: unknown): boolean {
  // The window (no `contains`) is the page itself, and a button we can't find can't be told to be safe.
  if (!target || !anchor || typeof target.contains !== 'function') return true;
  return target.contains(anchor);
}
