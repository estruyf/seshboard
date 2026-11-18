import { expandHome, isAbsolutePath, joinPath, pathInside } from '@seshboard/protocol/client';

const WRITES = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const READS = new Set(['Read']);

/** The files Claude touched in a session, relative to its folder with `/`: changed ones, and ones it only read. */
export interface TouchedFiles {
  changed: Set<string>;
  read: Set<string>;
}

/** `path` (absolute, `~/…` or relative to `cwd`) relative to `cwd` with `/`, or null when it is outside. */
export function insideFolder(path: string, cwd: string, home: string | null = null): string | null {
  const full = expandHome(path, home);
  const absolute = isAbsolutePath(full) ? full : full.startsWith('~') ? null : joinPath(cwd, full);
  const inside = absolute ? pathInside(absolute, cwd) : null;
  return inside ? inside.replace(/\\/g, '/') : null;
}

/**
 * Which of the folder's files Claude changed (a file in Changes, or an Edit or Write in the conversation) and which it
 * only read (a Read). `changes` is the session's Changes: paths relative to the repository's `root`.
 */
export function touchedFiles(
  items: ReadonlyArray<{ kind: string; name?: string; input?: unknown }>,
  cwd: string,
  changes: { root: string; files: ReadonlyArray<{ path: string; status: string }> } | null,
  home: string | null = null,
): TouchedFiles {
  const changed = new Set<string>();
  const read = new Set<string>();
  for (const item of items) {
    if (item.kind !== 'tool' || !item.name || !item.input || typeof item.input !== 'object') continue;
    const input = item.input as { file_path?: unknown; notebook_path?: unknown };
    const raw = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : null;
    if (!raw) continue;
    const path = insideFolder(raw, cwd, home);
    if (!path) continue;
    if (WRITES.has(item.name)) changed.add(path);
    else if (READS.has(item.name)) read.add(path);
  }
  for (const file of changes?.files ?? []) {
    if (file.status === 'deleted') continue;
    const path = insideFolder(joinPath(changes!.root, file.path), cwd);
    if (path) changed.add(path);
  }
  for (const path of changed) read.delete(path);
  return { changed, read };
}
