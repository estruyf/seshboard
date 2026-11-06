import { defaultUrlTransform } from 'react-markdown';

/** A file a reply points at: the path as written, the line to open it at, and the last line of a range (`a.ts:10-14`). */
export interface FileRef {
  path: string;
  line?: number;
  /** Only after `line`, and only when it is past it. */
  endLine?: number;
}

/** `:69`, `:69:5`, `:69-80`, or GitHub's `#L69`, `#L69C5`, `#L69-L80` after a path. Groups: the line and the range's end, for each form. */
const LINE_SUFFIX = /(?::(\d+)(?::\d+)?(?:-(\d+)(?::\d+)?)?(?:[:-]\d+)*|#L(\d+)(?:C\d+)?(?:-L?(\d+)(?:C\d+)?)?)$/;
/** What a path may be made of: `/` and, for Windows paths, `\` between the parts. */
const PATH_CHARS = /^[\p{L}\p{N}_~./\\@+-]+$/u;
/** `C:\` or `C:/` at the start: a Windows drive path, whose colon is not a line number. */
const DRIVE = /^[A-Za-z]:[\\/]/;
/** A file name ending: `.ts`, `.xml`, `.gitignore`, but not the `.1` of a version number. */
const EXTENSION = /\.(?=[\p{N}_-]*\p{L})[\p{L}\p{N}_-]{1,12}$/u;

/**
 * The file that inline code in a reply names (`src/a.ts`, `src/a.ts:69`, `~/notes.md`, `Root.xml`),
 * or null when it doesn't look like a path. Only the shape is checked: whether the file exists is
 * the engine's to say, so `item.Description` passes here and is dropped there.
 */
export function parseFileRef(text: string): FileRef | null {
  let value = text.trim();
  if (!value || value.length > 1024 || /\s/.test(value)) return null;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) return null;
  const suffix = LINE_SUFFIX.exec(value);
  const line = suffix ? Number(suffix[1] ?? suffix[3]) : 0;
  const endLine = suffix ? Number(suffix[2] ?? suffix[4] ?? 0) : 0;
  if (suffix) value = value.slice(0, suffix.index);
  const drive = DRIVE.exec(value)?.[0] ?? '';
  const rest = value.slice(drive.length);
  if (!value || !PATH_CHARS.test(rest) || /^\.+$/.test(value) || /^[\\/]+$/.test(value)) return null;
  const base = value.slice(Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\')) + 1);
  if (!/[\\/]/.test(value) && !EXTENSION.test(base)) return null;
  if (line <= 0) return { path: value };
  return endLine > line ? { path: value, line, endLine } : { path: value, line };
}

/**
 * A local path as a `file:` link: `/a b.ts` is `file:///a%20b.ts`, `C:\a.ts` is `file:///C:/a.ts`. `?` and `#` are
 * escaped too (`encodeURI` leaves them), as in a file name they would start a query or a fragment.
 */
export function fileUrl(path: string): string {
  const drive = /^[A-Za-z]:[\\/]/.test(path);
  return `file://${encodeURI(drive ? `/${path.replace(/\\/g, '/')}` : path).replace(/\?/g, '%3F').replace(/#/g, '%23')}`;
}

/** A `file:` URL on this computer: `file:///…` or `file://localhost/…`, never a share (`file://server/…`, `file:////server/…`). */
const LOCAL_FILE = /^file:\/\/(localhost)?\/(?![\\/])/i;

/**
 * The `urlTransform` of the Markdown in replies and previewed files. react-markdown's default empties every link whose
 * protocol it doesn't know: `file:///…`, and on Windows a drive path too (`C:/a.ts` reads as the protocol `C:`). Such a
 * link points nowhere and a click does nothing, so a link (`href`) to a file on this computer is kept, to become a file
 * link; everything else gets the default. Images keep the default: a `file:` picture would load without a click, and on
 * Windows one on a share connects to that server. A kept link is never followed as it is: a file link opens through the
 * engine, on a click, and the main process refuses to open any window that isn't http(s).
 */
export function fileUrlTransform(url: string, key?: string): string {
  return key === 'href' && (LOCAL_FILE.test(url) || DRIVE.test(url)) ? url : defaultUrlTransform(url);
}

/**
 * The file a Markdown link points at (`[a.ts](src/a.ts#L69)`, `file:///…`, `C:/a.ts`), or null for web and mail links
 * and for a `file:` link to another computer (`file://server/share/a.ts`).
 */
export function fileRefFromHref(href: string | undefined): FileRef | null {
  if (!href || /^(https?|mailto):/i.test(href)) return null;
  if (/^file:/i.test(href) && !LOCAL_FILE.test(href)) return null;
  let value = href.replace(/^file:\/\/(localhost)?/i, '');
  try {
    value = decodeURI(value);
  } catch {
    return null;
  }
  // A share (`//server/…`, `\\server\…`, also when written as `%5C%5C`): looking it up would connect to that server.
  if (/^[\\/]{2}/.test(value)) return null;
  // `file:///C:/a.ts` is the path `C:/a.ts`, not `/C:/a.ts`.
  return parseFileRef(value.replace(/^\/(?=[A-Za-z]:[\\/])/, ''));
}

/** Looks up whether paths exist, many at a time, and remembers the answers. */
export interface PathResolver {
  /** The absolute path, null when there is no such file, undefined when not known yet. */
  peek(path: string): string | null | undefined;
  resolve(path: string): Promise<string | null>;
}

/** The most answers kept; a long session mentions far fewer paths than this. */
const MAX_KNOWN = 5_000;

/**
 * A resolver that collects the paths asked for within `batchMs` and looks them up in one call (up to
 * `batchSize` per call). A failed lookup answers null without remembering it, so the path is asked
 * again the next time it renders.
 */
export function createPathResolver(lookup: (paths: string[]) => Promise<Array<string | null>>, { batchMs = 30, batchSize = 100 } = {}): PathResolver {
  const known = new Map<string, string | null>();
  const waiting = new Map<string, Array<(path: string | null) => void>>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    const batch = [...waiting.entries()];
    waiting.clear();
    for (let i = 0; i < batch.length; i += batchSize) {
      const chunk = batch.slice(i, i + batchSize);
      lookup(chunk.map(([path]) => path)).then(
        (results) =>
          chunk.forEach(([path, callbacks], j) => {
            const result = results[j] ?? null;
            if (known.size >= MAX_KNOWN) known.clear();
            known.set(path, result);
            callbacks.forEach((callback) => callback(result));
          }),
        () => chunk.forEach(([, callbacks]) => callbacks.forEach((callback) => callback(null))),
      );
    }
  };

  return {
    peek: (path) => known.get(path),
    resolve(path) {
      const hit = known.get(path);
      if (hit !== undefined) return Promise.resolve(hit);
      return new Promise((resolve) => {
        const callbacks = waiting.get(path);
        if (callbacks) callbacks.push(resolve);
        else waiting.set(path, [resolve]);
        timer ??= setTimeout(flush, batchMs);
      });
    },
  };
}
