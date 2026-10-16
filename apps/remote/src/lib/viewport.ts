/**
 * Keeping the message box above the keyboard on an iPhone. Safari doesn't shrink the page for the keyboard (Android
 * Chrome does, with `interactive-widget=resizes-content`): it scrolls the page under it instead. While the box has
 * focus, the session view takes the visible part's height and follows its top. Pure, with tests; `useVisualViewport`
 * reads the numbers.
 */

/** A visible part this much shorter than the page is a keyboard; less is the toolbar coming and going. */
export const KEYBOARD_MIN = 120;

export interface ViewportFrame {
  /** px, the visible part's height. */
  height: number;
  /** px from the top of the page, where the visible part starts. */
  top: number;
}

/**
 * Where the session view goes while you type: null (its normal place) unless the message box has focus and a
 * keyboard covers part of the page; then the visible part.
 */
export function keyboardFrame({ focused, layoutHeight, viewportHeight, offsetTop }: { focused: boolean; layoutHeight: number; viewportHeight: number; offsetTop: number }): ViewportFrame | null {
  if (!focused || viewportHeight <= 0) return null;
  if (layoutHeight - viewportHeight < KEYBOARD_MIN) return null;
  return { height: Math.round(viewportHeight), top: Math.max(0, Math.round(offsetTop)) };
}
