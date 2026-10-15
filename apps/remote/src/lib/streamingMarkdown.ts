import { Lexer } from 'marked';
import remend from 'remend';

/**
 * Claude's text while it is still being written, as on the computer (apps/ui `transcript/streamingMarkdown.ts`). Pure,
 * with tests.
 */

/**
 * Splits markdown into top-level blocks (paragraphs, lists, fences, tables…), so a streaming answer only parses its
 * last block again on each delta. Blank lines stay with the block before them; joining the blocks gives the text back.
 */
export function splitBlocks(text: string): string[] {
  let tokens: Array<{ type: string; raw: string }>;
  try {
    tokens = Lexer.lex(text, { gfm: true });
  } catch {
    return [text];
  }
  const blocks: string[] = [];
  for (const token of tokens) {
    // Spacing and link definitions belong with what came before (a definition alone draws nothing).
    if ((token.type === 'space' || token.type === 'def') && blocks.length) blocks[blocks.length - 1] += token.raw;
    else blocks.push(token.raw);
  }
  return blocks.length ? blocks : [text];
}

/**
 * Closes what a half-written answer leaves open (`**bold`, `` `code ``, `[link](ht`), so it shows formatted instead of
 * flashing raw markers. An unfinished link shows as its text; an unfinished image stays as typed until it's complete.
 */
export function healMarkdown(text: string): string {
  return remend(text, { linkMode: 'text-only', images: false, inlineKatex: false, katex: false });
}
