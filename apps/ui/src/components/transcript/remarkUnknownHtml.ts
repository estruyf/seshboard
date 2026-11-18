import type { Parent, Root, RootContent } from 'mdast';
import { chatSchema } from './chatSchema.ts';

const KNOWN = new Set([...(chatSchema.tagNames ?? []), ...(chatSchema.strip ?? [])]);

/** A comment, which the sanitiser drops. */
const COMMENT = /<!--[\s\S]*?-->/g;
const TAG = /<\/?([A-Za-z][A-Za-z0-9:-]*)/g;

/** Whether HTML in the reply is one the sanitiser knows: a tag it keeps, one it strips with its content, or no tag at all (a comment). */
function isKnownHtml(value: string): boolean {
  const names = [...value.replace(COMMENT, '').matchAll(TAG)].map((match) => match[1]!.toLowerCase());
  return names.every((name) => KNOWN.has(name));
}

/** Where a block of HTML is a block of its own: its text then gets a paragraph. */
const FLOW_PARENTS = new Set(['root', 'blockquote', 'listItem', 'footnoteDefinition']);

function visit(parent: Parent): void {
  parent.children.forEach((node: RootContent, i) => {
    if (node.type === 'html' && !isKnownHtml(node.value)) {
      const text = { type: 'text' as const, value: node.value };
      parent.children[i] = FLOW_PARENTS.has(parent.type) ? { type: 'paragraph', children: [text] } : text;
    } else if ('children' in node) {
      visit(node as Parent);
    }
  });
}

/**
 * Text in angle brackets that is not HTML (`Promise<void>`, `git checkout <branch>`, `<your-token>`, `if x<y and z>w`)
 * reads as a tag to Markdown, and the sanitiser would drop it and what it takes with it. An `html` node whose tags the
 * sanitiser doesn't know becomes the text it was written as. Comments, tags it keeps and tags it strips (`script`, `style`)
 * are left for the sanitiser.
 */
export function remarkUnknownHtml() {
  return (tree: Root) => visit(tree);
}
