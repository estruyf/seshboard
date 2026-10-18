import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defuseStubs, REMOTE_ATTACHMENT_BYTES, RpcError, type RemoteFile, type RemoteImage } from '@switchboard/protocol';

/**
 * Files sent with a message from another device (docs/remote-access.md): kept in a folder of their own under `dir`,
 * one per message, and mentioned in the prompt by path so Claude reads them itself. Folders older than `KEEP_MS` go
 * when Remote starts.
 */

const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/** Refuses a message whose images and files are more than the channel takes. */
export function checkAttachments(images: readonly RemoteImage[], files: readonly RemoteFile[]): void {
  const bytes = [...images, ...files].reduce((sum, a) => sum + a.data.length, 0);
  if (bytes > REMOTE_ATTACHMENT_BYTES) throw new RpcError('INVALID_PARAMS', 'The images and files are too big for one message.');
}

/** A name that is safe as one file in a folder: no folders, no control characters, not `.` or `..`. */
export function safeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').replace(/^\.+/, '_').trim().slice(0, 200);
  return clean || 'file';
}

/** Writes the files to a new folder under `dir` and returns their paths, in order. Two files with one name both stay. */
export function saveRemoteFiles(dir: string, files: readonly RemoteFile[]): string[] {
  if (!files.length) return [];
  const folder = join(dir, `${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`);
  mkdirSync(folder, { recursive: true });
  const taken = new Set<string>();
  return files.map((file) => {
    let name = safeFileName(file.name);
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = safeFileName(file.name).replace(/(\.[^.]*)?$/, (ext) => ` (${n})${ext}`);
    taken.add(name.toLowerCase());
    const path = join(folder, name);
    writeFileSync(path, Buffer.from(file.data, 'base64'));
    return path;
  });
}

/** The prompt with the files as `@` mentions on a line of their own, as the message box writes dropped files. */
export function promptWithFiles(typed: string, paths: readonly string[]): string {
  // A phone never links a session: a stub typed there could name one hidden from it (docs/session-linking.md).
  const text = defuseStubs(typed);
  if (!paths.length) return text;
  const mentions = paths.map((path) => (/\s/.test(path) ? `@"${path}"` : `@${path}`)).join(' ');
  return text.trim() ? `${text.trim()}\n\n${mentions}` : mentions;
}

/** Removes the folders of messages older than `KEEP_MS`. */
export function pruneRemoteFiles(dir: string, now = Date.now()): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    try {
      if (now - statSync(path).mtimeMs > KEEP_MS) rmSync(path, { recursive: true, force: true });
    } catch {
      // Gone already, or in use: the next start tries again.
    }
  }
}
