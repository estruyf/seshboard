import { closeSync, fstatSync, openSync, readSync, realpathSync } from 'node:fs';

/** How much of the end of a task's output the panel gets: enough for a build log's tail, small enough to poll. */
export const TASK_OUTPUT_TAIL_BYTES = 64 * 1024;

/**
 * Claude Code writes what a background command prints to `<its temp folder>/claude…/<project>/<session>/tasks/<id>.output`.
 * The folder differs per platform and can be moved (`CLAUDE_CODE_TMPDIR`), so the path comes from the transcript, and
 * this only checks that it has that shape: a `claude` or `claude-<uid>` folder above a `tasks` folder holding `<id>.output`.
 */
const TASK_OUTPUT = /[\\/]claude(?:-\d+)?[\\/](?:[^\\/]+[\\/])*tasks[\\/][\w-]+\.output$/;

export const isTaskOutputPath = (path: string): boolean => TASK_OUTPUT.test(path);

export interface TaskOutput {
  /** The end of the output, at most `maxBytes` of it, as text. */
  text: string;
  /** The whole file's size in bytes. */
  size: number;
  /** The text starts partway through the file. */
  truncated: boolean;
  /** No such file (yet, or any more: the temp folder was cleaned). */
  missing: boolean;
}

const MISSING: TaskOutput = { text: '', size: 0, truncated: false, missing: true };

/**
 * The end of a background task's output file. Anything that isn't a task output file (by its path, also once links are
 * followed) is refused, so this can't be used to read other files.
 */
export function readTaskOutput(path: string, maxBytes = TASK_OUTPUT_TAIL_BYTES): TaskOutput {
  if (!isTaskOutputPath(path)) throw new Error('Not a background task’s output file');
  let real: string;
  try {
    real = realpathSync(path);
  } catch {
    return MISSING;
  }
  if (!isTaskOutputPath(real)) throw new Error('Not a background task’s output file');
  const fd = openSync(real, 'r');
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error('Not a background task’s output file');
    const length = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    const read = readSync(fd, buffer, 0, length, stat.size - length);
    let text = buffer.subarray(0, read).toString('utf8');
    const truncated = stat.size > length;
    // Cut mid-file, the first line is a fragment (and may start inside a character): start at the next whole line.
    if (truncated) {
      const newline = text.indexOf('\n');
      if (newline !== -1) text = text.slice(newline + 1);
    }
    return { text, size: stat.size, truncated, missing: false };
  } finally {
    closeSync(fd);
  }
}
