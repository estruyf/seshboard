import { create } from 'zustand';
import { openProject } from './projectPageStore.ts';
import { useSessions } from './sessionsStore.ts';

interface MemoryViewState {
  /** The personal memory folder, once read (to recognise memory writes in a conversation). */
  personalDir: string | null;
  /** The memory editor on screen has changes that aren't saved. */
  dirty: boolean;
  /** Where someone wanted to go while the editor had unsaved changes; the editor asks, then runs it or drops it. */
  leave: (() => void) | null;
  /** The file the Memory tab selects next time it shows this project (a memory just saved, the palette's pick). */
  focus: { root: string | null; path: string; nonce: number; highlight?: string[] } | null;
  /** A file the Changes panel opens and scrolls to once it lists it (Show in Changes after a share). */
  changesFocus: { sessionId: string; path: string; nonce: number } | null;
}

let nonce = 0;

export const useMemoryView = create<MemoryViewState>()(() => ({ personalDir: null, dirty: false, leave: null, focus: null, changesFocus: null }));

/** Runs `action` now, or, while the memory editor has unsaved changes, after asking whether to discard them. */
export function guardMemoryEdits(action: () => void): void {
  if (useMemoryView.getState().dirty) useMemoryView.setState({ leave: action });
  else action();
}

/** Opens a memory: on its project's Memory tab, or (`root` null, the personal folder) in Settings › Memory. */
export function openMemoryFile(root: string | null, path: string, highlight?: string[]): void {
  useMemoryView.setState({ focus: { root, path, nonce: ++nonce, highlight } });
  if (root) openProject(root, 'memory');
  else useSessions.getState().openSettings('memory');
}
