/**
 * Path checks shared by the engine, main and the renderer. Plain TypeScript without `node:path`, so the
 * renderer can use it, and independent of the platform it runs on, so tests on one OS cover the other.
 */

/** `C:\…` or `C:/…`: a path on a drive, as Windows writes absolute paths. */
const DRIVE_PATH = /^[A-Za-z]:[\\/]/;

/**
 * Whether `path` looks like an absolute local path on any platform: `/…`, or a drive path (`C:\…`, `C:/…`). A
 * network path (`\\server\share`) and anything relative (`src`, `~/…`, `C:folder`) don't. For telling a folder
 * from other values in the UI; what comes in from outside is checked with `isLocalAbsolutePath`.
 */
export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || DRIVE_PATH.test(path);
}

/**
 * An absolute path on `platform` itself: a drive path on Windows, `/…` elsewhere. Stricter than `isAbsolutePath`,
 * as `C:\x` on a Mac (or `/x` on Windows, which means the current drive) would be read relative to something.
 */
export function isLocalAbsolutePath(path: string, platform: string): boolean {
  return platform === 'win32' ? DRIVE_PATH.test(path) : path.startsWith('/');
}

/**
 * `path` without trailing separators, but never shorter than its root: `/`, `C:\` and `C:/` stay, as `C:` alone
 * means the current folder on that drive. Only drive paths lose trailing `\`; elsewhere it's part of a name.
 */
export function trimTrailingSeparators(path: string): string {
  if (DRIVE_PATH.test(path)) return path.slice(0, 3) + path.slice(3).replace(/[\\/]+$/, '');
  return path.replace(/(.)\/+$/, '$1');
}

/** The separator a path is written with: `\` for a Windows drive path, else `/`. */
export function separatorOf(path: string): '/' | '\\' {
  return DRIVE_PATH.test(path) && path.includes('\\') ? '\\' : '/';
}

/**
 * Whether `path` is the folder `dir` or inside it. Trailing separators don't count. Windows paths compare
 * without regard to case and to the kind of slash, as Windows itself does; others compare exactly.
 */
export function isSameOrInside(path: string, dir: string): boolean {
  const windows = DRIVE_PATH.test(dir);
  const norm = (p: string) => {
    const trimmed = p.replace(/[\\/]+$/, '');
    return windows ? trimmed.replace(/\//g, '\\').toLowerCase() : trimmed;
  };
  const base = norm(dir);
  const other = norm(path);
  return other === base || other.startsWith(base + (windows ? '\\' : '/'));
}

/**
 * The part of `path` inside the folder `root`, without a leading separator ('' for the folder itself), or null when
 * it isn't inside. Compared as `isSameOrInside` does; the part keeps the path's own separators.
 */
export function pathInside(path: string, root: string): string | null {
  if (!isSameOrInside(path, root)) return null;
  return path.slice(root.replace(/[\\/]+$/, '').length).replace(/^[\\/]+/, '');
}

/** `relative` (written with `/` or `\`) inside the folder `root`, in the root's own separator. */
export function joinPath(root: string, relative: string): string {
  const sep = separatorOf(root);
  const tail = relative.replace(/^[\\/]+/, '');
  return `${root.replace(/[\\/]+$/, '')}${sep}${sep === '\\' ? tail.replace(/\//g, '\\') : tail}`;
}

/** `~/…` (or `~\…`) with the home folder in front, in the home folder's own separator; anything else as it is. */
export function expandHome(path: string, home: string | null): string {
  if (!home || !/^~(?=[\\/]|$)/.test(path)) return path;
  const sep = separatorOf(home);
  return home + path.slice(1).replace(/[\\/]/g, sep);
}
