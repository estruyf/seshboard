import { BookmarkPlus, Brain, Copy, Link, TextQuote } from 'lucide-react';
import { createContext, useCallback, useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { contextMenuPoint, type ContextMenuPoint } from '../../lib/contextMenu.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { fromOf, REMEMBER_SOURCE as SOURCE, SelectionToolbar, selectionIn, useSelectionChip, type ToolbarAction } from './SelectionToolbar.tsx';

/**
 * Opens the message menu for a link inside a message, with the link's own entries on top (a file link's Show in Finder,
 * Open in and Copy path). `pointer` is null when it was opened from the keyboard. False when the link is not inside a
 * message, so the link opens a menu of its own.
 */
export type OpenMessageMenu = (target: HTMLElement, pointer: { x: number; y: number } | null, entries: MenuEntry[]) => boolean;

/** The conversation's `OpenMessageMenu`, for the links in its messages. */
export const MessageMenuContext = createContext<OpenMessageMenu | null>(null);

/**
 * Remember this and Quote from the conversation: right-click a message (Copy link on a link, the file actions on a file link, Copy
 * for a selection, then Quote and Remember this…, for the selection or the whole message), or select text in `container` and use
 * the toolbar that shows above it (Quote, Copy, Remember this…). Without `onRemember` (another computer's session, whose
 * memories are there) it is Quote and Copy only.
 */
export function useRememberLayer({ container, textOf, onRemember, onQuote, onSavePrompt }: { container: RefObject<HTMLElement | null>; textOf(key: string): string | null; onRemember?(text: string, from: 'user' | 'claude'): void; onQuote(text: string): void; onSavePrompt?(text: string): void }) {
  const [menu, setMenu] = useState<{ at: ContextMenuPoint; text: string; selection: boolean; from: 'user' | 'claude'; link: string | null; entries: MenuEntry[] } | null>(null);
  const { chip, toolbarRef, hide } = useSelectionChip(container);

  /** Opens the menu for the message `target` is in; false when it is in none, or the message has no text. */
  const open = (target: Element, pointer: { x: number; y: number } | null, entries: MenuEntry[] = []): boolean => {
    const element = target.closest<HTMLElement>(SOURCE);
    if (!element) return false;
    const selected = selectionIn();
    const text = selected?.element === element ? selected.text : textOf(element.dataset.messageKey ?? '');
    if (!text) return false;
    hide();
    const href = target.closest('a[href]')?.getAttribute('href') ?? null;
    const link = href && /^(https?|mailto):/i.test(href) ? href : null;
    // From the keyboard there is no pointer: open it at the link (or the message).
    setMenu({ at: contextMenuPoint(pointer, target.getBoundingClientRect(), window.innerHeight), text, selection: selected?.element === element, from: fromOf(element), link, entries });
    return true;
  };

  // The same function every render, so the links that use it through `MessageMenuContext` don't render again while Claude writes.
  const openRef = useRef(open);
  useLayoutEffect(() => {
    openRef.current = open;
  });
  const openMenu = useCallback<OpenMessageMenu>((target, pointer, entries) => openRef.current(target, pointer, entries), []);

  const handlers = {
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      if (open(event.target as Element, { x: event.clientX, y: event.clientY })) event.preventDefault();
    },
    onScroll: hide,
  };

  const link = menu?.link;
  const overlay = (
    <>
      {chip && (
        <SelectionToolbar
          key={`${chip.first.left},${chip.first.top},${chip.text.length}`}
          anchor={chip}
          toolbarRef={toolbarRef}
          container={container}
          onClose={hide}
          hook="data-remember-selection"
          actions={[
            { label: 'Quote', icon: <TextQuote size={13} aria-hidden />, tooltip: 'Quote it in the message box', onSelect: () => (hide(), onQuote(chip.text)), data: { 'data-quote-selection': true } },
            { label: 'Copy', icon: <Copy size={13} aria-hidden />, tooltip: 'Copy', copy: true, data: { 'data-copy-selection': true } },
            ...(onRemember ? [{ label: 'Remember this…', icon: <Brain size={13} aria-hidden />, tooltip: 'Save as a memory', separated: true, onSelect: () => (hide(), onRemember(chip.text, chip.from)), data: { 'data-remember-button': true } }] : []),
          ]}
        />
      )}
      {menu && (
        <Menu
          x={menu.at.x}
          y={menu.at.y}
          above={menu.at.above}
          label="Message"
          onClose={() => setMenu(null)}
          entries={[
            ...(link ? [{ label: 'Copy link', icon: <Link size={13} aria-hidden />, onSelect: () => void navigator.clipboard.writeText(link), data: { 'data-copy-link-menu': true } }, 'separator' as const] : []),
            ...(menu.entries.length > 0 ? [...menu.entries, 'separator' as const] : []),
            ...(menu.selection ? [{ label: 'Copy', icon: <Copy size={13} aria-hidden />, onSelect: () => void navigator.clipboard.writeText(menu.text) }] : []),
            { label: menu.selection ? 'Quote' : 'Quote message', icon: <TextQuote size={13} aria-hidden />, onSelect: () => onQuote(menu.text), data: { 'data-quote-menu': true } },
            // A message you sent can become a saved prompt.
            ...(onSavePrompt && menu.from === 'user' ? [{ label: 'Save as prompt…', icon: <BookmarkPlus size={13} aria-hidden />, onSelect: () => onSavePrompt(menu.text), data: { 'data-save-as-prompt-menu': true } }] : []),
            ...(onRemember ? [{ label: menu.selection ? 'Remember this…' : 'Remember this message…', icon: <Brain size={13} aria-hidden />, onSelect: () => onRemember(menu.text, menu.from), data: { 'data-remember-menu': true } }] : []),
          ]}
        />
      )}
    </>
  );
  return { handlers, overlay, openMenu };
}
