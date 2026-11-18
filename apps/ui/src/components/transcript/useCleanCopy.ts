import { useEffect, type RefObject } from 'react';
import { cleanSelectionHtml } from './clipboardHtml.ts';

/** Where a copy is the browser's own: text fields and the terminal handle their selection themselves. */
const OWN_COPY = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .xterm';

/**
 * Copies a selection in the transcript as clean HTML, plus its text. Chromium would put the computed styles (the
 * theme's colours, a background behind code) into the HTML, which reads badly pasted into an email or a document.
 * It leaves a selection that is not wholly inside `container`, or inside a field or the terminal, to the browser.
 */
export function useCleanCopy(container: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const onCopy = (event: ClipboardEvent) => {
      if (event.defaultPrevented || !event.clipboardData) return;
      const target = event.target instanceof Element ? event.target : null;
      const active = document.activeElement;
      if (target?.closest(OWN_COPY) || active?.closest(OWN_COPY)) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return;
      const ancestor = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
      const within = ancestor?.closest('pre') ? 'pre' : ancestor?.closest('code') ? 'code' : undefined;
      const html = cleanSelectionHtml(range.cloneContents(), within);
      if (!html) return;
      event.clipboardData.setData('text/html', html);
      event.clipboardData.setData('text/plain', selection.toString());
      event.preventDefault();
    };
    el.addEventListener('copy', onCopy);
    return () => el.removeEventListener('copy', onCopy);
  }, [container]);
}
