import type { Options } from 'rehype-sanitize';
import { previewSchema } from '../filePreview/sanitizeSchema.ts';

/**
 * What raw HTML in a reply may keep: the file preview's schema (the default one, as GitHub uses it, with the alert marks), so
 * `<br>`, `<details>`, `<kbd>`, `<sub>` and `<sup>` render, and `script`, `iframe`, forms, `style` and `on*` handlers never do.
 * The sanitiser also sees what the renderer's own plugins made, so the marks they set stay: Skim's faded sentences (a
 * `text-faint` span with `data-skim-faded`, `skimFade.ts`).
 *
 * Differences from the preview's: no `file:` source for images (a reply never loads one; `fileUrlTransform` drops it too), and a
 * single letter as a link's protocol, since `fileUrlTransform` keeps a link to a Windows drive path (`C:/a.ts`) for the file link.
 */
export const chatSchema: Options = {
  ...previewSchema,
  protocols: {
    ...previewSchema.protocols,
    src: ['http', 'https'],
    href: [...(previewSchema.protocols?.href ?? []), ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'],
  },
  // Footnotes already carry the `user-content-` prefix (remark-rehype adds it), and the sanitiser's own would make it twice and
  // break their links. So an `id` is kept only with the prefix (or as the footnotes' label), and `name` is prefixed as before:
  // an `id` in someone's HTML can't take a name the app's own scripts look up.
  clobber: ['name'],
  attributes: {
    ...previewSchema.attributes,
    '*': [...(previewSchema.attributes?.['*'] ?? []).filter((attribute) => attribute !== 'id'), ['id', /^(?:user-content-|footnote-label$)/]],
    span: [['className', 'text-faint'], 'dataSkimFaded'],
  },
};
