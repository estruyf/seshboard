import { describe, expect, it } from 'vitest';
import type { SessionRowData } from '../../state/sessionsStore.ts';
import type { WorktreeRow } from '../worktrees/worktreeGroups.ts';
import { defaultChips, overviewWorktrees, recentSessions, sessionState, worktreeBadge } from './projectOverview.ts';

const session = (id: string, updatedAt: number) => ({ id, updatedAt }) as unknown as SessionRowData;
const worktree = (path: string, group: WorktreeRow['group'], options: { busy?: number; open?: number; merged?: boolean } = {}) =>
  ({ entry: { path, merged: options.merged ?? false, pr: null }, group, reason: null, locked: null, sessions: { busy: options.busy ?? 0, needsYou: 0, open: options.open ?? 0, total: 0 } }) as unknown as WorktreeRow;

describe('the Overview', () => {
  it('lists the four newest sessions', () => {
    const rows = [session('a', 1), session('b', 5), session('c', 3), session('d', 4), session('e', 2)];
    expect(recentSessions(rows).map((r) => r.id)).toEqual(['b', 'd', 'c', 'e']);
  });

  it('says how each session stands', () => {
    expect(sessionState('running').label).toBe('Working');
    expect(sessionState('needs-you').dot).toBe('bg-warn');
    expect(sessionState(null).label).toBe('Finished');
  });

  it('badges worktrees in use, merged or without changes, in use first', () => {
    expect(worktreeBadge(worktree('/main', 'main', { busy: 1 }))).toBeNull();
    expect(worktreeBadge(worktree('/k', 'keep'))).toBeNull();
    expect(worktreeBadge(worktree('/k', 'keep', { open: 1 }))?.label).toBe('in use');
    expect(worktreeBadge(worktree('/m', 'safe', { merged: true }))?.label).toBe('merged');
    expect(worktreeBadge(worktree('/n', 'safe'))?.label).toBe('no changes');
    const listed = overviewWorktrees([worktree('/m', 'safe', { merged: true }), worktree('/main', 'main'), worktree('/u', 'keep', { busy: 1 }), worktree('/k', 'keep')]);
    expect(listed.map((w) => w.row.entry.path)).toEqual(['/u', '/m']);
  });

  it('shows the defaults as chips', () => {
    expect(defaultChips('Opus · high effort · worktree from dev')).toEqual(['Opus', 'high effort', 'worktree from dev']);
    expect(defaultChips('Global defaults')).toEqual(['Global defaults']);
  });
});
