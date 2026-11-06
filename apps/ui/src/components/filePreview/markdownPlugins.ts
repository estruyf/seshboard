import type { PluggableList } from 'unified';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { remarkAlerts } from './remarkAlerts.ts';
import { fileUrlTransform as linkTransform } from '../transcript/fileRefs.ts';
import { previewSchema } from './sanitizeSchema.ts';

/** Markdown in a previewed file: GitHub's flavour and alerts, then raw HTML, which is sanitised before anything renders. */
export const FILE_REMARK_PLUGINS: PluggableList = [remarkGfm, remarkAlerts];
export const FILE_REHYPE_PLUGINS: PluggableList = [rehypeRaw, [rehypeSanitize, previewSchema]];

/**
 * Links as in the replies (`fileUrlTransform` in fileRefs.ts). A picture may also be a local `file:` or a drive path here:
 * the preview reads it through the engine (`files.image`), the page never loads it.
 */
export const fileUrlTransform = (url: string, key?: string): string => linkTransform(url, key === 'src' ? 'href' : key);
