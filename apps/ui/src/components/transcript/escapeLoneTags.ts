import type { Html, Parent } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import type { PluggableList } from 'unified';
import { unified } from 'unified';
import { chatSchema } from './chatSchema.ts';

/** The Markdown syntax a reply is read with (GFM, and what else adds syntax, such as maths). The pre-pass reads it the same way the renderer does. */
export const MARKDOWN_SYNTAX: PluggableList = [remarkGfm];

const processor = unified().use(remarkParse).use(MARKDOWN_SYNTAX);

const KNOWN = new Set([...(chatSchema.tagNames ?? []), ...(chatSchema.strip ?? [])]);

/** A comment, which the sanitiser drops. */
const COMMENT = /<!--[\s\S]*?-->/g;
const TAG_START = /<\/?([A-Za-z][A-Za-z0-9:-]*)/g;
/** One tag, with its attributes (a `>` may be inside their quotes): closing, name, attributes, self-closing. */
const TAG_EVENT = /<(\/?)([A-Za-z][A-Za-z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
/** One tag as an inline `html` node holds it. */
const ONE_TAG = new RegExp(`^${TAG_EVENT.source}$`);

/** Tags with no closing one. */
const VOID = new Set(['br', 'hr', 'img', 'input', 'wbr']);
/** Tags whose end tag is optional: the element around them closes them, so they are not paired. */
const OPTIONAL_END = new Set(['li', 'p', 'td', 'th', 'tr', 'dt', 'dd', 'tbody', 'thead', 'tfoot', 'option']);
/** Tags whose content is text: what looks like a tag inside is not one. */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);
/**
 * The tags that may sit in a line of text. `details`, `pre`, `table` and the other block tags are only HTML as a block of their
 * own: in a sentence they would break its paragraph, so there they are text.
 */
const INLINE = new Set([
  ...VOID,
  ...['a', 'abbr', 'b', 'bdo', 'big', 'cite', 'code', 'del', 'dfn', 'em', 'i', 'ins', 'kbd', 'label', 'mark', 'q', 's', 'samp', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'tt', 'u', 'var'],
  ...RAW_TEXT,
]);

/** Where an `html` node is a block of its own. */
const FLOW_PARENTS = new Set(['root', 'blockquote', 'listItem', 'footnoteDefinition']);

const blank = (value: string) => value.replace(COMMENT, (comment) => ' '.repeat(comment.length));

/**
 * Whether HTML in the reply is one the sanitiser knows: a tag it keeps, one it strips with its content, or no tag at all (a
 * comment). A name with an upper-case letter is not: `Foo<I>` and `useState<S>` are types, and HTML written for Markdown is
 * lower case.
 */
export function isKnownHtml(value: string): boolean {
  return [...blank(value).matchAll(TAG_START)].every((match) => match[1] === match[1]!.toLowerCase() && KNOWN.has(match[1]!));
}

/** Where each tag of a piece of HTML starts. */
const tagStarts = (value: string): number[] => [...blank(value).matchAll(TAG_START)].map((match) => match.index);

/**
 * A tag that opens or closes an element: not a void tag (`<br>`), a self-closing one or one whose end tag is optional. `at`:
 * where it starts. `prose`: an opening tag with text after it on its line and no end tag there (`<details> hides content.`):
 * a sentence, not HTML.
 */
interface TagEvent {
  name: string;
  closing: boolean;
  at: number;
  prose: boolean;
}

/** The tags of a piece of HTML in order, leaving out comments and what is inside a `script`, `style`, `textarea` or `title` that is not a sentence. */
export function tagEvents(value: string): TagEvent[] {
  const text = blank(value);
  const events: TagEvent[] = [];
  const read = new RegExp(TAG_EVENT.source, 'g');
  for (let match = read.exec(text); match; match = read.exec(text)) {
    const name = match[2]!;
    if (VOID.has(name) || OPTIONAL_END.has(name) || match[4]) continue;
    const closing = match[1] === '/';
    let prose = false;
    if (!closing) {
      const end = match.index + match[0].length;
      const newline = text.indexOf('\n', end);
      const rest = text.slice(end, newline < 0 ? undefined : newline).trim();
      prose = rest !== '' && !rest.startsWith('<') && !new RegExp(`</${name}\\s*>`).test(rest);
    }
    events.push({ name, closing, at: match.index, prose });
    if (!closing && !prose && RAW_TEXT.has(name)) {
      // Its content is not HTML: go on at its end tag, which is the next event.
      const end = new RegExp(`</${name}\\s*>`, 'g');
      end.lastIndex = read.lastIndex;
      read.lastIndex = end.exec(text)?.index ?? text.length;
    }
  }
  return events;
}

/** The positions in `events` of the tags that open an element nothing closes, or close one nothing opened. */
function unpairedAmong(events: ReadonlyArray<{ name: string; closing: boolean }>): Set<number> {
  const lone = new Set<number>();
  const open: Array<{ name: string; k: number }> = [];
  events.forEach((event, k) => {
    if (!event.closing) return void open.push({ name: event.name, k });
    const at = open.map((entry) => entry.name).lastIndexOf(event.name);
    if (at < 0) return void lone.add(k);
    // What was opened inside it and never closed is lone.
    for (const entry of open.splice(at)) if (entry.name !== event.name) lone.add(entry.k);
  });
  for (const entry of open) lone.add(entry.k);
  return lone;
}

/**
 * Where in the source `index` of an `html` node's value is. A node in a quote or a list item has lost the start of each line
 * (`> `, the indent), so a line of the value is the end of the line of the source. Null when it can't be told.
 */
function sourceOffset(markdown: string, node: Html, index: number): number | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) return null;
  const raw = markdown.slice(start, end);
  if (raw === node.value) return start + index;
  const source = raw.split('\n');
  const value = node.value.split('\n');
  if (source.length !== value.length) return null;
  let valueStart = 0;
  let sourceStart = 0;
  for (let line = 0; line < value.length; line++) {
    if (index <= valueStart + value[line]!.length) {
      if (!source[line]!.endsWith(value[line]!)) return null;
      return start + sourceStart + (source[line]!.length - value[line]!.length) + (index - valueStart);
    }
    valueStart += value[line]!.length + 1;
    sourceStart += source[line]!.length + 1;
  }
  return null;
}

