import type { Parent, Root, RootContent } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { chatSchema } from './chatSchema.ts';

const KNOWN = new Set([...(chatSchema.tagNames ?? []), ...(chatSchema.strip ?? [])]);

/** A comment, which the sanitiser drops. */
const COMMENT = /<!--[\s\S]*?-->/g;
const TAG = /<\/?([A-Za-z][A-Za-z0-9:-]*)/g;
/** One tag, with its attributes (a `>` may be inside their quotes): closing, name, attributes, self-closing. */
const TAG_EVENT = /<(\/?)([A-Za-z][A-Za-z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
/** One tag as an inline `html` node holds it. */
const ONE_TAG = new RegExp(`^${TAG_EVENT.source}$`);

/** Tags with no closing one. */
const VOID = new Set(['br', 'hr', 'img', 'input', 'wbr']);
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

/**
 * Whether HTML in the reply is one the sanitiser knows: a tag it keeps, one it strips with its content, or no tag at all (a
 * comment). A name with an upper-case letter is not: `Foo<I>` and `useState<S>` are types, and HTML written for Markdown is
 * lower case.
 */
export function isKnownHtml(value: string): boolean {
  const names = [...value.replace(COMMENT, '').matchAll(TAG)].map((match) => match[1]!);
  return names.every((name) => name === name.toLowerCase() && KNOWN.has(name));
}

/** A tag that opens or closes an element: not a void tag (`<br>`) or a self-closing one. `at`: where it starts. */
interface TagEvent {
  name: string;
  closing: boolean;
  at: number;
}

/** The tags of a piece of HTML in order, leaving out comments, void tags and what is inside a `script`, `style`, `textarea` or `title`. */
export function tagEvents(value: string): TagEvent[] {
  const text = value.replace(COMMENT, (comment) => ' '.repeat(comment.length));
  const events: TagEvent[] = [];
  const read = new RegExp(TAG_EVENT.source, 'g');
  for (let match = read.exec(text); match; match = read.exec(text)) {
    const name = match[2]!;
    if (VOID.has(name) || match[4]) continue;
    const closing = match[1] === '/';
    events.push({ name, closing, at: match.index });
    if (!closing && RAW_TEXT.has(name)) {
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

/** Where an `html` node is a block of its own: its text then gets a paragraph. */
const FLOW_PARENTS = new Set(['root', 'blockquote', 'listItem', 'footnoteDefinition']);
/** Where an `html` node is one tag in a line of text, and has to find its other half among its siblings. */
const INLINE_PARENTS = new Set(['paragraph', 'heading', 'tableCell', 'emphasis', 'strong', 'delete', 'link', 'linkReference']);

const parser = unified().use(remarkParse).use(remarkGfm);

/** `<` before each of these positions is text: Markdown reads the line again without taking it for a tag. */
function escapeTags(value: string, positions: readonly number[]): string {
  return [...positions].sort((a, b) => b - a).reduce((text, at) => `${text.slice(0, at)}\\${text.slice(at)}`, value);
}

const asText = (value: string, flow: boolean): RootContent => (flow ? { type: 'paragraph', children: [{ type: 'text', value }] } : { type: 'text', value });

/** Text and tags the sanitiser doesn't know: they become the text they were written as. */
function textOfUnknown(parent: Parent): void {
  const flow = FLOW_PARENTS.has(parent.type);
  parent.children.forEach((node: RootContent, i) => {
    if (node.type === 'html' && !isKnownHtml(node.value)) parent.children[i] = asText(node.value, flow);
  });
}

/**
 * A block of HTML in the document, paired across its blocks: `<details>` opens in one and closes in another, with Markdown
 * between. A tag nothing pairs is text, and the Markdown after it is read again: an unclosed `<pre>`, `<script>` or `<style>`
 * takes the rest of the document as its own block, and an unclosed `<details>` or `<b>` on a line of its own would otherwise take
 * all after it.
 */
function pairBlocks(parent: Parent): void {
  for (let round = 0; round < 10; round++) {
    textOfUnknown(parent);
    const events: Array<TagEvent & { owner: number }> = [];
    parent.children.forEach((node: RootContent, i) => {
      if (node.type === 'html') for (const event of tagEvents(node.value)) events.push({ ...event, owner: i });
    });
    const lone = unpairedAmong(events);
    if (lone.size === 0) return;
    const positions = new Map<number, number[]>();
    for (const k of lone) positions.set(events[k]!.owner, [...(positions.get(events[k]!.owner) ?? []), events[k]!.at]);
    parent.children = parent.children.flatMap((node: RootContent, i) => {
      const at = positions.get(i);
      return at && node.type === 'html' ? parser.parse(escapeTags(node.value, at)).children : [node];
    });
  }
}

/** A tag in a line of text: text when its other half isn't among its siblings, or when it is a block tag. */
function textOfLoneInline(parent: Parent): void {
  textOfUnknown(parent);
  const tags: Array<{ name: string; closing: boolean; i: number }> = [];
  parent.children.forEach((node: RootContent, i) => {
    if (node.type !== 'html') return;
    const match = ONE_TAG.exec(node.value.trim());
    const name = match?.[2];
    if (!name || VOID.has(name) || match[4]) return;
    if (!INLINE.has(name)) return void (parent.children[i] = asText(node.value, false));
    tags.push({ name, closing: match[1] === '/', i });
  });
  for (const k of unpairedAmong(tags)) {
    const node = parent.children[tags[k]!.i]!;
    if (node.type === 'html') parent.children[tags[k]!.i] = asText(node.value, false);
  }
}

function visit(parent: Parent): void {
  if (FLOW_PARENTS.has(parent.type)) pairBlocks(parent);
  else if (INLINE_PARENTS.has(parent.type)) textOfLoneInline(parent);
  for (const node of parent.children) if ('children' in node) visit(node as Parent);
}

/**
 * Text in angle brackets that is not HTML (`Promise<void>`, `git checkout <branch>`, `<your-token>`, `if x<y and z>w`,
 * `useState<S>`) reads as a tag to Markdown, and the sanitiser would drop it and what it takes with it. An `html` node whose
 * tags the sanitiser doesn't know becomes the text it was written as. So does a tag that opens an element nothing closes, or
 * closes one nothing opened, in a block of HTML (paired across the blocks of its parent) and in a line of text (`wrap it in a
 * <details> element` would put the rest of the reply inside a disclosure), and a block tag in a line of text. Comments, void tags
 * and paired tags are left for the sanitiser, and so are tags it strips (`script`, `style`) with their end tag.
 */
export function remarkUnknownHtml() {
  return (tree: Root) => visit(tree);
}
