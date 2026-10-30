import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { TextQuote } from 'lucide-react';
import { quotedText, quotePillPlace, type Box } from '../lib/quote.ts';

/** A message whose text can be quoted: Claude's replies and your messages, in the conversation and in Read. */
export const QUOTE_SOURCE = '[data-quote-source]';

/** How long the selection rests before the pill shows: dragging a handle changes it on every move. */
const SETTLE_MS = 200;

/**
 * Quote over selected text, as on the computer: a pill under the selection (the phone's own menu, which no page can
 * add to, shows above it) that puts what you selected in the message box as a quote. Only for a selection inside one
 * message in `root`. The text is kept when the pill shows, so a tap that clears the selection still quotes it.
 */
export function SelectionQuote({ root, onQuote }: { root: RefObject<HTMLElement | null>; onQuote: (text: string) => void }) {
  const [at, setAt] = useState<{ text: string; first: Box; last: Box } | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const pill = useRef<HTMLButtonElement>(null);
  /** A finger or the mouse is on the pill: the selection it clears doesn't hide it before the tap lands. */
  const pressing = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      const selection = window.getSelection();
      const text = selection && !selection.isCollapsed ? quotedText(selection.toString()) : null;
      const range = text && selection!.rangeCount > 0 ? selection!.getRangeAt(0) : null;
      const node = range?.commonAncestorContainer ?? null;
      const element = node instanceof Element ? node : (node?.parentElement ?? null);
      const rects = range ? [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0) : [];
      if (!text || !element?.closest(QUOTE_SOURCE) || !root.current?.contains(element) || rects.length === 0) {
        if (!pressing.current) setAt(null);
        return;
      }
      setAt({ text, first: rects[0]!, last: rects.at(-1)! });
    };
    const settle = () => {
      clearTimeout(timer);
      timer = setTimeout(read, SETTLE_MS);
    };
    // Scrolling moves the selection: the pill follows once it rests.
    const scroller = root.current;
    document.addEventListener('selectionchange', settle);
    scroller?.addEventListener('scroll', settle, { passive: true });
    window.addEventListener('resize', settle);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('selectionchange', settle);
      scroller?.removeEventListener('scroll', settle);
      window.removeEventListener('resize', settle);
    };
  }, [root]);

  // Placed once it can be measured; until then it is laid out but not shown.
  useLayoutEffect(() => {
    const el = pill.current;
    setPlace(at && el ? quotePillPlace(at.first, at.last, { width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }) : null);
  }, [at]);

  if (!at) return null;
  return createPortal(
    <button
      ref={pill}
      type="button"
      // Pressing a button would move the focus and drop the selection first.
      onPointerDown={(event) => {
        pressing.current = true;
        event.preventDefault();
      }}
      onPointerUp={() => setTimeout(() => (pressing.current = false), 0)}
      onPointerCancel={() => (pressing.current = false)}
      onClick={() => {
        pressing.current = false;
        onQuote(at.text);
        window.getSelection()?.removeAllRanges();
        setAt(null);
      }}
      className="overlay fixed z-50 flex min-h-10 items-center gap-1.5 rounded-full px-4 text-ui font-semibold text-text active:bg-selected pointer-fine:min-h-8 pointer-fine:hover:bg-border/45"
      style={place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: 'hidden' }}
      data-remote-quote-selection
    >
      <TextQuote className="size-4 text-accent-ink" aria-hidden />
      Quote
    </button>,
    document.body,
  );
}
