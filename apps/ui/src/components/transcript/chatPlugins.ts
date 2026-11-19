import type { Element, Root } from 'hast';
import type { PluggableList } from 'unified';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { remarkAlerts } from '../filePreview/remarkAlerts.ts';
import { remarkBareLinks } from './bareLinks.ts';
import { chatSchema } from './chatSchema.ts';
import { MARKDOWN_SYNTAX } from './escapeLoneTags.ts';
import { FOOTNOTE_LABEL_PROPERTIES, FOOTNOTE_PREFIX, rehypeUnseal, remarkSeal } from './markdownSeal.ts';
import { remarkSkimFade } from './skimFade.ts';

/**
 * The plugins of a reply's Markdown (`Markdown.tsx`), in one place so the tests render with the same ones. `keep`: the
 * sentences Skim keeps, the rest fade (Skim's plugin runs before the seal that carries its marks past the sanitiser).
 *
 * GFM links `https://` and `www.` addresses; `remarkBareLinks` the ones written without either (`github.com/…`);
 * `remarkAlerts` marks GitHub's alerts. The text it reads has been through `escapeLoneTags` (`Markdown.tsx`), which leaves text that
 * only looks like a tag (`Promise<void>`) as text.
 */
export function remarkPluginsFor(keep: readonly number[] | null): PluggableList {
  const plugins: PluggableList = [...MARKDOWN_SYNTAX, remarkBareLinks, remarkAlerts];
  if (keep) plugins.push([remarkSkimFade, { keep }]);
  plugins.push(remarkSeal);
  return plugins;
}

export const REMARK_PLUGINS = remarkPluginsFor(null);

/** remark-rehype's options: footnote ids carry a prefix a reply's own HTML can't know (`markdownSeal.ts`). */
export const REMARK_REHYPE_OPTIONS = { clobberPrefix: FOOTNOTE_PREFIX, footnoteLabelProperties: FOOTNOTE_LABEL_PROPERTIES };

/** The scheme of an address, as the sanitiser needs it: `HTTPS://` is `https://`. A single letter is a Windows drive and stays. */
function lowerScheme(value: string): string {
  return value.replace(/^\s*([A-Za-z][A-Za-z0-9+.-]+):/, (_all, scheme: string) => `${scheme.toLowerCase()}:`);
}

/** The sanitiser compares an address's protocol as written, so `HTTPS://example.com` would lose its link. */
function rehypeLowerSchemes() {
  const walk = (node: Root | Element) => {
    if (node.type === 'element') {
      for (const name of ['href', 'src', 'cite']) {
        const value = node.properties[name];
        if (typeof value === 'string') node.properties[name] = lowerScheme(value);
      }
    }
    for (const child of node.children) if (child.type === 'element') walk(child);
  };
  return (tree: Root) => walk(tree);
}

/**
 * Raw HTML in a reply (`<br>` in a table cell, `<details>`, `<kbd>`) is parsed and then sanitised (`chatSchema`) before anything
 * renders; the app's own marks are put back after it (`rehypeUnseal`). Anything that must not go through the sanitiser is
 * added after it.
 */
export const REHYPE_PLUGINS: PluggableList = [rehypeRaw, rehypeLowerSchemes, [rehypeSanitize, chatSchema], rehypeUnseal];

/**
 * Everything else that renders as Markdown (your prompts, plans, agent reports, mods) shows raw HTML as the text it is, as
 * before replies got it: a plan can't hide a step in a closed `<details>` or a comment. The seal's marks still need unsealing.
 */
export const PLAIN_REHYPE_PLUGINS: PluggableList = [rehypeUnseal];
