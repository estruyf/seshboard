import { isAbsolutePath, joinPath } from '@seshboard/protocol/client';

/**
 * The absolute path a link or image in a previewed file points at, or null when it isn't a local file (http(s),
 * `data:`, `mailto:`, an `#anchor`, an empty value). `./a.png`, `../a.png` and `a.png` are read from `baseDir`, the
 * file's folder; `/abs` and `file:///abs` are taken as they are; `file:///C:/x` is `C:/x`. A `?query` or `#fragment` is
 * cut off. A relative result uses the separator of `baseDir` (`C:\…` stays `\`), and `..` never climbs above the root.
 */
export function resolveRelative(href: string | undefined, baseDir: string): string | null {
  if (!href) return null;
  const value = href.trim();
  // `//host/x` and `\\host\x` are a share (or another site), never a path of this file's folder.
  if (!value || value.startsWith('#') || /^[\\/]{2}/.test(value)) return null;
  let path = value.replace(/[?#].*$/, '');
  if (/^file:/i.test(path)) path = path.replace(/^file:(\/\/)?/i, '').replace(/^\/(?=[A-Za-z]:[\\/])/, '');
  else if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[A-Za-z]:[\\/]/.test(path)) return null;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Not valid percent-encoding: take it as written.
  }
  if (!path) return null;
  if (isAbsolutePath(path)) return path;
  const root = /^[A-Za-z]:[\\/]/.test(baseDir) ? baseDir.slice(0, 3) : '/';
  const resolved: string[] = [];
  for (const part of [...baseDir.slice(root.length).split(/[\\/]/), ...path.split(/[\\/]/)]) {
    if (part === '' || part === '.') continue;
    if (part === '..') resolved.pop();
    else resolved.push(part);
  }
  return resolved.length === 0 ? null : joinPath(root, resolved.join('/'));
}
