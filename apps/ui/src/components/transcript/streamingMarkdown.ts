import { Lexer } from 'marked';
import remend from 'remend';

/**
 * Splits Markdown into top-level blocks (paragraphs, lists, fences, tables…),
 * the way Streamdown does, so a streaming message only re-renders its last block.
 * Blank lines stay with the block before them; joining the blocks gives the text back.
 */
export function splitBlocks(text: string): string[] {
  let tokens: Array<{ type: string; raw: string }>;
  try {
    tokens = Lexer.lex(text, { gfm: true });
  } catch {
    return [text];
  }
  const blocks: string[] = [];
  // How many `<details>` an HTML block opened and nothing closed yet: what is inside belongs in the same block, or it would
  // render outside the disclosure until the reply is done.
  let open = 0;
  for (const token of tokens) {
    // Spacing and link definitions belong with what came before (a definition alone renders nothing).
    if ((token.type === 'space' || token.type === 'def' || open > 0) && blocks.length) blocks[blocks.length - 1] += token.raw;
    else blocks.push(token.raw);
    if (token.type === 'html') open = Math.max(0, open + (token.raw.match(/<details[\s>]/gi)?.length ?? 0) - (token.raw.match(/<\/details\s*>/gi)?.length ?? 0));
  }
  return blocks.length ? blocks : [text];
}

/** A tag cut off at the end (`<deta`, `</summ`, `<a href="x`, `<!-`): nothing after it yet closes it. */
const PARTIAL_TAG = /<(?:\/?[A-Za-z][^<>]*|!-{0,2})$/;

/**
 * Closes what a half-written message leaves open (`**bold`, `` `code ``, `[link](ht`)
 * so it renders as formatted text instead of flashing raw markers. An unfinished
 * link shows as its text; an unfinished image stays as typed until it's complete.
 * Half an HTML tag at the end is left out until its `>` arrives: shown as text it would flash raw, and where it
 * starts an HTML block the reader of the HTML would drop it anyway.
 */
export function healMarkdown(text: string): string {
  return remend(withoutPartialTag(text), { linkMode: 'text-only', images: false, inlineKatex: false, katex: false });
}

/** The text without a tag cut off at its end. Inside a fence or inline code it is text, so it stays. */
function withoutPartialTag(text: string): string {
  const match = PARTIAL_TAG.exec(text);
  if (!match) return text;
  const before = text.slice(0, match.index);
  const fenced = (before.match(/^ {0,3}(?:```|~~~)/gm)?.length ?? 0) % 2 === 1;
  const inCode = (before.slice(before.lastIndexOf('\n') + 1).match(/`/g)?.length ?? 0) % 2 === 1;
  return fenced || inCode ? text : before;
}
