/** A file a reply points at: the path as written, and the line to open it at. */
export interface FileRef {
  path: string;
  line?: number;
}

/** `:69`, `:69:5`, `:69-80`, or GitHub's `#L69`, `#L69C5`, `#L69-L80` after a path. */
const LINE_SUFFIX = /(?::(\d+)(?:[:-]\d+)*|#L(\d+)(?:C\d+)?(?:-L?\d+(?:C\d+)?)?)$/;
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
  const line = suffix ? Number(suffix[1] ?? suffix[2]) : 0;
  if (suffix) value = value.slice(0, suffix.index);
  const drive = DRIVE.exec(value)?.[0] ?? '';
  const rest = value.slice(drive.length);
  if (!value || !PATH_CHARS.test(rest) || /^\.+$/.test(value) || /^[\\/]+$/.test(value)) return null;
  const base = value.slice(Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\')) + 1);
  if (!/[\\/]/.test(value) && !EXTENSION.test(base)) return null;
  return line > 0 ? { path: value, line } : { path: value };
}

/**
 * A local path as a `file:` link: `/a b.ts` is `file:///a%20b.ts`, `C:\a.ts` is `file:///C:/a.ts`. `?` and `#` are
 * escaped too (`encodeURI` leaves them), as in a file name they would start a query or a fragment.
 */
export function fileUrl(path: string): string {
  const drive = /^[A-Za-z]:[\\/]/.test(path);
  return `file://${encodeURI(drive ? `/${path.replace(/\\/g, '/')}` : path).replace(/\?/g, '%3F').replace(/#/g, '%23')}`;
}

/** The file a Markdown link points at (`[a.ts](src/a.ts#L69)`, `file:///…`), or null for web and mail links. */
export function fileRefFromHref(href: string | undefined): FileRef | null {
  if (!href || /^(https?|mailto):/i.test(href)) return null;
  let value = href.replace(/^file:\/\//i, '');
  try {
    value = decodeURI(value);
  } catch {
    return null;
  }
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
