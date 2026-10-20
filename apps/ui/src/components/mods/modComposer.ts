/**
 * The message boxes Claude Code may ask about on a mod's behalf, by draft key (a session's id). A session's box
 * registers while it is mounted; read gives its text and caret, fill and suggest change it but never send.
 */
export interface ModComposerHandle {
  read(): { text: string; cursor: number };
  fill(text: string, mode: 'replace' | 'append' | 'insert'): boolean;
  /** Shows `text` dim in the empty box for Tab to take. */
  suggest(text: string): boolean;
}

const handles = new Map<string, ModComposerHandle>();

export function registerModComposer(key: string, handle: ModComposerHandle): () => void {
  handles.set(key, handle);
  return () => {
    if (handles.get(key) === handle) handles.delete(key);
  };
}

export function modComposer(key: string): ModComposerHandle | undefined {
  return handles.get(key);
}

/** The text after a fill: replace it, add it at the end, or put it at the caret. */
export function filled(current: string, cursor: number, text: string, mode: 'replace' | 'append' | 'insert'): { text: string; caret: number } {
  if (mode === 'replace') return { text, caret: text.length };
  if (mode === 'append') return { text: current + text, caret: current.length + text.length };
  const at = Math.max(0, Math.min(cursor, current.length));
  return { text: current.slice(0, at) + text + current.slice(at), caret: at + text.length };
}
