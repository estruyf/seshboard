import { isSameOrInside } from '@seshboard/protocol/client';
import { openChanges } from './changesPanelStore.ts';
import { useMemoryView } from './memoryStore.ts';
import { useSessions } from './sessionsStore.ts';

let nonce = 0;

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
  openChanges(sessionId);
  // Changes lists files relative to the checkout, with `/` as git writes them (also on Windows).
  const relative = path !== root && isSameOrInside(path, root) ? path.slice(root.replace(/[\\/]+$/, '').length + 1).replace(/\\/g, '/') : path;
  useMemoryView.setState({ changesFocus: { sessionId, path: relative, nonce: ++nonce } });
  return true;
}
