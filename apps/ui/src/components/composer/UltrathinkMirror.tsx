import { useLayoutEffect, useRef, type RefObject } from 'react';
import { splitUltrathink } from './ultrathink.ts';

/**
 * The message drawn under its own text box, so the word ultrathink can have a colour: a textarea can't colour part of
 * its text. While this shows, the box's own text is transparent (its caret, selection and spell check stay), so each
 * character sits where the box has it. It wraps like the box does: same type and padding (`className`), and the box's
 * width without its scrollbar. It follows the box's scroll.
 *
 * The scroll offset and the scrollbar's width are written straight to the element, not through state, so they are in
 * the same frame as the box's own scroll (state would paint the old offset first).
 */
export function UltrathinkMirror({ text, textarea, className, disabled }: { text: string; textarea: RefObject<HTMLTextAreaElement | null>; className: string; disabled?: boolean }) {
  const lines = useRef<HTMLDivElement>(null);
  const sync = () => {
    const el = textarea.current;
    const inner = lines.current;
    if (!el || !inner) return;
    // The margin leaves the room the box's scrollbar takes, in the box's own (fractional) layout units.
    inner.style.marginRight = `${el.offsetWidth - el.clientWidth}px`;
    inner.style.transform = `translateY(${-el.scrollTop}px)`;
  };
  // Kept current for the listeners below, which are set up once.
  const syncRef = useRef(sync);
  syncRef.current = sync;
  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    const run = () => syncRef.current();
    el.addEventListener('scroll', run);
    const observer = new ResizeObserver(run);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', run);
      observer.disconnect();
    };
  }, [textarea]);
  // Typing changes the height and the scroll position without a scroll event.
  useLayoutEffect(sync, [text]);
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${disabled ? 'opacity-60' : ''}`} data-ultrathink-mirror>
      <div ref={lines} className={`break-words whitespace-pre-wrap text-text ${className}`}>
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
