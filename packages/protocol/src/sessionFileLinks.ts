import { previewKind, type PreviewKind } from './filePreview.ts';

/**
 * Paths in a session on another computer (or on the phone) that open through Remote's `files.read` and `files.image`.
 * The paths name that computer's disk, so they are found in the text, never looked up here: the other computer decides
 * whether the session made the file. Plain TypeScript, shared by the app and the remote app.
 */

/** What a session's file opens as: a preview kind of `previewKind`, or an image. */
export type SessionFileKind = PreviewKind | 'image';

/** Lower-case extensions (with the dot) of the images `files.image` reads. */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

/** How a path opens, or null when it doesn't. SVG is code here: its text shows, a page never draws it. */
export function sessionFileKind(path: string): SessionFileKind | null {
  const kind = previewKind(path);
  if (kind) return kind;
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const dot = name.lastIndexOf('.');
  return dot >= 0 && IMAGE_EXTENSIONS.has(name.slice(dot).toLowerCase()) ? 'image' : null;
}

/** An absolute path in some text: where it starts and ends, and the path without a `:line` after it. */
export interface FoundPath {
  start: number;
  end: number;
  path: string;
}

/**
 * An absolute path of either platform (the other computer's may differ from this one's): `/…`, or a drive letter and a
 * backslash. It starts the text or follows a space or an opening bracket or quote, so `https://a/b.md` is not one.
 * Spaces end it.
 */
const ABSOLUTE = /(?<=^|[\s([{"'`])(?:\/|[A-Za-z]:\\)[^\s"'`<>()[\]{}|*?]+/g;
/** What a sentence puts after a path, and a `:12` or `:12-14` line. */
const TRAILING = /(?::\d+(?:-\d+)?)?[.,:;!?]*$/;

/** The absolute paths in `text` that open as a session's file (`sessionFileKind`), in order. */
export function findSessionFiles(text: string): FoundPath[] {
  const found: FoundPath[] = [];
  for (const match of text.matchAll(ABSOLUTE)) {
    const raw = match[0];
    const path = raw.replace(TRAILING, '');
    // The trailing part is left as text, so the link covers the path only.
    if (path.length > 1 && sessionFileKind(path)) found.push({ start: match.index, end: match.index + path.length, path });
  }
  return found;
}
