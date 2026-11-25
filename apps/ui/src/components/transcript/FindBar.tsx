import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '../ui/Button.tsx';
import { formatKeys, keysFor, matches } from '../../lib/shortcuts.ts';

/**
 * Find in the conversation (⌘F): Enter or ⌘G goes to the next match, ⇧Enter or ⇧⌘G to the
 * previous one (`find.next` and `find.previous` in `lib/shortcuts.ts`), Escape closes. `focusNonce` changes when ⌘F is pressed again, to refocus the field.
 */
export function FindBar({
  query,
  onQuery,
  count,
  current,
  onStep,
  onClose,
  focusNonce,
}: {
  query: string;
  onQuery: (query: string) => void;
  count: number;
  current: number;
  onStep: (direction: 1 | -1) => void;
  onClose: () => void;
  focusNonce: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusNonce]);

  const status = !query.trim() ? '' : count === 0 ? 'No results' : `${current + 1} of ${count}`;
  return (
    <div
      role="search"
      aria-label="Find in conversation"
      className="absolute top-2 right-4 z-20 flex items-center gap-1 rounded-lg border border-border bg-card py-1 pr-1 pl-2.5 shadow-lg"
      data-find-bar
    >
      <input
        ref={input}
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          // Keys that confirm an IME composition (Enter picking a candidate) belong to the input method.
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') {
            // Escape here only closes the bar; it must not reach the message box and stop Claude.
            event.preventDefault();
            event.stopPropagation();
            onClose();
          } else if (matches(event, 'find.next') || matches(event, 'find.previous')) {
            event.preventDefault();
            onStep(matches(event, 'find.previous') ? -1 : 1);
          }
        }}
        placeholder="Find in conversation"
        aria-label="Find in conversation"
        spellCheck={false}
        className="w-48 bg-transparent text-[12.5px] text-text outline-none placeholder:text-faint @max-[860px]:w-32"
        data-find-input
      />
      <span className="min-w-14 text-right text-meta text-faint tabular-nums" role="status" aria-live="polite" data-find-count>
        {status}
      </span>
      <Button variant="quiet" size="sm" iconOnly icon={<ChevronUp size={14} />} disabled={count === 0} onClick={() => onStep(-1)} data-tooltip={`Previous (${formatKeys(keysFor('find.previous'))})`} aria-label="Previous match" />
      <Button variant="quiet" size="sm" iconOnly icon={<ChevronDown size={14} />} disabled={count === 0} onClick={() => onStep(1)} data-tooltip={`Next (${formatKeys(keysFor('find.next'))})`} aria-label="Next match" />
      <Button variant="quiet" size="sm" iconOnly icon={<X size={14} aria-hidden />} kbd="Esc" onClick={onClose} aria-label="Close find" />
    </div>
  );
}
