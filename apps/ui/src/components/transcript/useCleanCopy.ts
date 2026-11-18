import { useEffect, type RefObject } from 'react';
import { CLEAN_COPY, selectionClip } from './selectionClip.ts';

/** Where a copy is the browser's own: text fields and the terminal handle their selection themselves. */
const OWN_COPY = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .xterm';

/**
 * Copies a selection in `container` (the conversation, reading mode, a previewed file) as clean HTML, plus its text.
 * Chromium would put the computed styles (the theme's colours, a background behind code) into the HTML, which reads badly
 * pasted into an email or a document. It leaves a selection that is not wholly inside `container` (Select all, which
 * covers more), or inside a field or the terminal, to the browser. The menus' and the toolbar's Copy do the same
 * through `copySelection`.
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
