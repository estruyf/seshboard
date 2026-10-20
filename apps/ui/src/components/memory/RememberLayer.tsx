import { BookmarkPlus, Brain, Check, Copy, Link, TextQuote } from 'lucide-react';
import { createContext, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';
import { contextMenuPoint, type ContextMenuPoint } from '../../lib/contextMenu.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { Button } from '../ui/Button.tsx';
import { placeToolbar, selectionLines, type Rect } from './selectionToolbar.ts';

/** A message in the conversation that can be remembered: `data-remember-from` (`user` or `claude`) and its key. */
const SOURCE = '[data-remember-from]';

/** The selected text, when it lies inside one rememberable message (and inside `root`, when given), and which message. */
function selectionIn(root?: HTMLElement | null): { text: string; element: HTMLElement; range: Range } | null {
  const selection = window.getSelection();
  const text = selection?.toString().trim();
  if (!selection || !text || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const element = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(SOURCE);
  if (!element || (root && !root.contains(element))) return null;
  return { text, element, range };
}

const fromOf = (element: HTMLElement): 'user' | 'claude' => (element.dataset.rememberFrom === 'user' ? 'user' : 'claude');

/** How long after the mouse comes up the toolbar shows, so a quick click doesn't flash it. */
const SHOW_DELAY_MS = 150;
/** How long Copy says Copied. */
const COPIED_MS = 1200;

/** What the selection toolbar is placed by, and what its actions take. */
interface Anchor {
  first: Rect;
  last: Rect;
  bounds: Rect;
  text: string;
  from: 'user' | 'claude';
}

function anchorIn(root: HTMLElement | null): Anchor | null {
  const selected = selectionIn(root);
  const lines = selected && selectionLines([...selected.range.getClientRects()]);
  if (!selected || !lines || !root) return null;
  return { ...lines, bounds: root.getBoundingClientRect(), text: selected.text, from: fromOf(selected.element) };
}

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
 * the toolbar that shows above it (Quote, Copy, Remember this…).
 */
export function useRememberLayer({ container, textOf, onRemember, onQuote, onSavePrompt }: { container: RefObject<HTMLElement | null>; textOf(key: string): string | null; onRemember(text: string, from: 'user' | 'claude'): void; onQuote(text: string): void; onSavePrompt?(text: string): void }) {
  const [menu, setMenu] = useState<{ at: ContextMenuPoint; text: string; selection: boolean; from: 'user' | 'claude'; link: string | null; entries: MenuEntry[] } | null>(null);
  const [chip, setChip] = useState<Anchor | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hide = () => {
    clearTimeout(showTimer.current);
    setChip(null);
  };

  // The toolbar shows a moment after a selection is made with the mouse, and goes while a new one is dragged,
  // when the window resizes and when the selection is gone. The mouse can come up outside the transcript.
  useEffect(() => {
    const inToolbar = (event: Event) => !!toolbarRef.current?.contains(event.target as Node);
    const onChange = () => {
      if (!selectionIn(container.current)) hide();
    };
    const onDown = (event: globalThis.MouseEvent) => {
      if (!inToolbar(event)) hide();
    };
    const onUp = (event: globalThis.MouseEvent) => {
      if (event.button !== 0 || inToolbar(event)) return;
      clearTimeout(showTimer.current);
      showTimer.current = setTimeout(() => setChip(anchorIn(container.current)), SHOW_DELAY_MS);
    };
    document.addEventListener('selectionchange', onChange);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('resize', hide);
    return () => {
      clearTimeout(showTimer.current);
      document.removeEventListener('selectionchange', onChange);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('resize', hide);
    };
  }, [container]);

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
          onQuote={() => (hide(), onQuote(chip.text))}
          onRemember={() => (hide(), onRemember(chip.text, chip.from))}
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
            { label: menu.selection ? 'Remember this…' : 'Remember this message…', icon: <Brain size={13} aria-hidden />, onSelect: () => onRemember(menu.text, menu.from), data: { 'data-remember-menu': true } },
          ]}
        />
      )}
    </>
  );
  return { handlers, overlay, openMenu };
}

