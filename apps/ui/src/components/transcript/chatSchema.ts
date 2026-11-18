import type { Options } from 'rehype-sanitize';
import { previewSchema } from '../filePreview/sanitizeSchema.ts';
import { FOOTNOTE_PREFIX, SEAL } from './markdownSeal.ts';

/**
 * What a reply's HTML may not set on any element: the keyboard (`tabindex`, `accesskey`), forms, the `id`s of the page (only footnotes'
 * are kept, below), `aria-labelledby` (it names an element by its `id`) and the preview's alert marks, which are the app's to set.
 */
const NOT_IN_A_REPLY = new Set(['id', 'tabIndex', 'accessKey', 'action', 'method', 'encType', 'ariaLabelledBy', 'dataAlert', 'dataAlertTitle', 'dataSkimFaded']);

const allowed = (attributes: NonNullable<Options['attributes']>): NonNullable<Options['attributes']> =>
  Object.fromEntries(Object.entries(attributes).map(([tag, list]) => [tag, list.filter((attribute) => typeof attribute !== 'string' || !NOT_IN_A_REPLY.has(attribute))]));

const attributes = allowed(previewSchema.attributes ?? {});

/**
 * What raw HTML in a reply may keep: the file preview's schema (the default one, as GitHub uses it), so `<br>`, `<details>`,
 * `<kbd>`, `<sub>` and `<sup>` render, and `script`, `style`, `iframe`, `picture`, forms and `on*` handlers never do.
 * `code` keeps the preview's classes (`language-*`, and whatever it adds for maths).
 *
 * The app's own marks (`markdownSeal.ts`) are not in it, so a reply can't forge an alert or a faded sentence: they pass as
 * one sealed `data-seal`. The same for footnote ids, which start with a prefix a reply can't know.
 *
 * Differences from the preview's: no `file:` source for images (a reply never loads one; `fileUrlTransform` drops anything
 * but `http(s)` too), no `id`, `tabindex`, `accesskey`, `action`, `method` or `enctype`, and a single letter as a link's
 * protocol, since `fileUrlTransform` keeps a link to a Windows drive path (`C:/a.ts`) for the file link. The sanitiser
 * compares protocols as written, so a link's is lower-cased first (`chatPlugins.ts`), except a letter's.
 */
export const chatSchema: Options = {
  ...previewSchema,
  protocols: {
    ...previewSchema.protocols,
    src: ['http', 'https'],
    href: [...(previewSchema.protocols?.href ?? []), ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'],
  },
  // A reply's `name` is prefixed, so it can't take the one a script of the app looks up. Footnotes' `aria-describedby` points at
  // their label, so it stays as it is.
  clobber: ['name'],
  attributes: {
    ...attributes,
    '*': [
      ...(attributes['*'] ?? []),
      ['id', new RegExp(`^${FOOTNOTE_PREFIX}`)],
      ['dataSeal', new RegExp(`^${SEAL}:`)],
    ],
  },
};
