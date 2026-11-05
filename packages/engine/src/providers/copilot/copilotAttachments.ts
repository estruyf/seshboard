import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';

/** One of Copilot's context attachments for a file, a folder or some lines of a file (`MessageOptions.attachments`). */
export type CopilotFileAttachment =
  | { type: 'file'; path: string; displayName: string }
  | { type: 'directory'; path: string; displayName: string }
  | { type: 'selection'; filePath: string; displayName: string; selection: { start: { line: number; character: number }; end: { line: number; character: number } }; text: string };

const MENTION = /^@(?:"([^"\n]+)"|([^\s"]\S*))$/;
/** The most of a file read for a range of lines: past it, the file goes whole and Copilot reads the lines itself. */
const MAX_RANGE_BYTES = 512 * 1024;

/**
 * The files and folders a message mentions, as Copilot's attachments. The message box writes them on one line of `@`
 * mentions (`promptWithContext`: relative to the session's folder, folders ending in `/`, a range as `#L12-40`, quoted
 * when the path has spaces), which Claude Code opens itself; Copilot takes them as attachments. Only a paragraph made
 * of mentions alone counts, so an `@` in what you typed is left as words. A path that isn't there is left out.
 */
export function mentionAttachments(text: string, cwd: string): CopilotFileAttachment[] {
  const attachments: CopilotFileAttachment[] = [];
  for (const paragraph of text.split(/\n{2,}/)) {
    const words = paragraph.trim().match(/@"[^"\n]+"|\S+/g) ?? [];
    const mentions = words.map((word) => MENTION.exec(word));
    if (!words.length || mentions.some((m) => !m)) continue;
    for (const match of mentions) {
      const attachment = attachmentFor(match![1] ?? match![2]!, cwd);
      if (attachment) attachments.push(attachment);
    }
  }
  return attachments;
}

function attachmentFor(target: string, cwd: string): CopilotFileAttachment | null {
  const range = /#L(\d+)(?:-(\d+))?$/.exec(target);
  const bare = (range ? target.slice(0, range.index) : target).replace(/[\\/]+$/, '');
  if (!bare) return null;
  const path = isAbsolute(bare) ? bare : join(cwd, bare);
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat) return null;
  const name = basename(path);
  if (stat.isDirectory()) return { type: 'directory', path, displayName: name };
  if (!range || stat.size > MAX_RANGE_BYTES) return { type: 'file', path, displayName: name };
  const start = Number(range[1]);
  const end = Math.max(start, Number(range[2] ?? range[1]));
  const lines = readText(path).split('\n').slice(start - 1, end);
  if (!lines.length) return { type: 'file', path, displayName: name };
  // Copilot counts lines and characters from 0, as editors do.
  return {
    type: 'selection',
    filePath: path,
    displayName: `${name}#L${start}${end > start ? `-${end}` : ''}`,
    selection: { start: { line: start - 1, character: 0 }, end: { line: start - 1 + lines.length - 1, character: lines.at(-1)!.length } },
    text: lines.join('\n'),
  };
}

function readText(path: string): string {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(MAX_RANGE_BYTES);
    return buffer.subarray(0, readSync(fd, buffer, 0, MAX_RANGE_BYTES, 0)).toString('utf8');
  } finally {
    closeSync(fd);
  }
}
