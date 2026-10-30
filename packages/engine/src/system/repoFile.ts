import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';

/** How large a settings file read from a repository may be: far more than any real one. */
export const MAX_REPO_FILE_BYTES = 1024 * 1024;

/**
 * Reads a small text file a repository holds (`.seshboard.json`, `package.json`, `.claude/settings.json`). A cloned
 * or copied repository decides what these are: a symbolic link to `/dev/zero` would never finish reading and stop the
 * engine, and one to a private file elsewhere would be read (and, for a file Seshboard writes, copied into the
 * repository). So it must be a regular file, not a link, and at most `max` bytes; anything else throws, with the
 * reason as its message. A missing file throws ENOENT, as `readFileSync` does.
 *
 * Opened without following a link (`O_NOFOLLOW`) and without waiting on a FIFO (`O_NONBLOCK`), then checked on what
 * was opened, so the file can't be swapped between the check and the read. Windows has neither flag: there the path
 * is checked with `lstat` first.
 */
export function readRepoFile(path: string, max: number = MAX_REPO_FILE_BYTES): string {
  const noFollow = constants.O_NOFOLLOW;
  if (noFollow === undefined && lstatSync(path).isSymbolicLink()) throw new Error('is a link, which Seshboard doesn’t follow');
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | (noFollow ?? 0) | (constants.O_NONBLOCK ?? 0));
  } catch (error) {
    // O_NOFOLLOW fails with ELOOP on a link (EMLINK on FreeBSD).
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ELOOP' || code === 'EMLINK') throw new Error('is a link, which Seshboard doesn’t follow');
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error('is not a regular file');
    if (stat.size > max) throw new Error(`is larger than ${Math.round(max / 1024)} KB`);
    // Read at most one byte more than allowed: a file that grew since the check is still caught.
    const buffer = Buffer.alloc(Math.min(stat.size, max) + 1);
    let length = 0;
    for (let n; length < buffer.length && (n = readSync(fd, buffer, length, buffer.length - length, null)) > 0; ) length += n;
    if (length > max) throw new Error(`is larger than ${Math.round(max / 1024)} KB`);
    return buffer.toString('utf8', 0, length);
  } finally {
    closeSync(fd);
  }
}
