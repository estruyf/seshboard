import type { Link, Parent, PhrasingContent, Root, RootContent, Text } from 'mdast';
import { parseFileRef } from './fileRefs.ts';

/**
 * An absolute path written as plain text or in bold (`/Users/me/notes.md`, `~/a.ts:12`, `C:\work\a.ts`), with the line
 * suffixes `parseFileRef` reads. Nothing that touches it on the left, so `and/or`, `1/2`, `./a.ts` and `example.com/a` stay text.
 */
const BARE_PATH = /(?<![\p{L}\p{N}_~./\\@:+-])(?:~[\\/]|[A-Za-z]:[\\/]|\/)[\p{L}\p{N}_~./\\@+-]*(?::\d+(?::\d+)?(?:-\d+(?::\d+)?)?|#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?)?/gu;

/** Punctuation that ends the sentence rather than the path. */
const TRAILING = /[.,;:!?'"]+$/;

/**
 * A path from `/` needs two parts, so a slash command (`/clear`) is never looked up. Never a share (`//host/…`, `\\host\…`):
 * on Windows, looking it up connects to that server.
 */
const isBarePath = (path: string) => !/^[\\/]{2}/.test(path) && (!path.startsWith('/') || (path.match(/\//g)?.length ?? 0) >= 2);

/**
 * Splits a text node into text and links to the paths in it; null when it has none. Each link is marked (`dataBarePath`)
 * so it renders as the text it was until the engine finds the file (`Markdown.tsx`).
 */
export function linkBarePaths(value: string): PhrasingContent[] | null {
  const parts: PhrasingContent[] = [];
  let last = 0;
  for (const match of value.matchAll(BARE_PATH)) {
    const path = match[0].replace(TRAILING, '');
    if (!isBarePath(path) || !parseFileRef(path)) continue;
    const start = match.index;
    if (start > last) parts.push({ type: 'text', value: value.slice(last, start) });
    // `C:\a.ts` as an address would be `C:%5Ca.ts`, which `fileUrlTransform` doesn't take for a drive path; `C:/a.ts` it does.
    const url = /^[A-Za-z]:\\/.test(path) ? path.replace(/\\/g, '/') : path;
    parts.push({ type: 'link', url, children: [{ type: 'text', value: path }], data: { hProperties: { dataBarePath: true } } } satisfies Link);
    last = start + path.length;
  }
  if (parts.length === 0) return null;
  if (last < value.length) parts.push({ type: 'text', value: value.slice(last) });
  return parts;
}

function walk(node: Parent) {
  // A link's own text stays as written.
  if (node.type === 'link' || node.type === 'linkReference') return;
  node.children = node.children.flatMap((child): RootContent[] => {
    if (child.type === 'text') return linkBarePaths((child as Text).value) ?? [child];
    if ('children' in child) walk(child as Parent);
    return [child];
  });
}

/** Remark plugin: absolute paths in the text become file links, as paths in inline code already do. Run it before `remarkSeal`. */
export function remarkBarePaths() {
  return (tree: Root) => walk(tree);
}
