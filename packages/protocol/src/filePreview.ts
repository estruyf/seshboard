/**
 * Which files Switchboard previews in its own window, and the size limits of a preview. Shared by the engine (which
 * reads them) and the renderer (which decides what a click on a file link does). Plain TypeScript, no `node:path`.
 */

/** What a previewable file is, which decides how it is shown. */
export type PreviewKind = 'markdown' | 'html';

/** Lower-case extensions (with the dot) that can be previewed, and what each is. */
export const PREVIEW_EXTENSIONS: Readonly<Record<string, PreviewKind>> = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.html': 'html',
  '.htm': 'html',
};

/** The most text of a file a preview reads (2 MB). A bigger file is reported with its size and no content. */
export const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
/** The largest image a preview loads (10 MB). */
export const MAX_PREVIEW_IMAGE_BYTES = 10 * 1024 * 1024;
/** The most image data inlined into one HTML page (25 MB), so a page with many pictures can't grow without bound. */
export const MAX_PREVIEW_PAGE_IMAGES_BYTES = 25 * 1024 * 1024;

/**
 * What kind of preview a path gets, or null when it isn't previewable. Goes by the extension of the last path
 * segment (either separator, so Windows paths work on any platform), case-insensitive.
 */
export function previewKind(path: string): PreviewKind | null {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  // Own-property lookup only: a file named "x.constructor" must not hit Object.prototype.
  const ext = name.slice(dot).toLowerCase();
  return Object.hasOwn(PREVIEW_EXTENSIONS, ext) ? PREVIEW_EXTENSIONS[ext]! : null;
}
