import { Check } from 'lucide-react';
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { Button } from '../ui/Button.tsx';
import { placeToolbar, selectionLines, type Rect } from './selectionToolbar.ts';

/** A message in the conversation that can be remembered: `data-remember-from` (`user` or `claude`) and its key. */
export const REMEMBER_SOURCE = '[data-remember-from]';

/** The selected text, when it lies inside one rememberable message (and inside `root`, when given), and which message. */
export function selectionIn(root?: HTMLElement | null, source = REMEMBER_SOURCE): { text: string; element: HTMLElement; range: Range } | null {
  const selection = window.getSelection();
  const text = selection?.toString().trim();
  if (!selection || !text || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const element = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(source);
  if (!element || (root && !root.contains(element))) return null;
  return { text, element, range };
}

export const fromOf = (element: HTMLElement): 'user' | 'claude' => (element.dataset.rememberFrom === 'user' ? 'user' : 'claude');

/** How long after the mouse comes up the toolbar shows, so a quick click doesn't flash it. */
const SHOW_DELAY_MS = 150;
/** How long Copy says Copied. */
const COPIED_MS = 1200;

/** What the selection toolbar is placed by, and what its actions take. */
export interface Anchor {
  first: Rect;
  last: Rect;
  bounds: Rect;
  text: string;
  from: 'user' | 'claude';
}

export function anchorIn(root: HTMLElement | null, source = REMEMBER_SOURCE): Anchor | null {
  const selected = selectionIn(root, source);
  const lines = selected && selectionLines([...selected.range.getClientRects()]);
  if (!selected || !lines || !root) return null;
  return { ...lines, bounds: root.getBoundingClientRect(), text: selected.text, from: fromOf(selected.element) };
}


/**
 * The toolbar over a selection that shows a moment after the mouse comes up: `chip` is where to place it (null for none),
 * `toolbarRef` goes on the toolbar, `hide` takes it away. It goes while a new selection is dragged, when the window
 * resizes and when the selection is gone. The mouse can come up outside `container`. `source` is the selector of the
 * text the selection has to lie in (inside `container`).
 */
export function useSelectionChip(container: RefObject<HTMLElement | null>, source = REMEMBER_SOURCE) {
  const [chip, setChip] = useState<Anchor | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hide = () => {
    clearTimeout(showTimer.current);
    setChip(null);
  };

  useEffect(() => {
    const inToolbar = (event: Event) => !!toolbarRef.current?.contains(event.target as Node);
    const onChange = () => {
      if (!selectionIn(container.current, source)) hide();
    };
    const onDown = (event: globalThis.MouseEvent) => {
      if (!inToolbar(event)) hide();
    };
    const onUp = (event: globalThis.MouseEvent) => {
      if (event.button !== 0 || inToolbar(event)) return;
      clearTimeout(showTimer.current);
      showTimer.current = setTimeout(() => setChip(anchorIn(container.current, source)), SHOW_DELAY_MS);
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
  }, [container, source]);

  return { chip, toolbarRef, hide };
}

/** One button of the selection toolbar. */
export interface ToolbarAction {
  label: string;
  icon: ReactNode;
  /** The tooltip. */
  tooltip: string;
  /** Copies the selection itself and says Copied for a moment, instead of calling `onSelect`. */
  copy?: boolean;
  onSelect?(): void;
  /** A thin line before it. */
  separated?: boolean;
  /** data- hooks for the button. */
  data?: Record<`data-${string}`, string | boolean | undefined>;
}

/**
 * The toolbar over a selection, with the `actions` it is given (the conversation's Quote, Copy and Remember this…; reading mode's Reply with quote, Copy and Ask about this). A real toolbar: Tab from the
 * transcript reaches it, ← → move between its actions, Esc closes it and keeps the selection. Clicking an action
 * keeps the selection too (no mousedown default).
 */
export function SelectionToolbar({ anchor, toolbarRef, container, onClose, actions, hook }: { anchor: Anchor; toolbarRef: RefObject<HTMLDivElement | null>; container: RefObject<HTMLElement | null>; onClose(): void; actions: readonly ToolbarAction[]; hook: `data-${string}` }) {
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
      {...{ [hook]: true }}
      data-keeps-selection
      data-side={place?.side}
    >
      {actions.map((item, index) => (
        <Fragment key={item.label}>
          {item.separated && <span aria-hidden className="mx-1 h-4 w-px bg-edge" />}
          <Button
            size="sm"
            variant="quiet"
            icon={item.copy && copied ? <Check size={13} className="text-ok" aria-hidden /> : item.icon}
            {...action(index)}
            onClick={item.copy ? copy : item.onSelect}
            data-tooltip={item.tooltip}
            data-copied={item.copy ? copied || undefined : undefined}
            {...item.data}
          >
            {item.copy ? (
              /* Both labels take the same room, so the toolbar keeps its width when Copy turns into Copied. */
              <span className="grid">
                <span className={`col-start-1 row-start-1 ${copied ? 'text-ok' : 'text-text'}`}>{copied ? 'Copied' : item.label}</span>
                <span aria-hidden className="invisible col-start-1 row-start-1">
                  Copied
                </span>
              </span>
            ) : (
              <span className="text-text">{item.label}</span>
            )}
          </Button>
        </Fragment>
      ))}
      <span className="sr-only" role="status">
        {copied ? 'Copied' : ''}
      </span>
    </div>
  );
}
