import { create } from 'zustand';

/**
 * A file in edit mode in a session's Files panel. It stays while you look at another tab or the panel is closed: the
 * editor's model (its text, undo and saved point) is kept by `monacoEditor.ts` under the same key.
 */
export interface FileEdit {
  /** The text on disk when editing started or was last saved. */
  saved: string;
  /** The mtime (ms) of `saved`: a save refuses when the file changed since. */
  modified: number;
  /** Goes up when the editor must start again from `saved` (a new text from disk while there were no edits). */
  seq: number;
  /** There are edits not saved. */
  dirty: boolean;
  /** The file changed on disk while there were edits: its new mtime, until you pick Reload or Save mine. */
  changedOnDisk: number | null;
}

interface FileEditsState {
  /** By `editKey(sessionId, path)`. */
  edits: ReadonlyMap<string, FileEdit>;
  start(sessionId: string, path: string, saved: string, modified: number): void;
  update(sessionId: string, path: string, patch: Partial<FileEdit>): void;
  stop(sessionId: string, path: string): void;
}

/** The key of a session's file in `edits`. */
export const editKey = (sessionId: string, path: string) => `${sessionId}\n${path}`;

export const useFileEdits = create<FileEditsState>()((set) => ({
  edits: new Map(),
  start: (sessionId, path, saved, modified) =>
    set((s) => ({ edits: new Map(s.edits).set(editKey(sessionId, path), { saved, modified, seq: 0, dirty: false, changedOnDisk: null }) })),
  update: (sessionId, path, patch) =>
    set((s) => {
      const key = editKey(sessionId, path);
      const edit = s.edits.get(key);
      return edit ? { edits: new Map(s.edits).set(key, { ...edit, ...patch }) } : s;
    }),
  stop: (sessionId, path) =>
    set((s) => {
      const key = editKey(sessionId, path);
      if (!s.edits.has(key)) return s;
      const edits = new Map(s.edits);
      edits.delete(key);
      return { edits };
    }),
}));

/** The paths of a session's files in edit mode, in no order. */
export function editedPaths(edits: ReadonlyMap<string, FileEdit>, sessionId: string): string[] {
  const prefix = `${sessionId}\n`;
  return [...edits.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
}
