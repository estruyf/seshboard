import type { OutlineEntry } from '../transcript/readReply.ts';
import { SectionHeader } from '../ui/SectionHeader.tsx';

const INDENT = { 1: '', 2: 'pl-3', 3: 'pl-6' } as const;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The headings of the reply, with the one the reader is at marked, and under them what the reply holds. It only
 * shows where there is room (1100px and wider) and when the reply has headings.
 */
export function ReadOutline({ outline, current, tools, words, minutes, onJump }: { outline: readonly OutlineEntry[]; current: number; tools: number; words: number; minutes: number; onJump(index: number): void }) {
  if (outline.length === 0) return null;
  return (
    <nav aria-label="In this reply" data-read-outline className="hidden w-55 shrink-0 flex-col gap-3 overflow-y-auto px-4 pt-8 pb-8 min-[1100px]:flex">
      <SectionHeader>In this reply</SectionHeader>
      <ul className="grid gap-0.5">
        {outline.map((entry, index) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              onClick={(event) => {
                event.preventDefault();
                onJump(index);
              }}
              aria-current={index === current ? 'location' : undefined}
              className={`block rounded-sm border-l-2 py-1 pr-2 text-ui leading-snug hover:bg-border/45 hover:text-paper-text ${INDENT[entry.level]} ${
                index === current ? 'border-accent-ink pl-2 font-semibold text-paper-text' : 'border-transparent pl-2 text-muted'
              }`}
            >
              {entry.text}
            </a>
          </li>
        ))}
      </ul>
      <p className="grid gap-0.5 text-meta text-muted">
        {tools > 0 && <span>{plural(tools, 'tool', 'tools')} used</span>}
        <span className="tabular-nums">
          {plural(words, 'word', 'words')} · {minutes} min read
        </span>
      </p>
    </nav>
  );
}