/**
 * The toolbar over a selection in the conversation: Quote, Copy and Remember this…. A real toolbar: Tab from the
 * transcript reaches it, ← → move between its actions, Esc closes it and keeps the selection. Clicking an action
 * keeps the selection too (no mousedown default).
 */
function SelectionToolbar({ anchor, toolbarRef, container, onClose, onQuote, onRemember }: { anchor: Anchor; toolbarRef: RefObject<HTMLDivElement | null>; container: RefObject<HTMLElement | null>; onClose(): void; onQuote(): void; onRemember(): void }) {
  const [place, setPlace] = useState<{ left: number; top: number; side: 'above' | 'below' } | null>(null);
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  // Placed once it can be measured; until then it is laid out but not shown.
  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    setPlace(placeToolbar({ ...anchor, width: el.offsetWidth, height: el.offsetHeight }));
  }, [anchor, toolbarRef]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  // From the transcript (or nothing focused, after selecting with the mouse), Tab goes into the toolbar and Esc closes it.
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const focused = document.activeElement;
      if (toolbarRef.current?.contains(focused)) return;
      if (focused && focused !== document.body && !container.current?.contains(focused)) return;
      if (event.key === 'Tab' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        buttons.current[0]?.focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        latest.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [container, toolbarRef]);

  const move = (index: number) => {
    const count = buttons.current.length;
    const next = (index + count) % count;
    setActive(next);
    buttons.current[next]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') move(active + 1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') move(active - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(buttons.current.length - 1);
    else if (event.key === 'Escape') {
      // The selection stays; Esc doesn't also reach the message box or a dialog.
      event.stopPropagation();
      onClose();
    } else return;
    event.preventDefault();
  };

  const copy = () => void navigator.clipboard.writeText(anchor.text).then(() => setCopied(true), () => {});
  const action = (index: number) => ({
    ref: (el: HTMLButtonElement | null) => {
      buttons.current[index] = el;
    },
    tabIndex: index === active ? 0 : -1,
    onFocus: () => setActive(index),
    onMouseDown: (event: MouseEvent) => event.preventDefault(),
  });

  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label="Selected text"
      onKeyDown={onKeyDown}
      className="fixed z-50 flex items-center gap-px rounded-[9px] border border-edge bg-popover p-[3px] shadow-overlay"
      style={place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: 'hidden' }}
      data-remember-selection
      data-side={place?.side}
    >
      <Button size="sm" variant="quiet" icon={<TextQuote size={13} aria-hidden />} {...action(0)} onClick={onQuote} data-tooltip="Quote it in the message box" data-quote-selection>
        <span className="text-text">Quote</span>
      </Button>
      <Button size="sm" variant="quiet" icon={copied ? <Check size={13} className="text-ok" aria-hidden /> : <Copy size={13} aria-hidden />} {...action(1)} onClick={copy} data-tooltip="Copy" data-copy-selection data-copied={copied || undefined}>
        {/* Both labels take the same room, so the toolbar keeps its width when Copy turns into Copied. */}
        <span className="grid">
          <span className={`col-start-1 row-start-1 ${copied ? 'text-ok' : 'text-text'}`}>{copied ? 'Copied' : 'Copy'}</span>
          <span aria-hidden className="invisible col-start-1 row-start-1">
            Copied
          </span>
        </span>
      </Button>
      <span aria-hidden className="mx-1 h-4 w-px bg-edge" />
      <Button size="sm" variant="quiet" icon={<Brain size={13} aria-hidden />} {...action(2)} onClick={onRemember} data-tooltip="Save as a memory" data-remember-button>
        <span className="text-text">Remember this…</span>
      </Button>
      <span className="sr-only" role="status">
        {copied ? 'Copied' : ''}
      </span>
    </div>
  );
}
