import { defaultSchema, type Options } from 'rehype-sanitize';

/**
 * What raw HTML in a previewed Markdown file may keep. The default schema (the one GitHub uses) with `file:` links and
 * images added, `language-*` as the only class on `code`, and the two marks the alerts carry. No `style`, no `on*`
 * handlers, no `script`, `iframe`, `object` or forms: the sanitiser drops them (and what is inside a `script`).
 */
export const previewSchema: Options = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), 'file'],
    src: [...(defaultSchema.protocols?.src ?? []), 'file'],
  },
  attributes: {
    ...defaultSchema.attributes,
    // Only a language class; every other class is dropped.
    code: [['className', /^language-[\w+#-]+$/]],
    blockquote: [...(defaultSchema.attributes?.blockquote ?? []), 'dataAlert'],
    p: [...(defaultSchema.attributes?.p ?? []), 'dataAlertTitle'],
  },
};
