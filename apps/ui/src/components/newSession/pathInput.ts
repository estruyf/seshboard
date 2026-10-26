import type { FolderEntry, ProjectInfo } from '@switchboard/protocol/client';
import { knownFolders } from '../../state/projectList.ts';

/**
 * What New session's filter field holds is a path, not a project's name: it starts with `~/` or `/`, or on
 * Windows with `~\` or a drive (`C:\`, `C:/`). The platform is a parameter so both run in tests anywhere.
 */
export function isPathInput(text: string, platform: string): boolean {
  if (text.startsWith('~/')) return true;
  if (platform === 'win32') return text.startsWith('~\\') || /^[A-Za-z]:[\\/]/.test(text);
  return text.startsWith('/');
}

const separatorAt = (text: string, index: number, platform: string) => text[index] === '/' || (platform === 'win32' && text[index] === '\\');

/** A typed path split at its last separator: the folder to list (with the separator) and the start of a name in it. */
export function splitPathInput(text: string, platform: string): { dir: string; prefix: string } {
  for (let i = text.length - 1; i >= 0; i--) {
    if (separatorAt(text, i, platform)) return { dir: text.slice(0, i + 1), prefix: text.slice(i + 1) };
  }
  return { dir: text, prefix: '' };
}

/** `name` starts with the typed prefix, ignoring case (folder names on macOS and Windows ignore it too). */
export const startsWithTyped = (name: string, prefix: string) => name.toLowerCase().startsWith(prefix.toLowerCase());

/** The rest of `name` after what was typed, shown faint after the caret; empty when it doesn't continue the text. */
export function ghostText(text: string, name: string | undefined, platform: string): string {
  if (!name) return '';
  const { prefix } = splitPathInput(text, platform);
  return startsWithTyped(name, prefix) && name.length > prefix.length ? name.slice(prefix.length) : '';
}

/**
 * Tab in path mode: the typed name becomes the highlighted folder's name (in its own case). Once it is that
 * folder exactly, a separator goes after it, so the next Tab works inside it. Null when there is nothing to do.
 */
export function completePath(text: string, name: string | undefined, platform: string): string | null {
  if (!name) return null;
  const { dir, prefix } = splitPathInput(text, platform);
  if (!startsWithTyped(name, prefix)) return null;
  if (prefix.length === name.length) {
    // The separator the path already uses: a Windows path typed with `/` keeps `/`.
    const separator = dir.endsWith('\\') ? '\\' : '/';
    return `${dir}${name}${separator}`;
  }
  return `${dir}${name}`;
}

/**
 * The rows under a typed path: the folder itself first when the text ends with a separator (so ↩ on `~/dev/` picks
 * `dev`), then the folders in it that continue the name, an exact match first. Results that came back for an earlier
 * text are filtered again, so a slow answer never shows folders that no longer match. At most `limit` rows.
 */
export function pathRows(here: FolderEntry | null, folders: readonly FolderEntry[], prefix: string, limit = 6): FolderEntry[] {
  const matching = folders.filter((f) => startsWithTyped(f.name, prefix));
  const exact = matching.findIndex((f) => f.name.toLowerCase() === prefix.toLowerCase());
  if (exact > 0) matching.unshift(...matching.splice(exact, 1));
  return [...(here && prefix === '' ? [here] : []), ...matching].slice(0, limit);
}

/**
 * When a name matches none of your projects: the folders Claude Code already has sessions for that aren't projects
 * yet, best match first, so one ↩ adds it. Folders that are gone are left out.
 */
export function knownFolderRows(projects: Map<string, ProjectInfo>, filter: string, home: string | null, limit = 6): ProjectInfo[] {
  if (!filter.trim()) return [];
  return knownFolders(projects, filter, home)
    .filter((p) => !p.added && p.exists !== false)
    .slice(0, limit);
}

/** What ↩ on a folder does: a project already is picked, anything else is added first. */
export const addOrSelect = (path: string, projects: Map<string, ProjectInfo>): 'select' | 'add' => (projects.get(path)?.added ? 'select' : 'add');

/**
 * What follows the short project list. With more projects than it shows, "All N projects…" opens the full list. With
 * fewer there is nothing: Add project… in the header is enough. With no projects at all, one wide "Add project…" row.
 */
export function listEnd(projectCount: number, quickCount: number, hidden: number): { kind: 'more'; count: number } | { kind: 'choose' } | null {
  if (hidden > 0) return { kind: 'more', count: hidden };
  return projectCount === 0 && quickCount === 0 ? { kind: 'choose' } : null;
}
