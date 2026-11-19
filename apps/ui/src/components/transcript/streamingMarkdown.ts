import { Lexer } from 'marked';
import remend from 'remend';
import { chatSchema } from './chatSchema.ts';
import { escapeLoneTags, escapeLoneTagsOpen } from './escapeLoneTags.ts';

/** What is not HTML in a block: comments, fenced code and inline code. */
const NOT_HTML = /<!--[\s\S]*?-->|(```|~~~)[\s\S]*?(?:\1|$)|`[^`]*`/g;

/** A `<details>` that stands for a disclosure: alone on its line, or going on with another tag (`<summary>`). `<details> hides content.` is a sentence. */
const DETAILS_OPENER = /^[ \t]*<details(?:\s[^>]*)?>[ \t]*(?=\r?\n|<|$)/gm;
const DETAILS_CLOSER = /<\/details\s*>/g;

/** How many disclosures `raw` leaves open (negative: closes). Only lower case is a tag. */
function openDetails(raw: string): number {
  const text = raw.replace(NOT_HTML, '');
  return (text.match(DETAILS_OPENER)?.length ?? 0) - (text.match(DETAILS_CLOSER)?.length ?? 0);
}

/**
 * What is between a block of HTML's `<details>` and its `</details>` belongs in one block. As in `escapeLoneTags`, a tag in a
 * sentence is no disclosure, so only a block of HTML counts, and an opener only when it stands for one. (A reply still being
 * written can't say if its closing tag will come: an opener that stands for one holds the rest until it does, see `healMarkdown`.)
 */
const detailsDelta = (raw: string, html: boolean): number => (html ? openDetails(raw) : 0);

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
 * is text, and stays (remend's own `htmlTags` would drop any `<word` at the end, so it is off). A `<details>` still open gets its
 * `</details>`, so it shows as a disclosure while it is written, not as source until the end tag comes.
 */
export function healMarkdown(text: string): string {
  const healed = remend(withoutPartialTag(text), { linkMode: 'text-only', images: false, inlineKatex: false, katex: false, htmlTags: false });
  return healed + '\n\n</details>'.repeat(Math.max(0, openDetails(healed)));
}

/**
 * The blocks of a reply that is still being written, from scratch: the last one healed, then the lone tags in the whole text made text
 * (`escapeLoneTags`, which must see the text before it is split: a tag and its end tag can be in different blocks), and the
 * text split.
 */
export function streamingBlocksFresh(text: string): string[] {
  return splitBlocks(streamingText(text));
}

function streamingText(text: string): string {
  const blocks = splitBlocks(text);
  const last = blocks.length - 1;
  return escapeLoneTags(blocks.slice(0, last).join('') + healMarkdown(blocks[last]!));
}

/** `prefix` followed by the blocks of `text`, as splitting both together would give: a start of nothing but space belongs to the block before it. */
function withTail(prefix: readonly string[], text: string): string[] {
  if (text === '') return prefix.length ? [...prefix] : [''];
  const tail = splitBlocks(text);
  if (prefix.length && tail[0]!.trim() === '') return [...prefix.slice(0, -1), prefix[prefix.length - 1]! + tail[0], ...tail.slice(1)];
  return [...prefix, ...tail];
}

/** Blank lines after an opener that has no end tag, past which a reply being written takes it for text (`escapeLoneTagsOpen`), so a `<div>` alone on a line doesn't keep the whole reply from being kept. */
const GIVE_UP_AFTER = 8;

/** What `streamingBlocks` has done for a reply: the start of its text that is final, and that start's blocks, escaped. */
export interface StreamingCache {
  raw: string;
  blocks: string[];
}

export const newStreamingCache = (): StreamingCache => ({ raw: '', blocks: [] });

/** Where two texts are the same up to. */
function commonLength(a: string, b: string): number {
  let i = 0;
  const max = Math.min(a.length, b.length);
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

/**
 * `streamingBlocksFresh`, without reading the whole reply again on every delta. Only the last block of a reply changes as it is
 * written, so the blocks before it are kept in `cache` once they can't change (the result is what `streamingBlocksFresh` gives
 * for the whole text). The text since the kept start is escaped, and all but the last of its blocks are kept, with as much of the
 * raw text as they stand for (the escaping only adds `&lt;`, so a length in the result is a length of the raw text less 3 for each
 * before it). That is only so while nothing there can still change: a `<div>` or `<pre>` still waiting for its end tag keeps the text
 * since it in play, as it did, but only until `GIVE_UP_AFTER` blank lines have passed: then the opener is text for good (an end tag
 * that comes later finds nothing to close, until the reply is finished and read whole). `giveUpAfter` is for tests, which want the
 * result to be exactly the whole text's.
 */
export function streamingBlocks(text: string, cache: StreamingCache = newStreamingCache(), giveUpAfter = GIVE_UP_AFTER): string[] {
  if (!text.startsWith(cache.raw)) {
    cache.raw = '';
    cache.blocks = [];
  }
  const tail = text.slice(cache.raw.length);
  const raw = splitBlocks(tail);
  const last = raw.length - 1;
  const healed = raw.slice(0, last).join('') + healMarkdown(raw[last]!);
  const { text: escaped, open, escapes } = escapeLoneTagsOpen(healed, giveUpAfter);
  const blocks = splitBlocks(escaped);
  if (!open && blocks.length > 1) {
    const stable = blocks.slice(0, -1);
    const length = stable.join('').length;
    const rawLength = length - 3 * escapes.filter((at) => at < length).length;
    // The raw text must be what was escaped: healing the end of the reply (or a `>` in a list) changed none of it.
    if (rawLength > 0 && rawLength <= commonLength(tail, healed)) {
      cache.raw += tail.slice(0, rawLength);
      cache.blocks = [...cache.blocks, ...stable];
      return withTail(cache.blocks, blocks[blocks.length - 1]!);
    }
  }
  return withTail(cache.blocks, escaped);
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
