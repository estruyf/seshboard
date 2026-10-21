import type { PluggableList } from 'unified';
import { defaultUrlTransform } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { remarkAlerts } from './remarkAlerts.ts';
import { previewSchema } from './sanitizeSchema.ts';

/** Markdown in a previewed file: GitHub's flavour and alerts, then raw HTML, which is sanitised before anything renders. */
export const FILE_REMARK_PLUGINS: PluggableList = [remarkGfm, remarkAlerts];
export const FILE_REHYPE_PLUGINS: PluggableList = [rehypeRaw, [rehypeSanitize, previewSchema]];

/** react-markdown drops links with an unknown protocol; `file:` is fine here (it becomes a file link, never a raw navigation). */
export const fileUrlTransform = (url: string): string => (/^file:/i.test(url) ? url : defaultUrlTransform(url));
