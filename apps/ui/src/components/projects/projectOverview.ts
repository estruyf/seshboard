import type { SessionRowData } from '../../state/sessionsStore.ts';
import type { RowStatus } from '../../state/sidebarRows.ts';
import { isMerged, type WorktreeRow } from '../worktrees/worktreeGroups.ts';

// What a project's Overview shows, without React or the stores: its recent sessions and how each stands, the
// worktrees worth a look with their badge, and the chips for how new sessions start.

/** The newest sessions first, `count` of them. */
export function recentSessions(rows: readonly SessionRowData[], count = 4): SessionRowData[] {
  return [...rows].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, count);
}

/** A recent session's state in words, and its dot's colour (the status colours of the sidebar). */
export function sessionState(status: RowStatus): { label: string; dot: string } {
  switch (status) {
    case 'needs-you':
      return { label: 'Needs you', dot: 'bg-warn' };
    case 'running':
      return { label: 'Working', dot: 'bg-accent-ink' };
    case 'background':
      return { label: 'Running in the background', dot: 'bg-ok' };
    case 'error':
      return { label: 'Failed', dot: 'bg-error' };
    case 'unread':
      return { label: 'Finished', dot: 'bg-unread' };
    default:
      return { label: 'Finished', dot: 'bg-faint' };
  }
}

export type WorktreeBadge = { label: 'in use' | 'merged' | 'no changes'; tone: 'accent' | 'ok' | 'muted' };

/** A worktree's badge on the Overview: in use (a session there), or why it is safe to remove. Null for the others. */
export function worktreeBadge(row: WorktreeRow): WorktreeBadge | null {
  if (row.group === 'main') return null;
  if (row.sessions.busy > 0 || row.sessions.open > 0) return { label: 'in use', tone: 'accent' };
  if (row.group !== 'safe') return null;
  return isMerged(row.entry) ? { label: 'merged', tone: 'ok' } : { label: 'no changes', tone: 'muted' };
}

/** The worktrees the Overview lists: in use first, then the ones that can go, `count` at most. */
export function overviewWorktrees(rows: readonly WorktreeRow[], count = 5): { row: WorktreeRow; badge: WorktreeBadge }[] {
  const badged = rows.flatMap((row) => {
    const badge = worktreeBadge(row);
    return badge ? [{ row, badge }] : [];
  });
  return [...badged.filter((w) => w.badge.label === 'in use'), ...badged.filter((w) => w.badge.label !== 'in use')].slice(0, count);
}

/** "How sessions start here": the defaults' summary (`describeDefaults`) as one chip per choice. */
export const defaultChips = (summary: string) => summary.split(' · ').filter(Boolean);
