import { create } from 'zustand';
import { expandHome, isAbsolutePath, joinPath, previewKind } from '@switchboard/protocol/client';

const WRITES = new Set(['Write', 'Edit', 'MultiEdit']);

/**
 * The Markdown or HTML file the newest Write, Edit or MultiEdit in a conversation touched, as an absolute path, or null.
 * A relative path is read from the session's folder, `~/` from the home folder.
 */
export function lastPreviewableWrite(items: ReadonlyArray<{ kind: string; name?: string; input?: unknown }>, cwd: string | null, home: string | null): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind !== 'tool' || !item.name || !WRITES.has(item.name) || !item.input || typeof item.input !== 'object') continue;
    const raw = (item.input as { file_path?: unknown }).file_path;
    if (typeof raw !== 'string' || previewKind(raw) === null) continue;
    const path = expandHome(raw, home);
    if (isAbsolutePath(path)) return path;
    if (cwd && !path.startsWith('~')) return joinPath(cwd, path);
  }
  return null;
}

interface LastWrittenState {
  /** Per local session: the previewable file Claude wrote or edited last. */
  paths: ReadonlyMap<string, string>;
  set(sessionId: string, path: string | null): void;
}

/** What "Preview last written file" in the palette opens. The conversation isn't in a store, so the transcript view says. */
export const useLastWritten = create<LastWrittenState>()((set) => ({
  paths: new Map(),
  set: (sessionId, path) =>
    set((s) => {
      if ((s.paths.get(sessionId) ?? null) === path) return s;
      const paths = new Map(s.paths);
      if (path) paths.set(sessionId, path);
      else paths.delete(sessionId);
      return { paths };
    }),
}));
