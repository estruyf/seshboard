import { withoutSkimMarks } from '@seshboard/protocol/remote-client';
import { parseMarkdown, type Block, type Inline } from './markdown.ts';

/**
 * Read aloud: a reply as the phone's own voice says it (`speechSynthesis`, nothing leaves the phone). Code blocks and
 * tables are skipped, since they sound like noise; a path is said as its file name. Pure, with tests;
 * `components/ReadAloud.tsx` speaks the parts.
 */

/** Longer parts get cut off in some browsers (Chrome stops after about 15 seconds), so a reply goes in parts. */
export const PART_LENGTH = 220;

const words = (inlines: readonly Inline[]): string =>
  inlines
    .map((inline) => {
      switch (inline.type) {
        case 'text':
        case 'code':
          return inline.text;
        case 'file':
          return inline.path.split(/[\\/]/).pop() ?? inline.path;
        case 'br':
          return ' ';
        default:
          return words(inline.children);
      }
    })
    .join('');

/** A sentence's last character: a pause, so a heading or a list item doesn't run into the next. */
const ended = (text: string) => (/[.!?:;]$/.test(text) ? text : `${text}.`);

function lines(blocks: readonly Block[]): string[] {
  return blocks.flatMap((block): string[] => {
    switch (block.type) {
      case 'heading':
      case 'paragraph': {
        // Raw HTML stays text on screen, but its tags aren't words to say.
        const text = words(block.children).replace(/<\/?[a-z][^>]*>/gi, ' ').replace(/\s+/g, ' ').trim();
        return text ? [ended(text)] : [];
      }
      case 'list':
        return block.items.flatMap((item) => lines(item));
      case 'quote':
        return lines(block.children);
      default:
        return [];
    }
  });
}

/** Cuts a line at sentence ends, then at commas or spaces, so no part is longer than `max`. */
function cut(line: string, max: number): string[] {
  if (line.length <= max) return [line];
  const parts: string[] = [];
  let rest = line;
  while (rest.length > max) {
    const head = rest.slice(0, max);
    const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
    const at = sentence > 0 ? sentence + 1 : head.lastIndexOf(', ') > 0 ? head.lastIndexOf(', ') + 1 : head.lastIndexOf(' ');
    const end = at > 0 ? at : max;
    parts.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** The parts to say for a reply, in order: its sentences without Markdown, code or tables. Empty when nothing is left. */
export function speakableParts(markdown: string, max = PART_LENGTH): string[] {
  const parts: string[] = [];
  for (const line of lines(parseMarkdown(withoutSkimMarks(markdown)))) {
    for (const piece of cut(line, max)) {
      const last = parts.length - 1;
      // Short lines (list items) share a part, so the voice doesn't stop after each.
      if (last >= 0 && parts[last]!.length + piece.length + 1 <= max) parts[last] = `${parts[last]} ${piece}`;
      else parts.push(piece);
    }
  }
  return parts;
}
