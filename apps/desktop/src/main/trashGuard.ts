import { lstatSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.jsonl)?$/i;

/**
 * Only Claude Code session files may go to the Trash: a transcript
 * (`<uuid>.jsonl`) or its subagent folder (`<uuid>`) inside the projects folder.
 * A second guard behind the engine's own checks.
 */
export function isTrashableSessionPath(path: string, claudeConfigDir: string): boolean {
  const projects = join(claudeConfigDir, 'projects') + sep;
  return resolve(path) === path && path.startsWith(projects) && SESSION_ID.test(basename(path));
}

/** A Claude Code config folder named by the engine: an absolute, normalised path with a projects folder. */
export function isConfigDir(dir: unknown): dir is string {
  if (typeof dir !== 'string' || resolve(dir) !== dir || dir === sep) return false;
  try {
    return statSync(join(dir, 'projects'), { throwIfNoEntry: false })?.isDirectory() ?? false;
  } catch {
    // ENOTDIR, EACCES, ELOOP: not a folder we can use.
    return false;
  }
}

/** A `.git` folder anywhere in the path, in any case (APFS is case-insensitive, so `.GIT` is the same folder). */
const hasGitSegment = (relative: string) => relative.split(sep).some((segment) => segment.toLowerCase() === '.git');

/**
 * Folders by their real names. On Windows that is the native call: Node's own keeps a short 8.3 name such as
 * `GIT~1` as written, which would hide a `.git` folder from `hasGitSegment`.
 */
const realFolder = (path: string, platform: string) => (platform === 'win32' ? realpathSync.native(path) : realpathSync(path));

/**
 * A file a "revert" may move to the Trash: a regular file inside a git checkout
 * (one with a `.git` entry at its root), never the root itself or anything in a `.git` folder,
 * the checkout's or a nested one's. Symlinked folders are resolved first, so a link can't lead outside.
 */
export function isTrashableRepoFile(path: string, repoRoot: string, platform: string = process.platform): boolean {
  if (resolve(path) !== path || resolve(repoRoot) !== repoRoot) return false;
  if (!path.startsWith(repoRoot + sep) || hasGitSegment(path.slice(repoRoot.length + 1))) return false;
  // On Windows a colon after the drive names an NTFS stream (`.git::$INDEX_ALLOCATION` is the `.git` folder), never a file.
  if (platform === 'win32' && path.slice(2).includes(':')) return false;
  try {
    if (!statSync(join(repoRoot, '.git'), { throwIfNoEntry: false })) return false;
    // The file itself may be a symlink (it's the link that goes to the Trash), but the folders above it must
    // really be inside the checkout.
    const realRoot = realFolder(repoRoot, platform);
    const realPath = join(realFolder(dirname(path), platform), basename(path));
    if (!realPath.startsWith(realRoot + sep) || hasGitSegment(realPath.slice(realRoot.length + 1))) return false;
    const stat = lstatSync(realPath, { throwIfNoEntry: false });
    return !!stat && (stat.isFile() || stat.isSymbolicLink());
  } catch {
    // A missing parent, ENOTDIR, EACCES or a symlink loop: refuse rather than fail the request.
    return false;
  }
}

/** An imported theme's file: a `.json` file directly inside the themes folder, never the folder itself or anything through a link. */
export function isTrashableThemeFile(path: string, themesDir: string): boolean {
  if (resolve(path) !== path || resolve(themesDir) !== themesDir) return false;
  if (dirname(path) !== themesDir || !/^[a-z0-9][a-z0-9-]*\.json$/.test(basename(path))) return false;
  try {
    return lstatSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
  } catch {
    return false;
  }
}
