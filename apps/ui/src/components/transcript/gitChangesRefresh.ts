import type { GitChanges } from '@switchboard/protocol/client';

/** How often the changed files are checked again while the window is visible. */
export const GIT_POLL_MS = 5000;

/**
 * The same files with the same status and counts. A check that finds nothing new keeps the list it had, so the
 * session view doesn't render again every few seconds for nothing (the Changes panel reloads open diffs on a new list).
 */
export function sameChanges(a: GitChanges | null, b: GitChanges | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.root !== b.root || a.branch !== b.branch || a.baseBranch !== b.baseBranch || a.base !== b.base || a.error !== b.error) return false;
  if (a.files.length !== b.files.length) return false;
  return a.files.every((f, i) => {
    const g = b.files[i]!;
    return f.path === g.path && f.status === g.status && f.additions === g.additions && f.deletions === g.deletions && f.staged === g.staged;
  });
}
