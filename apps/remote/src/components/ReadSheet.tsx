import { useRef } from 'react';
import { readingOf } from '../lib/turns.ts';
import { Markdown } from './Markdown.tsx';
import { SelectionQuote } from './SelectionQuote.tsx';
import { Sheet } from './Sheet.tsx';

/**
 * Read: the replies of a finished turn, one after another, full height, with how long they take to read (as the
 * computer's reading mode). The tool runs between them stay in the conversation. Selected text can be quoted: the
 * sheet closes and the quote goes in the message box (`onQuote`).
 */
export function ReadSheet({ texts, onClose, onQuote }: { texts: readonly string[]; onClose: () => void; onQuote?: (text: string) => void }) {
  const { words, minutes } = readingOf(texts);
  const body = useRef<HTMLDivElement>(null);
  return (
    <Sheet title="Read" subtitle={`${words.toLocaleString()} ${words === 1 ? 'word' : 'words'} · ${minutes} min read`} onClose={onClose} tall hook="read">
      <div ref={body} className="flex flex-col gap-4 pt-1">
        {texts.map((text, i) => (
          <div key={i} data-quote-source>
            <Markdown text={text} />
          </div>
        ))}
      </div>
      {onQuote && <SelectionQuote root={body} onQuote={onQuote} />}
    </Sheet>
  );
}
