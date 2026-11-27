import { chmod, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';
import { isSameOrInside, MAX_PREVIEW_BYTES, RpcError } from '@seshboard/protocol';

/** What `writeFileContent` returns (the result of `files.write`). */
export interface FileWritten {
  /** The file's new mtime in ms, as `files.read` reports it: the next save sends it back as `expectedModified`. */
  modified: number;
  size: number;
}

export interface FileWriteRequest {
  path: string;
  content: string;
  /** The mtime (ms) the file had when it was read. A file changed since is refused with CONFLICT. */
  expectedModified: number;
}

/** The line ending a text uses most: `\r\n` when it has more CRLF than lone LF lines. Null for a text of one line. */
export function lineEnding(text: string): '\n' | '\r\n' | null {
  let crlf = 0;
  let lf = 0;
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {
    if (i > 0 && text[i - 1] === '\r') crlf++;
    else lf++;
  }
  if (!crlf && !lf) return null;
  return crlf > lf ? '\r\n' : '\n';
}

/** Every line of `text` ending in `eol`. */
export const withLineEnding = (text: string, eol: '\n' | '\r\n') => text.replace(/\r?\n/g, eol);

/**
 * Saves text the user edited over a file that is already there, inside one of `folders` (the folders Seshboard knows:
 * a session's folder or a project's root). The real path is checked, so a link inside a project can't lead out of it,
 * and nothing in a `.git` folder is written. CONFLICT when the file's mtime is not `expectedModified` any more (Claude
 * or another editor changed it). The new text keeps the file's line endings and its byte order mark, and goes to a
 * temporary file in the same folder that is renamed over the file, so a crash never leaves half a file. The file
 * keeps its permissions.
 */
export async function writeFileContent(request: FileWriteRequest, folders: readonly string[]): Promise<FileWritten> {
  const { path, content, expectedModified } = request;
  if (Buffer.byteLength(content, 'utf8') > MAX_PREVIEW_BYTES) throw new RpcError('TOO_LARGE', `The text is larger than Seshboard edits`);
  let real: string;
  try {
    real = await realpath(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') throw new RpcError('NOT_FOUND', `Not found: ${path}`);
    throw new RpcError('INTERNAL', `Couldn't save ${path}: ${(error as Error).message}`);
  }
  const roots = await Promise.all(folders.map((folder) => realpath(folder).catch(() => null)));
  if (!roots.some((root) => root !== null && real !== root && isSameOrInside(real, root))) throw new RpcError('NOT_FOUND', `Not inside a session's folder or a project: ${path}`);
  if (real.split(sep).includes('.git')) throw new RpcError('UNSUPPORTED', `Seshboard doesn't edit files in .git: ${path}`);

  const info = await stat(real);
  if (!info.isFile()) throw new RpcError('UNSUPPORTED', `${path} is not a file`);
  if (Math.floor(info.mtimeMs) !== expectedModified) throw new RpcError('CONFLICT', `${basename(path)} changed on disk since it was opened`, { modified: Math.floor(info.mtimeMs) });

  const before = await readFile(real, 'utf8');
  const bom = before.startsWith('﻿') ? '﻿' : '';
  const eol = lineEnding(before);
  const text = bom + (eol ? withLineEnding(content.replace(/^﻿/, ''), eol) : content.replace(/^﻿/, ''));

  // In the same folder, so the rename stays on one volume and is atomic.
  const temp = join(dirname(real), `.${basename(real)}.seshboard-${process.pid}-${Date.now()}.tmp`);
  try {
    await writeFile(temp, text, { encoding: 'utf8', mode: info.mode & 0o7777 });
    await chmod(temp, info.mode & 0o7777);
    // Checked once more just before the swap: a write between the first check and here is not overwritten.
    const latest = await stat(real);
    if (Math.floor(latest.mtimeMs) !== expectedModified) throw new RpcError('CONFLICT', `${basename(path)} changed on disk since it was opened`, { modified: Math.floor(latest.mtimeMs) });
    await rename(temp, real);
  } catch (error) {
    await rm(temp, { force: true });
    if (error instanceof RpcError) throw error;
    throw new RpcError('INTERNAL', `Couldn't save ${path}: ${(error as Error).message}`);
  }
  const after = await stat(real);
  return { modified: Math.floor(after.mtimeMs), size: after.size };
}
