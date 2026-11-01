import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { clearFindHighlights, rangesIn, setFindHighlights } from '../../lib/findHighlights.ts';
import { matches } from '../../lib/shortcuts.ts';

/** What Find looks in: your messages and Claude's replies (`data-remember-from`), as in a local session. */
const SEARCHABLE = '[data-remember-from]';

/**
 * Find in another computer's conversation (⌘F), with the local `FindBar`. Its conversation is not virtualised, so the
 * matches are the ranges in the messages on the page, drawn with the same highlights. `active`: the pane has the keys.
 * `content` changes when the messages do, so the matches follow; `resetKey` (the session) starts without a search.
 */
export function useRemoteFind(scroller: RefObject<HTMLElement | null>, { active, content, resetKey }: { active: boolean; content: unknown; resetKey: string }) {
  const [query, setQuery] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [current, setCurrent] = useState(-1);
  const [count, setCount] = useState(0);
  const owner = useId();
  const reveal = useRef(false);
  const needle = query?.trim().toLowerCase() ?? '';

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (!matches(event, 'find')) return;
      event.preventDefault();
      setQuery((q) => q ?? '');
      setFocusNonce((n) => n + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  // A new search starts at the first match, and shows it.
  useEffect(() => {
    setCurrent(needle ? 0 : -1);
    reveal.current = true;
  }, [needle]);

  // The highlights, after every render that can move them: the text, new messages, the current match.
  useLayoutEffect(() => {
    const root = scroller.current;
    if (!root || !needle) {
      setCount(0);
      return clearFindHighlights(owner);
    }
    const all = [...root.querySelectorAll(SEARCHABLE)].flatMap((el) => rangesIn(el, needle));
    setCount(all.length);
    const at = all.length ? Math.min(Math.max(current, 0), all.length - 1) : -1;
    const range = all[at] ?? null;
    setFindHighlights(owner, all, range);
    if (reveal.current && range) {
      reveal.current = false;
      const box = root.getBoundingClientRect();
      const rect = range.getBoundingClientRect();
      if (rect.top < box.top + 48 || rect.bottom > box.bottom - 48) root.scrollTop += rect.top - (box.top + box.height / 2);
    }
  }, [needle, current, content, owner, scroller]);

  const close = () => {
    setQuery(null);
    setCurrent(-1);
    clearFindHighlights(owner);
  };
  useEffect(() => () => clearFindHighlights(owner), [owner]);
  useEffect(close, [resetKey]);

  const step = (direction: 1 | -1) => {
    if (count === 0) return;
    setCurrent((c) => (c + direction + count) % count);
    reveal.current = true;
  };

  return { query, setQuery, count, current: count ? Math.min(Math.max(current, 0), count - 1) : -1, step, close, focusNonce };
}
