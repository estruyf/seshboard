import type { Parent, Root, RootContent } from 'mdast';
import { chatSchema } from './chatSchema.ts';

const KNOWN = new Set([...(chatSchema.tagNames ?? []), ...(chatSchema.strip ?? [])]);

/** A comment, which the sanitiser drops. */
const COMMENT = /<!--[\s\S]*?-->/g;
const TAG = /<\/?([A-Za-z][A-Za-z0-9:-]*)/g;
/** One tag as an inline `html` node holds it: closing, name, self-closing. */
const ONE_TAG = /^<(\/?)([A-Za-z][A-Za-z0-9:-]*)[^>]*?(\/?)>$/;

/** Tags with no closing one. */
const VOID = new Set(['br', 'hr', 'img', 'input', 'wbr']);

/**
 * Whether HTML in the reply is one the sanitiser knows: a tag it keeps, one it strips with its content, or no tag at all (a
 * comment). A name with an upper-case letter is not: `Foo<I>` and `useState<S>` are types, and HTML written for Markdown is
 * lower case.
 */
export function isKnownHtml(value: string): boolean {
  const names = [...value.replace(COMMENT, '').matchAll(TAG)].map((match) => match[1]!);
  return names.every((name) => name === name.toLowerCase() && KNOWN.has(name));
}

/**
 * The tag an inline `html` node is, when it opens or closes an element that needs the other: null for a comment, a void tag
 * (`<br>`, `<img>`) or a self-closing one. `closing` is the `/` of an end tag.
 */
export function pairedTag(value: string): { name: string; closing: boolean } | null {
  const match = ONE_TAG.exec(value.trim());
  if (!match) return null;
  const name = match[2]!;
  return VOID.has(name) || match[3] ? null : { name, closing: match[1] === '/' };
}

/** Where a block of HTML is a block of its own: its text then gets a paragraph. */
const FLOW_PARENTS = new Set(['root', 'blockquote', 'listItem', 'footnoteDefinition']);
/** Where an `html` node is one tag in a line of text, and has to find its other half among its siblings. */
const INLINE_PARENTS = new Set(['paragraph', 'heading', 'tableCell', 'emphasis', 'strong', 'delete', 'link', 'linkReference']);

/** The indexes of the `html` nodes among `children` that open or close an element nothing here closes or opens. */
function unpaired(children: readonly RootContent[]): Set<number> {
  const lone = new Set<number>();
  const open: Array<{ name: string; i: number }> = [];
  children.forEach((node, i) => {
    if (node.type !== 'html' || !isKnownHtml(node.value)) return;
    const tag = pairedTag(node.value);
    if (!tag) return;
    if (!tag.closing) return void open.push({ name: tag.name, i });
    const at = open.map((entry) => entry.name).lastIndexOf(tag.name);
    if (at < 0) return void lone.add(i);
    // What was opened inside it and never closed is lone.
    for (const entry of open.splice(at)) if (entry.name !== tag.name) lone.add(entry.i);
  });
  for (const entry of open) lone.add(entry.i);
  return lone;
}

function visit(parent: Parent): void {
  const lone = INLINE_PARENTS.has(parent.type) ? unpaired(parent.children) : new Set<number>();
  parent.children.forEach((node: RootContent, i) => {
    if (node.type === 'html' && (lone.has(i) || !isKnownHtml(node.value))) {
      const text = { type: 'text' as const, value: node.value };
      parent.children[i] = FLOW_PARENTS.has(parent.type) ? { type: 'paragraph', children: [text] } : text;
    } else if ('children' in node) {
      visit(node as Parent);
    }
  });
}

/**
 * Text in angle brackets that is not HTML (`Promise<void>`, `git checkout <branch>`, `<your-token>`, `if x<y and z>w`,
 * `useState<S>`) reads as a tag to Markdown, and the sanitiser would drop it and what it takes with it. An `html` node whose
 * tags the sanitiser doesn't know becomes the text it was written as. So does a tag in a line of text that opens an element
 * nothing closes, or closes one nothing opened (`wrap it in a <details> element` would put the rest of the reply inside a
 * disclosure). Comments, void tags, block HTML of tags it keeps and tags it strips (`script`, `style`) are left for the
 * sanitiser.
 */
export function remarkUnknownHtml() {
  return (tree: Root) => visit(tree);
}
