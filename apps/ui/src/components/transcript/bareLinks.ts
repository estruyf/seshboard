import type { Link, Parent, PhrasingContent, Root, RootContent, Text } from 'mdast';

/**
 * A web address written without `https://` (`github.com/org/repo/pull/12`), which GFM's autolinks leave as text.
 * Only a host followed by a path counts, so `package.json` or `a.ts` never turn into links. Nothing that touches it
 * on the left either: `you@example.com/`, `./site.dev/` and `src/github.com/` stay text.
 */
const BARE_LINK = /(?<![\w@./-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}\/[^\s<>()[\]`]*/gi;

/** Punctuation that ends the sentence rather than the address. */
const TRAILING = /[.,;:!?'"]+$/;

/** Splits a text node into text and links; null when it has no bare address. */
export function linkBareUrls(value: string): PhrasingContent[] | null {
  const parts: PhrasingContent[] = [];
  let last = 0;
  for (const match of value.matchAll(BARE_LINK)) {
    const address = match[0].replace(TRAILING, '');
    const start = match.index;
    if (start > last) parts.push({ type: 'text', value: value.slice(last, start) });
    parts.push({ type: 'link', url: `https://${address}`, children: [{ type: 'text', value: address }] } satisfies Link);
    last = start + address.length;
  }
  if (parts.length === 0) return null;
  if (last < value.length) parts.push({ type: 'text', value: value.slice(last) });
  return parts;
}

function walk(node: Parent) {
  // A link's own text stays as written.
  if (node.type === 'link' || node.type === 'linkReference') return;
  node.children = node.children.flatMap((child): RootContent[] => {
    if (child.type === 'text') return linkBareUrls((child as Text).value) ?? [child];
    if ('children' in child) walk(child as Parent);
    return [child];
  });
}

/** Remark plugin: bare web addresses in the text become links, as `https://` ones already do. Run it after remark-gfm. */
export function remarkBareLinks() {
  return (tree: Root) => walk(tree);
}
