import { useEffect, type RefObject } from 'react';
import { selectionClip } from './selectionClip.ts';

/** Where a copy is the browser's own: text fields and the terminal handle their selection themselves. */
const OWN_COPY = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .xterm';

/** Marks a container whose selections copy as clean HTML, for the context menu's Copy (`SelectionMenu`), which reads it from the element under the pointer. */
export const CLEAN_COPY = 'data-clean-copy';

/**
 * Copies a selection in `container` (the conversation, reading mode, a previewed file) as clean HTML, plus its text.
 * Chromium would put the computed styles (the theme's colours, a background behind code) into the HTML, which reads badly
 * pasted into an email or a document. It leaves a selection that is not wholly inside `container`, or inside a field or the
 * terminal, to the browser.
 */
export function useCleanCopy(container: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    el.setAttribute(CLEAN_COPY, '');
    const onCopy = (event: ClipboardEvent) => {
      if (event.defaultPrevented || !event.clipboardData) return;
      const target = event.target instanceof Element ? event.target : null;
      const active = document.activeElement;
      if (target?.closest(OWN_COPY) || active?.closest(OWN_COPY)) return;
      const clip = selectionClip(el);
      if (!clip) return;
      event.clipboardData.setData('text/html', clip.html);
      event.clipboardData.setData('text/plain', clip.text);
      event.preventDefault();
    };
    el.addEventListener('copy', onCopy);
    return () => {
      el.removeEventListener('copy', onCopy);
      el.removeAttribute(CLEAN_COPY);
    };
  }, [container]);
}
