import { isSameOrInside, type LiveSession } from '@switchboard/protocol/client';

/** Above this many branches the menu gets a filter field. */
export const FILTER_FROM = 8;

/** A folder inside one of Claude Code's worktrees (`.claude/worktrees/<name>`). */
export const inWorktree = (path: string) => /[\\/]\.claude[\\/]worktrees[\\/]/.test(path);

/**
 * The other live sessions working in the same checkout as this one: in `root` or a folder inside it,
 * and not in a worktree (that is a checkout of its own). Session ids, without `selfId`.
 */
export function sharingCheckout(root: string, selfId: string, live: Iterable<LiveSession>): string[] {
  const ids = new Set<string>();
  for (const session of live) {
    if (session.sessionId === selfId || !session.cwd || inWorktree(session.cwd)) continue;
    if (isSameOrInside(session.cwd, root)) ids.add(session.sessionId);
  }
  return [...ids];
}

/** The branches to list: the current one first, then the rest in the order given (most recent first), matching `query`. */
export function filterBranches(branches: readonly string[], current: string | null, query: string): string[] {
  const needle = query.trim().toLowerCase();
  const ordered = current && branches.includes(current) ? [current, ...branches.filter((b) => b !== current)] : [...branches];
  return needle ? ordered.filter((b) => b.toLowerCase().includes(needle)) : ordered;
}

/** What the header button says, and its tooltip (the name, for narrow panes where only the icon shows). */
export function branchButton(current: string | null, busy: boolean): { label: string; tooltip: string } {
  const label = current ?? 'detached';
  if (busy) return { label, tooltip: 'Wait for Claude to finish (or stop it) to switch branches' };
  return { label, tooltip: current ? `On ${current}. Switch branch` : 'Detached HEAD. Switch branch' };
}

/** The question asked before switching a checkout other sessions also work in. */
export function sharedWarning(others: number): string {
  return others === 1 ? `1 other session works in this folder; it'll see the new branch too.` : `${others} other sessions work in this folder; they'll see the new branch too.`;
}
