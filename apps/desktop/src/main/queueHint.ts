import type { LaterItem, QueueStarted, SessionOutcome } from '@seshboard/protocol/client';

const projectOf = (path: string) => path.replace(/\/\.claude\/worktrees\/[^/]+.*$/, '').replace(/\/+$/, '');

/**
 * The line a "Claude finished" notification adds when the queue has something next for that session: the first item
 * (in queue order) that waits on it, on its project, or on the queued item it was started from. Items that wait for
 * nothing are left out. The app's own toast says more (whether the project is really free); this is the hint. An item
 * that starts by itself says "Starting next" when the turn ended cleanly (`outcome`), since the engine starts it now.
 */
export function queueHint(
  items: readonly LaterItem[],
  started: readonly QueueStarted[],
  finished: { sessionId: string; cwd: string | null; outcome?: SessionOutcome | null },
): string | null {
  const root = finished.cwd ? projectOf(finished.cwd) : null;
  const from = new Set(started.filter((s) => s.sessionId === finished.sessionId).map((s) => s.itemId));
  const next = items.find(
    ({ waitFor, cwd }) =>
      (waitFor.kind === 'session' && waitFor.sessionId === finished.sessionId) ||
      (waitFor.kind === 'item' && from.has(waitFor.itemId)) ||
      (waitFor.kind === 'project' && root !== null && projectOf(cwd) === root),
  );
  if (!next) return null;
  const line = next.prompt.trim().split('\n')[0]!.trim();
  const starts = next.autoStart && finished.outcome === 'clean';
  return `${starts ? 'Starting next' : 'Next in the queue'}: ${line.length > 80 ? `${line.slice(0, 79)}…` : line}`;
}
