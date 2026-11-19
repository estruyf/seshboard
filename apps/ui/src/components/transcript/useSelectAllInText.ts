import { useEffect } from 'react';
import { matches } from '../../lib/shortcuts.ts';
import { selectAllRoot } from './selectAllRoot.ts';
import { CLEAN_COPY, OWN_COPY } from './selectionClip.ts';

const OVERLAYS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-popover]';

const rootOf = (node: Node | null | undefined): Element | null => (node instanceof Element ? node : (node?.parentElement ?? null))?.closest(`[${CLEAN_COPY}]`) ?? null;

/**
 * ⌘A (Ctrl+A) in the conversation, reading mode or a previewed file selects only that text, as an editor does, so that a copy
 * takes it through `selectionClip` as clean HTML. Without it the window selects everything, the selection runs outside the area
 * and the browser copies it with the theme's colours. Which area: the one that holds the selection, else the one last clicked in,
 * else the one that holds focus (`selectAllRoot` also says when ⌘A is left to the browser: fields, the terminal, an open dialog or
 * menu that is not the area's).
 *
 * The conversation is virtualised, so only the rows drawn are in the page: Select all selects, and copies, those.
 */
export function useSelectAllInText(): void {
  useEffect(() => {
    let pointer: Element | null = null;
    const onPointerDown = (event: PointerEvent) => {
      pointer = rootOf(event.target as Node | null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !matches(event, 'text.select-all')) return;
      const target = event.target instanceof Element ? event.target : null;
      const active = document.activeElement;
      // Reading mode is over the conversation: only its own text counts while it is open.
      const top = document.querySelector('[data-read-mode]');
      const scoped = (root: Element | null) => (root && (!top || top.contains(root)) ? root : null);
      const selection = window.getSelection();
      const root = selectAllRoot<Element>({
        fieldFocused: !!(target?.closest(OWN_COPY) || active?.closest(OWN_COPY)),
        selection: scoped(rootOf(selection?.anchorNode)),
        pointer: scoped(pointer?.isConnected ? pointer : null),
        focus: scoped(rootOf(active)),
        fallback: top?.querySelector(`[${CLEAN_COPY}]`) ?? null,
        overlays: [...document.querySelectorAll(OVERLAYS)],
      });
      if (!root || !selection) return;
      event.preventDefault();
      const range = document.createRange();
      range.selectNodeContents(root);
      selection.removeAllRanges();
      selection.addRange(range);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
}
