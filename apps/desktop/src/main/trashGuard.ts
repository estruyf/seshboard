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
 * A file a "revert" may move to the Trash: a regular file inside a git checkout
 * (one with a `.git` entry at its root), never the root itself or anything in a `.git` folder,
 * the checkout's or a nested one's. Symlinked folders are resolved first, so a link can't lead outside.
 */
export function isTrashableRepoFile(path: string, repoRoot: string): boolean {
  if (resolve(path) !== path || resolve(repoRoot) !== repoRoot) return false;
  if (!path.startsWith(repoRoot + sep) || hasGitSegment(path.slice(repoRoot.length + 1))) return false;
  try {
    if (!statSync(join(repoRoot, '.git'), { throwIfNoEntry: false })) return false;
    // The file itself may be a symlink (it's the link that goes to the Trash), but the folders above it must
    // really be inside the checkout.
    const realRoot = realpathSync(repoRoot);
    const realPath = join(realpathSync(dirname(path)), basename(path));
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

/**
 * A memory file (shared with the team and taken out of memory): a `.md` file, not the `MEMORY.md` index, directly
 * inside a memory folder (one named `memory`, or holding a `MEMORY.md`), and a regular file, not a link.
 */
export function isTrashableMemoryFile(path: string, memoryDir: string): boolean {
  if (resolve(path) !== path || resolve(memoryDir) !== memoryDir || memoryDir === sep) return false;
  const name = basename(path);
  if (dirname(path) !== memoryDir || !name.endsWith('.md') || name === 'MEMORY.md') return false;
  try {
    if (basename(memoryDir) !== 'memory' && !statSync(join(memoryDir, 'MEMORY.md'), { throwIfNoEntry: false })?.isFile()) return false;
    return lstatSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
  } catch {
    return false;
  }
}

/** The project instruction files a share can create, so undoing it may remove them again. */
const INSTRUCTION_FILE = /^(?:CLAUDE\.md|CLAUDE\.local\.md|\.claude\/CLAUDE\.md|\.claude\/rules\/(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.md)$/;

/**
 * An instruction file a share made (undoing it): CLAUDE.md, CLAUDE.local.md, .claude/CLAUDE.md or a rule in
 * .claude/rules/, inside the project once its folders are resolved, and a regular file.
 */
export function isTrashableInstructionFile(path: string, projectRoot: string): boolean {
  if (resolve(path) !== path || resolve(projectRoot) !== projectRoot || projectRoot === sep) return false;
  if (!path.startsWith(projectRoot + sep) || !INSTRUCTION_FILE.test(path.slice(projectRoot.length + 1).split(sep).join('/'))) return false;
  try {
    const realRoot = realpathSync(projectRoot);
    const realPath = join(realpathSync(dirname(path)), basename(path));
    if (!realPath.startsWith(realRoot + sep)) return false;
    return lstatSync(realPath, { throwIfNoEntry: false })?.isFile() ?? false;
  } catch {
    return false;
  }
}
