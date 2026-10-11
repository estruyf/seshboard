import { dirname } from 'node:path';
import { detectEol, isSameOrInside } from '@switchboard/protocol';

/** The marked block Switchboard owns in a profile's CLAUDE.md; nothing outside it is ever changed. */
export const BLOCK_START = '<!-- switchboard:memory start -->';
export const BLOCK_END = '<!-- switchboard:memory end -->';

/**
 * A path with `/` between its parts. Claude Code reads `/` on Windows too, and there a `\` would be ambiguous next to
 * the `\ ` that escapes a space. Only a Windows drive path changes: elsewhere `\` can be part of a name.
 */
const forwardSlashes = (path: string) => (/^[A-Za-z]:[\\/]/.test(path) ? path.replace(/\\/g, '/') : path);

/** The part of `path` below the folder `root` ('' for the folder itself), or null when it isn't inside, as `isSameOrInside` compares. */
function pathInside(path: string, root: string): string | null {
  if (!isSameOrInside(path, root)) return null;
  return path.slice(root.replace(/[\\/]+$/, '').length).replace(/^[\\/]+/, '');
}

/** `path` with the home folder as `~` (compared as Windows does there, without regard to case), in `/` form. */
function underHome(path: string, home: string): string {
  const inside = pathInside(path, home);
  if (inside === null) return forwardSlashes(path);
  return inside === '' ? '~' : `~/${inside.replace(/\\/g, '/')}`;
}

/** A path as Claude Code reads it after `@` or in a link: `~/…` under the home folder, `/` between parts, spaces escaped (`\ `). */
export function claudePath(path: string, home: string): string {
  return underHome(path, home).replace(/ /g, '\\ ');
}

/** A path with the home folder as `~`, unescaped: how the personal index links its files. */
export const tildePath = (path: string, home: string) => underHome(path, home);

/**
 * Whether a folder is synced or shared, and by what: iCloud Drive, Dropbox, Google Drive or OneDrive by where they keep
 * their files (on a Mac under ~/Library; on Windows `~\iCloudDrive`, `~\Dropbox`, `~\OneDrive` or `~\OneDrive - <org>`,
 * and Google Drive's own drive letter), or a git repository (`isRepo` checks a folder for `.git`). Null for a folder
 * that stays here.
 */
export function syncedBy(path: string, home: string, isRepo: (dir: string) => boolean): string | null {
  const windows = /^[A-Za-z]:[\\/]/.test(path);
  // Google Drive for desktop on Windows shows as a drive of its own: `G:\My Drive`, `G:\Shared drives`.
  if (windows && /^[A-Za-z]:[\\/](?:My Drive|Shared drives)(?:[\\/]|$)/i.test(path)) return 'Google Drive';
  const inside = pathInside(path, home);
  // The part below the home folder, `/`-separated, and in one case on Windows, where folder names have none.
  const rest = inside === null ? null : windows ? inside.replace(/\\/g, '/').toLowerCase() : inside;
  const inHome = (sub: string) => rest !== null && (rest === (windows ? sub.toLowerCase() : sub) || rest.startsWith(`${windows ? sub.toLowerCase() : sub}/`));
  if (inHome('Library/Mobile Documents') || inHome('iCloudDrive')) return 'iCloud Drive';
  const cloud = (rest !== null && /^library\/cloudstorage\/([^/]+)/i.exec(rest)?.[1]) || '';
  if (/^Dropbox/i.test(cloud) || inHome('Dropbox') || (windows && rest !== null && /^dropbox \(/.test(rest))) return 'Dropbox';
  if (/^GoogleDrive/i.test(cloud) || inHome('Google Drive')) return 'Google Drive';
  if (/^OneDrive/i.test(cloud) || inHome('OneDrive') || (rest !== null && /^onedrive - /i.test(rest))) return 'OneDrive';
  if (cloud) return cloud.split('-')[0]!;
  for (let dir = path; dir !== dirname(dir); dir = dirname(dir)) {
    if (pathInside(dir, home) === '') break;
    if (isRepo(dir)) return 'a git repository';
  }
  return null;
}

/** The one line that loads the personal folder: an import of its MEMORY.md (only the index; the files load on demand). */
export const importLine = (personalDir: string, home: string) => `@${claudePath(`${personalDir}/MEMORY.md`, home)}`;

/** Where the block is in a file: the index of its first character and of the character after it (its newline included). */
function findBlock(text: string): { start: number; end: number; body: string } | null {
  const start = text.indexOf(BLOCK_START);
  if (start === -1) return null;
  const close = text.indexOf(BLOCK_END, start);
  if (close === -1) return null;
  let end = close + BLOCK_END.length;
  if (text.startsWith('\r\n', end)) end += 2;
  else if (text[end] === '\n') end += 1;
  return { start, end, body: text.slice(start + BLOCK_START.length, close) };
}

/** The import line inside the block, or null when there is no block. */
export function blockLine(text: string): string | null {
  const block = findBlock(text);
  if (!block) return null;
  return block.body.split(/\r?\n/).find((line) => line.trim().startsWith('@'))?.trim() ?? '';
}

/**
 * CLAUDE.md with the block holding `line`: the block replaced where it is, or added at the end after exactly one blank
 * line. Everything else stays byte for byte, in the file's line endings.
 */
export function withBlock(text: string, line: string): string {
  const eol = detectEol(text);
  const block = `${BLOCK_START}${eol}${line}${eol}${BLOCK_END}${eol}`;
  const found = findBlock(text);
  if (found) return text.slice(0, found.start) + block + text.slice(found.end);
  const kept = text.replace(/(?:\r?\n[ \t]*)+$/, '');
  return kept === '' ? block : `${kept}${eol}${eol}${block}`;
}

/**
 * CLAUDE.md without the block. A block at the end takes the blank line before it along (the one `withBlock` added), so
 * adding and removing gives the file back as it was.
 */
export function withoutBlock(text: string): string {
  const found = findBlock(text);
  if (!found) return text;
  let before = text.slice(0, found.start);
  const after = text.slice(found.end);
  if (after === '') before = before.replace(/(\r?\n)\r?\n$/, '$1');
  return before + after;
}

/**
 * The memory a sync conflict copy stands for, by its file name: Dropbox's `name (… conflicted copy …).md`, iCloud's
 * `name 2.md` and Google Drive's `name (1).md`, when `name.md` is there too. Null for any other file.
 */
export function conflictBase(file: string, exists: (name: string) => boolean): string | null {
  const patterns = [/^(.+?) \([^)]*conflicted copy[^)]*\)\.md$/i, /^(.+?) \d+\.md$/, /^(.+?) \(\d+\)\.md$/];
  for (const pattern of patterns) {
    const base = pattern.exec(file)?.[1];
    if (base && exists(`${base}.md`)) return `${base}.md`;
  }
  return null;
}
