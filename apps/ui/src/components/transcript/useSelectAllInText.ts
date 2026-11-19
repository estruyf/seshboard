import { useEffect } from 'react';
import { matches } from '../../lib/shortcuts.ts';
import { selectAllRoot } from './selectAllRoot.ts';
import { CLEAN_COPY, OWN_COPY } from './selectionClip.ts';

const OVERLAYS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-popover]';

/** Select all from the menu bar (Edit › Select All): main sends it as this event and falls back to the window's own Select all when nothing here takes it. */
export const SELECT_ALL_EVENT = 'seshboard:select-all';

const rootOf = (node: Node | null | undefined): Element | null => (node instanceof Element ? node : (node?.parentElement ?? null))?.closest(`[${CLEAN_COPY}]`) ?? null;

/**
 * ⌘A (Ctrl+A) in the conversation, reading mode or a previewed file selects only that text, as an editor does, so that a copy
 * takes it through `selectionClip` as clean HTML. Without it the window selects everything, the selection runs outside the area
 * and the browser copies it with the theme's colours. Which area: the one that holds the selection, else the one last clicked in,
 * else the one that holds focus, and none when focus is on an element elsewhere (`selectAllRoot` also says when ⌘A is left to the
 * browser: fields, the terminal, an open dialog or menu that is not the area's). Edit › Select All in the menu bar asks the same way.
 *
 * The conversation is virtualised, so only the rows drawn are in the page: Select all selects, and copies, those.
 */
export function useSelectAllInText(): void {
  useEffect(() => {
    let pointer: Element | null = null;
    /** Selects the text of the area this key or menu item means; false leaves it to the browser. `target`: where the key event was aimed. */
    const selectAll = (target: Element | null): boolean => {
      const active = document.activeElement;
      // Reading mode is over the conversation: only its own text counts while it is open, and focus behind it is no focus. An area that is hidden (display: none behind an expanded Changes panel or a maximised terminal) or inert is never chosen.
      const top = document.querySelector('[data-read-mode]');
      const scoped = (root: Element | null) => (root && (!top || top.contains(root)) && !root.closest('[inert]') && root.checkVisibility() ? root : null);
      const focusedElement = active && active !== document.body && active !== document.documentElement && (!top || top.contains(active)) ? active : null;
      const selection = window.getSelection();
      const root = selectAllRoot<Element>({
        fieldFocused: !!(target?.closest(OWN_COPY) || active?.closest(OWN_COPY)),
        focused: focusedElement !== null,
        selection: scoped(rootOf(selection?.anchorNode)),
        pointer: scoped(pointer?.isConnected ? pointer : null),
        focus: scoped(rootOf(focusedElement)),
        fallback: scoped(top?.querySelector(`[${CLEAN_COPY}]`) ?? null),
        overlays: [...document.querySelectorAll(OVERLAYS)],
      });
      if (!root || !selection) return false;
      const range = document.createRange();
      range.selectNodeContents(root);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    };
    const onPointerDown = (event: PointerEvent) => {
      pointer = rootOf(event.target as Node | null);
    };
    // Focus moving somewhere else (a keyboard move to Settings, the Files panel or another pane) makes the last click old.
    const onFocusIn = (event: FocusEvent) => {
      if (pointer && !pointer.contains(event.target as Node | null)) pointer = null;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !matches(event, 'text.select-all')) return;
      if (selectAll(event.target instanceof Element ? event.target : null)) event.preventDefault();
    };
    const onMenu = (event: Event) => {
      const detail = (event as CustomEvent<{ handled: boolean }>).detail;
      if (detail && selectAll(null)) detail.handled = true;
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('focusin', onFocusIn);
    window.addEventListener('keydown', onKey);
    window.addEventListener(SELECT_ALL_EVENT, onMenu);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(SELECT_ALL_EVENT, onMenu);
    };
  }, []);
}
