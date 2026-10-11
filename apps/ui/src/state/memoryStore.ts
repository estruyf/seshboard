import { create } from 'zustand';
import { isSameOrInside } from '@switchboard/protocol/client';
import { openProject } from './projectPageStore.ts';
import { useOverlay } from './overlayStore.ts';
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
  changesFocus: { path: string; nonce: number } | null;
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

/**
 * The newest session working in the project's own checkout (not a worktree), whose Changes panel shows a file there;
 * null when there is none.
 */
export function changesSessionFor(root: string): string | null {
  let best: { id: string; at: number } | null = null;
  for (const s of useSessions.getState().sessions.values()) {
    if (s.projectRoot !== root || s.cwd !== root || s.worktree) continue;
    if (!best || s.updatedAt > best.at) best = { id: s.id, at: s.updatedAt };
  }
  return best?.id ?? null;
}

/** Shows a file of the project in the Changes panel of its newest session. False when the project has no session to show it in. */
export function showInChanges(root: string, path: string): boolean {
  const sessionId = changesSessionFor(root);
  if (!sessionId) return false;
  useSessions.getState().select(sessionId);
  useOverlay.getState().toggleChanges(true);
  // Changes lists files relative to the checkout, with `/` as git writes them (also on Windows).
  const relative = path !== root && isSameOrInside(path, root) ? path.slice(root.replace(/[\\/]+$/, '').length + 1).replace(/\\/g, '/') : path;
  useMemoryView.setState({ changesFocus: { path: relative, nonce: ++nonce } });
  return true;
}
