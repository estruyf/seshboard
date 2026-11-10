import { lstat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { RpcError, type TranscriptMessage } from '@seshboard/protocol';

/**
 * Which files another device may preview from a session (`files.read` and `files.image` in the remote contract): only
 * what the session made. A path from a phone or another computer is never trusted, and a path Claude only names in a
 * reply proves nothing (a web page or a file it read can make it name any path), so only two kinds of file pass:
 *
 * - one Claude wrote with the Write tool in this session, and that call did not fail;
 * - one in this session's own scratchpad, `<temp>/claude-<user>/<project>/<session id>/scratchpad/…`.
 *
 * Anything else is NOT_FOUND, with the same words whether it exists or not, so a device learns nothing about the disk.
 */

/** The answer to every path a device may not read, missing or not. */
const notShared = () => new RpcError('NOT_FOUND', 'That file is not one this session made');

/** The paths Write calls of the transcript wrote, resolved: a call without a result yet, or with an error, wrote nothing. */
export function writtenPaths(messages: readonly TranscriptMessage[]): Set<string> {
  const writes = new Map<string, string>();
  const done = new Set<string>();
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type === 'tool_use' && block.name === 'Write') {
        const path = (block.input as { file_path?: unknown } | null)?.file_path;
        if (typeof path === 'string' && isAbsolute(path)) writes.set(block.id, resolve(path));
      } else if (block.type === 'tool_result' && !block.isError) {
        done.add(block.toolUseId);
      }
    }
  }
  return new Set([...writes].filter(([id]) => done.has(id)).map(([, path]) => path));
}

/**
 * Whether `real` (a path with its links resolved) is a file inside the scratchpad of `sessionId` under one of `roots`
 * (the temp folders, resolved too). Claude Code names the folder after the session, so another session's never passes.
 */
export function inScratchpad(real: string, sessionId: string, roots: readonly string[]): boolean {
  return roots.some((root) => {
    const rest = relative(root, real);
    if (!rest || rest.startsWith('..') || isAbsolute(rest)) return false;
    const parts = rest.split(sep);
    // claude-<user>, the project's folder, the session's id, "scratchpad", and at least the file itself.
    return parts.length >= 5 && /^claude-[\w.-]+$/.test(parts[0]!) && parts[2] === sessionId && parts[3] === 'scratchpad';
  });
}

/** The temp folders Claude Code keeps scratchpads in, with their links resolved (`/tmp` is `/private/tmp` on a Mac). */
export async function scratchpadRoots(): Promise<string[]> {
  const candidates = process.platform === 'win32' ? [tmpdir()] : ['/tmp', tmpdir()];
  const roots = await Promise.all(candidates.map((path) => realpath(path).catch(() => null)));
  return [...new Set(roots.filter((root): root is string => root !== null))];
}

/**
 * The file at `path` if the session made it (see above), or NOT_FOUND. A link is refused even when Claude wrote the
 * path: a later command could swap the file for a link to anything on the disk.
 */
export async function sessionFile(path: string, sessionId: string, messages: readonly TranscriptMessage[], roots: readonly string[]): Promise<string> {
  if (!isAbsolute(path)) throw notShared();
  const asked = resolve(path);
  let real: string;
  try {
    if (!(await lstat(asked)).isFile()) throw notShared();
    real = await realpath(asked);
  } catch {
    throw notShared();
  }
  if (writtenPaths(messages).has(asked) || inScratchpad(real, sessionId, roots)) return asked;
  throw notShared();
}
