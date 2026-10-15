import { constants } from 'node:fs';
import { access, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import type { FolderEntry } from '@switchboard/protocol';
import { branchOf, ownGitDir } from '../claude/projectResolver.ts';
import { HOME_SKIP_DIRS } from './files.ts';

/** The most folders one listing returns. */
export const MAX_FOLDERS = 50;

/** `~`, `~/…` (and `~\…` on Windows) in the home folder; anything else as it is. */
export function expandHome(path: string, home: string, separator = sep): string {
  if (path === '~') return home;
  if (path.startsWith('~/') || (separator === '\\' && path.startsWith('~\\'))) return join(home, path.slice(2));
  return path;
}

const isFolder = (path: string) => stat(path).then((s) => s.isDirectory(), () => false);
const readable = (path: string) => access(path, constants.R_OK | constants.X_OK).then(() => true, () => false);

/**
 * A folder and the folders in it whose name starts with `prefix` (ignoring case), for typing a path in New session.
 * Sorted by name and capped at `MAX_FOLDERS`. Hidden folders only show when `prefix` starts with a dot. Folders
 * that can't be read are left out, and a path that isn't a folder lists nothing: never an error. In the home folder,
 * the folders macOS guards with a privacy prompt are listed without looking inside them (no git check), so typing
 * `~/` never asks for access.
 */
export async function listFolders(path: string, prefix: string, home = homedir()): Promise<{ here: FolderEntry | null; folders: FolderEntry[] }> {
  const dir = expandHome(path.trim(), home);
  if (!isAbsolute(dir)) return { here: null, folders: [] };
  // Without a trailing separator (`~/dev/` lists `~/dev`), so `here` is the folder's own path; a root stays `/` or `C:\`.
  const root = resolve(dir);
  if (!(await isFolder(root))) return { here: null, folders: [] };
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return { here: entry(root, basename(root) || root, false), folders: [] };
  }
  const wanted = prefix.toLowerCase();
  const showHidden = prefix.startsWith('.');
  const inHome = resolve(home) === root;
  const names = entries
    .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && (showHidden || !e.name.startsWith('.')) && e.name.toLowerCase().startsWith(wanted))
    .map((e) => ({ name: e.name, link: e.isSymbolicLink() }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.name.localeCompare(b.name));

  const folders: FolderEntry[] = [];
  for (const { name, link } of names) {
    if (folders.length >= MAX_FOLDERS) break;
    const full = join(root, name);
    const guarded = inHome && HOME_SKIP_DIRS.has(name);
    // A link counts only when it points at a folder; a folder counts only when it can be opened.
    if (link && !(await isFolder(full))) continue;
    if (!guarded && !(await readable(full))) continue;
    folders.push(entry(full, name, !guarded));
  }
  return { here: entry(root, basename(root) || root, true), folders };
}

function entry(path: string, name: string, checkGit: boolean): FolderEntry {
  const gitDir = checkGit ? ownGitDir(path) : null;
  return { name, path, isGit: gitDir !== null, branch: gitDir ? branchOf(gitDir) : null };
}
