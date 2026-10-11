import { asFolder, relativeTo } from './contextItems.ts';

/**
 * The `@` mention for a dropped file or folder: relative to the session's folder when it is inside it
 * (like the `@` file picker inserts), absolute otherwise. Folders end in `/`; paths with spaces are quoted.
 */
export function mentionFor(path: string, cwd: string | null, directory: boolean): string {
  let target = relativeTo(path, cwd);
  if (directory) target = asFolder(target);
  return /\s/.test(target) ? `@"${target}"` : `@${target}`;
}

/** Inserts mentions at the caret, with a space on either side where the text needs one. Returns the new text and caret. */
export function insertMentions(text: string, caret: number, mentions: string[]): { text: string; caret: number } {
  if (!mentions.length) return { text, caret };
  const before = text.slice(0, caret);
  const after = text.slice(caret);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const inserted = `${lead}${mentions.join(' ')}${/^\s/.test(after) ? '' : ' '}`;
  return { text: before + inserted + after, caret: caret + inserted.length };
}
