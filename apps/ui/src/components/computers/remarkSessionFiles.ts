import type { Parent, PhrasingContent, Root, RootContent } from 'mdast';
import { findSessionFiles } from '@seshboard/protocol/client';

/**
 * Marks the absolute paths in another computer's text (`findSessionFiles`), so `RemoteText` can make them links that
 * preview the file through that computer. A path in a sentence becomes a `span` with `data-session-file`; inline code
 * that is only a path gets the same attribute. Links and code blocks stay as they are. Nothing is looked up here: the
 * other computer decides whether the session made the file.
 */
export function remarkSessionFiles() {
  return (tree: Root) => mark(tree);
}

/** The attribute a marked node renders with, holding the path. */
export const SESSION_FILE_ATTRIBUTE = 'data-session-file';

function mark(parent: Parent): void {
  const next: RootContent[] = [];
  for (const node of parent.children) {
    if (node.type === 'text') next.push(...split(node.value));
    else if (node.type === 'inlineCode') next.push(markCode(node));
    else {
      if ('children' in node && node.type !== 'link' && node.type !== 'linkReference') mark(node);
      next.push(node);
    }
  }
  parent.children = next;
}

function markCode(node: Extract<PhrasingContent, { type: 'inlineCode' }>): PhrasingContent {
  const [found] = findSessionFiles(node.value);
  if (!found || found.start !== 0 || found.end !== node.value.length) return node;
  return { ...node, data: { ...node.data, hProperties: { ...(node.data?.hProperties ?? {}), dataSessionFile: found.path } } };
}

/** The text with each path in a `span` of its own (an emphasis node renamed, so its text stays as it is). */
function split(value: string): PhrasingContent[] {
  const found = findSessionFiles(value);
  if (!found.length) return [{ type: 'text', value }];
  const out: PhrasingContent[] = [];
  let at = 0;
  for (const { start, end, path } of found) {
    if (start > at) out.push({ type: 'text', value: value.slice(at, start) });
    out.push({ type: 'emphasis', children: [{ type: 'text', value: path }], data: { hName: 'span', hProperties: { dataSessionFile: path } } });
    at = end;
  }
  if (at < value.length) out.push({ type: 'text', value: value.slice(at) });
  return out;
}
