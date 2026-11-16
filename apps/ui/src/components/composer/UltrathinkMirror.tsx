import { useLayoutEffect, useState, type RefObject } from 'react';
import { splitUltrathink } from './ultrathink.ts';

/**
 * The message drawn under its own text box, so the word ultrathink can have a colour: a textarea can't colour part of
 * its text. While this shows, the box's own text is transparent (its caret, selection and spell check stay), so each
 * character sits where the box has it. It wraps like the box does: same type and padding (`className`), and the width
 * of the box without its scrollbar. It follows the box's scroll.
 */
export function UltrathinkMirror({ text, textarea, className }: { text: string; textarea: RefObject<HTMLTextAreaElement | null>; className: string }) {
  const [view, setView] = useState({ width: 0, top: 0 });
  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    const sync = () => setView((v) => (v.width === el.clientWidth && v.top === el.scrollTop ? v : { width: el.clientWidth, top: el.scrollTop }));
    sync();
    el.addEventListener('scroll', sync);
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', sync);
      observer.disconnect();
    };
    // The text is a dependency so the scroll position is read again after typing moves it.
  }, [textarea, text]);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" data-ultrathink-mirror>
      <div className={`break-words whitespace-pre-wrap text-text ${className}`} style={{ width: view.width || undefined, transform: `translateY(${-view.top}px)` }}>
        {splitUltrathink(text).map((part, i) =>
          part.hit ? (
            <span key={i} className="ultrathink-word" data-ultrathink-word>
              {part.text}
            </span>
          ) : (
            part.text
          ),
        )}
        {/* A last empty line has no height of its own. */}
        {text.endsWith('\n') && '​'}
      </div>
    </div>
  );
}
