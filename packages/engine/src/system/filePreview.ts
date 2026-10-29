import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLocalAbsolutePath, MAX_PREVIEW_BYTES, MAX_PREVIEW_IMAGE_BYTES, MAX_PREVIEW_PAGE_IMAGES_BYTES, previewKind, RpcError, type PreviewKind } from '@seshboard/protocol';

/** What `readPreview` returns (the result of `files.read`). */
export interface FilePreview {
  kind: PreviewKind;
  /** Bytes on disk. */
  size: number;
  /** The text, or null when the file is over `MAX_PREVIEW_BYTES`. HTML has the policy added and its local images inlined. */
  content: string | null;
  /** The file's mtime in ms. */
  modified: number;
}

/** What `readPreviewImage` returns (the result of `files.image`). */
export interface PreviewImage {
  mediaType: string;
  /** Base64. */
  data: string;
}

/**
 * The policy a previewed page runs under, on top of the iframe's empty sandbox: nothing loads from anywhere except
 * `data:` images and fonts (the images are inlined by `inlineHtmlImages`), and inline styles stay, as most saved pages need them.
 */
const PREVIEW_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">`;

/**
 * Puts the Content-Security-Policy meta at the very top of the page, after a doctype that starts it (before it, the
 * page would fall into quirks mode). The parser puts it in the head it makes there, before anything of the page's
 * own. Not after the page's `<head>`: a `<head>` inside a comment, a `<script>` or a `<title>` would take it out of
 * effect, and looking for one in a large file can take minutes.
 */
export function withPreviewCsp(html: string): string {
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  const at = doctype ? doctype[0].length : 0;
  return html.slice(0, at) + PREVIEW_CSP + html.slice(at);
}

/**
 * The `<img …>` tags of a page, in order: where each starts and its text up to the first `>`. A scan, not a regular
 * expression, so a page of `<img` without `>` takes as long as reading it, not minutes.
 */
export function imgTags(html: string): Array<{ index: number; text: string }> {
  const tags: Array<{ index: number; text: string }> = [];
  for (let from = 0; ; ) {
    const start = html.indexOf('<', from);
    if (start < 0) return tags;
    from = start + 1;
    // `<img` and then something that ends the name (`<image>` or `<img2>` is another tag).
    if (html.slice(start + 1, start + 4).toLowerCase() !== 'img' || /[\w]/.test(html[start + 4] ?? '')) continue;
    const end = html.indexOf('>', start + 4);
    // No tag closes after this one, so none of the later ones does either.
    if (end < 0) return tags;
    tags.push({ index: start, text: html.slice(start, end + 1) });
    from = end + 1;
  }
}

/** The type of an image from its first bytes, or null when it is none of the kinds a preview shows. SVG is text, so it must start like an SVG document. */
export function sniffImage(bytes: Uint8Array): string | null {
  const at = (offset: number, ...values: number[]) => values.every((v, i) => bytes[offset + i] === v);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x47, 0x49, 0x46, 0x38) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return 'image/gif';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  // Only the start is decoded; an SVG may begin with a BOM, whitespace and an XML declaration or a comment.
  const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 512)).replace(/^\uFEFF/, '').trimStart().toLowerCase();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return head.startsWith('<?xml') && !head.includes('<svg') ? null : 'image/svg+xml';
  return null;
}

/** Turns a Node error on `path` into the request's error: a missing file is NOT_FOUND, anything else is INTERNAL with the system's reason. */
function fsError(error: unknown, path: string): RpcError {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT' || code === 'ENOTDIR') return new RpcError('NOT_FOUND', `Not found: ${path}`);
  return new RpcError('INTERNAL', `Couldn't read ${path}: ${(error as Error)?.message ?? 'unknown error'}`);
}

/** Stats `path`, which must be a regular file. */
async function statFile(path: string) {
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    throw fsError(error, path);
  }
  if (!info.isFile()) throw new RpcError('UNSUPPORTED', `${path} is not a file`);
  return info;
}

/**
 * Reads a Markdown, HTML or code file for the preview. Only previewable extensions are read (this request must not become
 * a way to read any file). A file over `MAX_PREVIEW_BYTES` comes back without content, so the UI can say why.
 */
