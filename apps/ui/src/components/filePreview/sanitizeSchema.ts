import { defaultSchema, type Options } from 'rehype-sanitize';

/**
 * What raw HTML in a previewed Markdown file may keep. The default schema (the one GitHub uses) with `file:` links and
 * images added, `language-*` as the only class on `code`, and the two marks the alerts carry. No `style`, no `on*`
 * handlers, no `script`, `iframe`, `object` or forms: the sanitiser drops them (and what is inside a `script`, `style`,
 * `title` or `textarea`). No `picture` or `source` either: a `srcset` has no protocol rule here, and the page's CSP is
 * not what keeps a `file://` or share address from being fetched.
 */
export const previewSchema: Options = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter((name) => name !== 'picture' && name !== 'source'),
  strip: [...(defaultSchema.strip ?? []), 'style', 'title', 'textarea'],
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), 'file'],
    src: [...(defaultSchema.protocols?.src ?? []), 'file'],
  },
  attributes: {
    ...defaultSchema.attributes,
    source: [],
    // Only a language class; every other class is dropped.
    code: [['className', /^language-[\w+#.-]+$/]],
    blockquote: [...(defaultSchema.attributes?.blockquote ?? []), 'dataAlert'],
    p: [...(defaultSchema.attributes?.p ?? []), 'dataAlertTitle'],
  },
};