/** The offsets in `markdown` of the `<` of every tag that is text and not HTML. */
function loneTags(markdown: string): number[] {
  const offsets: number[] = [];
  const add = (node: Html, index: number) => {
    const at = sourceOffset(markdown, node, index);
    if (at !== null && markdown[at] === '<') offsets.push(at);
  };

  /** A block of HTML in the document, paired across the blocks of its parent: `<details>` opens in one and closes in another, with Markdown between. */
  const flow = (parent: Parent) => {
    const events: Array<TagEvent & { node: Html }> = [];
    for (const node of parent.children) {
      if (node.type !== 'html') continue;
      if (!isKnownHtml(node.value)) for (const at of tagStarts(node.value)) add(node, at);
      else for (const event of tagEvents(node.value)) events.push({ ...event, node });
    }
    for (const event of events) if (event.prose) add(event.node, event.at);
    const pairable = events.filter((event) => !event.prose);
    for (const k of unpairedAmong(pairable)) add(pairable[k]!.node, pairable[k]!.at);
  };

  /** A tag in a line of text: text when its other half isn't among its siblings, or when it is a block tag. */
  const inline = (parent: Parent) => {
    const tags: Array<{ name: string; closing: boolean; node: Html }> = [];
    for (const node of parent.children) {
      if (node.type !== 'html') continue;
      if (!isKnownHtml(node.value)) {
        for (const at of tagStarts(node.value)) add(node, at);
        continue;
      }
      const match = ONE_TAG.exec(node.value.trim());
      const name = match?.[2];
      if (!name || VOID.has(name) || match[4]) continue;
      if (!INLINE.has(name)) add(node, node.value.indexOf('<'));
      else tags.push({ name, closing: match[1] === '/', node });
    }
    for (const k of unpairedAmong(tags)) add(tags[k]!.node, tags[k]!.node.value.indexOf('<'));
  };

  const walk = (parent: Parent) => {
    if (FLOW_PARENTS.has(parent.type)) flow(parent);
    else inline(parent);
    for (const child of parent.children) if ('children' in child) walk(child as Parent);
  };
  walk(processor.parse(markdown));
  return offsets;
}

/**
 * Text in angle brackets that is not HTML (`Promise<void>`, `git checkout <branch>`, `<your-token>`, `if x<y and z>w`,
 * `useState<S>`) reads as a tag to Markdown, and the sanitiser would drop it and what it takes with it. A tag that opens
 * something nothing closes would take the rest of the reply (`wrap it in a <details> element`, an unclosed `<pre>`, which
 * Markdown lets run to the end of the document). So the reply is read once to find them, and the `<` of each becomes `&lt;`,
 * in Markdown and in a block of HTML alike. The caller then reads the result once, so references, footnotes and syntax see one document.
 *
 * Text is a tag the sanitiser doesn't know (and one with an upper-case letter); one that opens or closes an element nothing here
 * closes or opens, in a block of HTML (paired across the blocks of its parent) or in a line of text; an opening tag followed by
 * a sentence on its line (`<details> hides content.`); and a block tag in a line of text. Comments, void tags, tags with an
 * optional end tag (`li`, `td`), paired tags and those the sanitiser strips (`script`, `style`) with their end tag are left. Code
 * spans and fences are never touched, and a `&lt;` stays as it is. Reading again changes nothing, and the loop goes on
 * only while a round escapes a tag: a block that swallowed text (`<script>` runs to the end of the document) can hide more.
 */
export function escapeLoneTags(markdown: string): string {
  if (!/<\/?[A-Za-z]/.test(markdown)) return markdown;
  let text = markdown;
  for (;;) {
    const offsets = [...new Set(loneTags(text))].sort((a, b) => b - a);
    if (offsets.length === 0) return text;
    for (const at of offsets) text = `${text.slice(0, at)}&lt;${text.slice(at + 1)}`;
  }
}