export async function readPreview(path: string): Promise<FilePreview> {
  const info = await statFile(path);
  const kind = previewKind(path);
  if (!kind) throw new RpcError('UNSUPPORTED', `Only Markdown, HTML and code files can be previewed: ${path}`);
  const base = { kind, size: info.size, modified: Math.floor(info.mtimeMs) };
  if (info.size > MAX_PREVIEW_BYTES) return { ...base, content: null };
  let text: string;
  try {
    // A byte order mark would show as a stray character at the start of the page.
    text = (await readFile(path, 'utf8')).replace(/^\uFEFF/, '');
  } catch (error) {
    throw fsError(error, path);
  }
  if (kind !== 'html') return { ...base, content: text };
  return { ...base, content: withPreviewCsp(await inlineHtmlImages(text, dirname(path))) };
}

/**
 * Reads an image a previewed file points at. The type comes from the file's first bytes, never its extension, so a
 * text file called `x.png` is refused.
 */
export async function readPreviewImage(path: string): Promise<PreviewImage> {
  const info = await statFile(path);
  if (info.size > MAX_PREVIEW_IMAGE_BYTES) throw new RpcError('TOO_LARGE', `${path} is larger than ${MAX_PREVIEW_IMAGE_BYTES / 1024 / 1024} MB`);
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    throw fsError(error, path);
  }
  const mediaType = sniffImage(bytes);
  if (!mediaType) throw new RpcError('UNSUPPORTED', `${path} is not a PNG, JPEG, GIF, WebP or SVG image`);
  return { mediaType, data: bytes.toString('base64') };
}

/**
 * The file a local `src` points at, or null for anything else (http, data:, a protocol-relative URL, an anchor, a
 * network path). On Windows, looking at `\\server\share\a.png` or `file://server/share/a.png` connects to that
 * server and sends it the user's Windows login, so only a path on this computer's drives is read.
 */
export function localImagePath(src: string, baseDir: string, platform: string = process.platform): string | null {
  const path = imagePath(src, baseDir);
  return path && isLocalAbsolutePath(path, platform) ? path : null;
}

function imagePath(src: string, baseDir: string): string | null {
  const value = src.trim();
  if (!value || value.startsWith('#') || value.startsWith('//')) return null;
  if (/^file:/i.test(value)) {
    try {
      return fileURLToPath(value);
    } catch {
      return null;
    }
  }
  // A drive path (C:\a.png) looks like a scheme, so test for paths before schemes.
  if (!isAbsolute(value) && /^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  const clean = value.replace(/[?#].*$/, '');
  let decoded = clean;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    // Not valid percent-encoding: use the text as it is.
  }
  return resolve(baseDir, decoded);
}

/**
 * Replaces the local `<img src>` of a page with `data:` URIs, so it shows in a frame that can load nothing else.
 * Relative paths are read from `baseDir`; absolute and `file:` paths as they are. An image is inlined only when its
 * first bytes say it is one, it is at most `MAX_PREVIEW_IMAGE_BYTES`, and the page's images stay under
 * `MAX_PREVIEW_PAGE_IMAGES_BYTES` together. Anything else is left as written (and won't load).
 */
export async function inlineHtmlImages(html: string, baseDir: string): Promise<string> {
  const tags = imgTags(html);
  if (!tags.length) return html;
  // Each file is read once; every tag that uses it counts against the page's total, so one large image named a
  // thousand times can't make a page of gigabytes.
  const cache = new Map<string, { uri: string; size: number } | null>();
  let budget = MAX_PREVIEW_PAGE_IMAGES_BYTES;
  const load = async (path: string): Promise<{ uri: string; size: number } | null> => {
    if (cache.has(path)) return cache.get(path) ?? null;
    let image: { uri: string; size: number } | null = null;
    try {
      const info = await stat(path);
      if (info.isFile() && info.size <= MAX_PREVIEW_IMAGE_BYTES && info.size <= budget) {
        const bytes = await readFile(path);
        const mediaType = sniffImage(bytes);
        if (mediaType) image = { uri: `data:${mediaType};base64,${bytes.toString('base64')}`, size: bytes.length };
      }
    } catch {
      // Missing or unreadable: leave the tag alone.
    }
    cache.set(path, image);
    return image;
  };
  let out = '';
  let last = 0;
  for (const tag of tags) {
    const src = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(tag.text);
    const value = src?.[1] ?? src?.[2] ?? src?.[3];
    const path = value === undefined ? null : localImagePath(value, baseDir);
    const image = path ? await load(path) : null;
    if (!src || !image || image.size > budget) continue;
    budget -= image.size;
    const start = tag.index + src.index;
    out += html.slice(last, start) + ` src="${image.uri}"`;
    last = start + src[0].length;
  }
  return out + html.slice(last);
}
