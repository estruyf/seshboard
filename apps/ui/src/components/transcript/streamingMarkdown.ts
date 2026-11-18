import { Lexer } from 'marked';
import remend from 'remend';
import { chatSchema } from './chatSchema.ts';

/** What is not HTML in a block: comments, fenced code and inline code. */
const NOT_HTML = /<!--[\s\S]*?-->|(```|~~~)[\s\S]*?(?:\1|$)|`[^`]*`/g;

/**
 * How many `<details>` a block of HTML opens, minus how many it closes: what is between them belongs in one block. As in
 * `remarkUnknownHtml`, a tag in a sentence is no disclosure, so only a block of HTML counts, and an opener only when it
 * stands for one: its tag ends the line or goes on with another tag (`<details>`, `<details><summary>`), where
 * `<details> hides content.` is a sentence, which does not hold the blocks after it. (A reply still being written can't say if
 * its closing tag will come: an opener that stands for one holds the rest until it does.) Only lower case is a tag.
 */
function detailsDelta(raw: string, html: boolean): number {
  if (!html) return 0;
  const text = raw.replace(NOT_HTML, '');
  const opens = text.match(/<details(?:\s[^>]*)?>[ \t]*(?=\r?\n|<|$)/g)?.length ?? 0;
  const closes = text.match(/<\/details\s*>/g)?.length ?? 0;
  return opens - closes;
}

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
    if (token.type !== 'code') open = Math.max(0, open + detailsDelta(token.raw, token.type === 'html'));
  }
  return blocks.length ? blocks : [text];
}

/** A tag cut off at the end of a line (`<deta`, `</summ`, `<a href="x`, `<!-`), as far as a tag goes: nothing after it yet closes it. */
const PARTIAL_TAG = /<(?:\/?([A-Za-z][A-Za-z0-9-]*)([^<>\n]{0,200})|!-{0,2})$/;

/** The tags a reply's HTML may use (and the ones the sanitiser strips): only those are held back while they are half written. */
const TAGS = [...(chatSchema.tagNames ?? []), ...(chatSchema.strip ?? [])];

/** A fence's line, also inside a list item or a quote. */
const FENCE = /^[ \t>]*(?:(?:[-*+]|\d+[.)])[ \t]+)*(?:```|~~~)/;

/**
 * Closes what a half-written message leaves open (`**bold`, `` `code ``, `[link](ht`)
 * so it renders as formatted text instead of flashing raw markers. An unfinished
 * link shows as its text; an unfinished image stays as typed until it's complete.
 * Half an HTML tag at the end is left out until its `>` arrives: shown as text it would flash raw, and where it
 * starts an HTML block the reader of the HTML would drop it anyway. Only a tag the reply may use counts: `x<y when`
 * is text, and stays (remend's own `htmlTags` would drop any `<word` at the end, so it is off).
 */
export function healMarkdown(text: string): string {
  return remend(withoutPartialTag(text), { linkMode: 'text-only', images: false, inlineKatex: false, katex: false, htmlTags: false });
}

/** The text without a tag cut off at its end. Inside a fence or inline code it is text, so it stays. */
function withoutPartialTag(text: string): string {
  const match = PARTIAL_TAG.exec(text);
  if (!match) return text;
  const [, name, rest = ''] = match;
  if (name) {
    const lower = name.toLowerCase();
    // Still being typed: the start of a tag. Typed: a tag, followed by a space or the `/` of `<br/`.
    const tag = rest === '' ? TAGS.some((known) => known.startsWith(lower)) : /^[\s/]/.test(rest) && TAGS.includes(lower);
    if (!tag) return text;
  }
  const before = text.slice(0, match.index);
  const fenced = before.split('\n').filter((line) => FENCE.test(line)).length % 2 === 1;
  const inCode = (before.match(/`+/g)?.length ?? 0) % 2 === 1;
  return fenced || inCode ? text : before;
}
