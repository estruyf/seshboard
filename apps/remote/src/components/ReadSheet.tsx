import { readingOf } from '../lib/turns.ts';
import { Markdown } from './Markdown.tsx';
import { Sheet } from './Sheet.tsx';

/**
 * Read: the replies of a finished turn, one after another, full height, with how long they take to read (as the
 * computer's reading mode). The tool runs between them stay in the conversation.
 */
export function ReadSheet({ texts, onClose }: { texts: readonly string[]; onClose: () => void }) {
  const { words, minutes } = readingOf(texts);
  return (
    <Sheet title="Read" subtitle={`${words.toLocaleString()} ${words === 1 ? 'word' : 'words'} · ${minutes} min read`} onClose={onClose} tall hook="read">
      <div className="flex flex-col gap-4 pt-1">
        {texts.map((text, i) => (
          <Markdown key={i} text={text} />
        ))}
      </div>
    </Sheet>
  );
}
