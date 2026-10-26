import { describe, expect, it } from 'vitest';
import type { LiveSession, SessionSummary } from '@switchboard/protocol/client';
import type { SessionRowData } from '../../state/sessionsStore.ts';
import { activityByProject, columnsFor, COLUMN_BREAKPOINTS, filterFolders, gridMove, latestBranches, orderProjects, pickUpRows, quickCount, quickTiles, recentFirst, tileStatus } from './projectTiles.ts';

const NOW = Date.UTC(2026, 9, 5, 12);
const HOUR = 3_600_000;

const live = (status: LiveSession['status']): LiveSession => ({
  sessionId: 'x',
  pid: 1,
  cwd: null,
  projectRoot: '/p/a',
  status,
  rawStatus: status,
  name: null,
  origin: 'app',
  startedAt: null,
  updatedAt: null,
  profileId: 'default',
});

const row = (id: string, overrides: Partial<SessionRowData> = {}): SessionRowData => ({
  id,
  title: id,
  projectRoot: '/p/a',
  updatedAt: NOW - HOUR,
  branch: null,
  isWorktree: false,
  live: null,
  summary: null,
  pinned: false,
  archivedAt: null,
  restoredAt: null,
  unread: false,
  inApp: true,
  error: false,
  profileId: 'default',
  ...overrides,
});

describe('project tiles', () => {
  it('count what needs you, what works and what is open per project', () => {
    const activity = activityByProject([
      row('a', { live: live('needs-you') }),
      row('b', { live: live('running'), updatedAt: NOW }),
      row('c', { live: live('idle') }),
      row('d', { projectRoot: '/p/b', updatedAt: NOW - 3 * HOUR }),
    ]);
    expect(activity.get('/p/a')).toEqual({ needsYou: 1, working: 1, open: 3, lastActivity: NOW });
    expect(activity.get('/p/b')).toEqual({ needsYou: 0, working: 0, open: 0, lastActivity: NOW - 3 * HOUR });
  });

  it('say what matters most on the status line', () => {
    expect(tileStatus({ needsYou: 2, working: 1, open: 3, lastActivity: NOW }, null, NOW)).toEqual({ tone: 'needs-you', label: '2 needs you' });
    expect(tileStatus({ needsYou: 0, working: 2, open: 2, lastActivity: NOW }, null, NOW)).toEqual({ tone: 'working', label: '2 working' });
    expect(tileStatus(undefined, NOW - 2 * HOUR, NOW)).toEqual({ tone: 'idle', label: 'Idle · 2h' });
    expect(tileStatus(undefined, null, NOW)).toEqual({ tone: 'idle', label: 'No sessions yet' });
  });

  it('put the most recent projects first and keep the rest in order', () => {
    const at = new Map([['/b', 5], ['/c', 9]]);
    expect(recentFirst(['/a', '/b', '/c', '/d'], (root) => at.get(root) ?? null)).toEqual(['/c', '/b', '/a', '/d']);
  });

  it('order projects by recent use, or keep your order', () => {
    const at = new Map([['/b', 2], ['/c', 3]]);
    const lastActivity = (root: string) => at.get(root) ?? null;
    expect(orderProjects(['/a', '/b', '/c'], 'recent', lastActivity)).toEqual(['/c', '/b', '/a']);
    expect(orderProjects(['/a', '/b', '/c'], 'yours', lastActivity)).toEqual(['/a', '/b', '/c']);
  });

  it('keep a picked folder visible among the quick tiles', () => {
    const recent = ['/a', '/b', '/c', '/d', '/e'];
    expect(quickTiles(recent, '/b', 4)).toEqual(['/a', '/b', '/c', '/d']);
    expect(quickTiles(recent, '/e', 4)).toEqual(['/a', '/b', '/c', '/e']);
    expect(quickTiles(recent, '/elsewhere', 4)).toEqual(['/a', '/b', '/c', '/elsewhere']);
    expect(quickTiles(recent, null, 4)).toEqual(['/a', '/b', '/c', '/d']);
  });

  it('show six, eight or nine projects for one, two or three columns', () => {
    expect([1, 2, 3].map(quickCount)).toEqual([6, 8, 9]);
    // Never more than ⌘9 reaches.
    expect(quickCount(4)).toBe(9);
    expect(columnsFor(519, COLUMN_BREAKPOINTS)).toBe(1);
    expect(columnsFor(520, COLUMN_BREAKPOINTS)).toBe(2);
    expect(columnsFor(779, COLUMN_BREAKPOINTS)).toBe(2);
    expect(columnsFor(780, COLUMN_BREAKPOINTS)).toBe(3);
    expect(columnsFor(2000, COLUMN_BREAKPOINTS)).toBe(3);
  });

  it('keep a picked project past the top in the last place, for each column count', () => {
    const eighteen = Array.from({ length: 18 }, (_, i) => `/p${i + 1}`);
    for (const columns of [1, 2, 3]) {
      const count = quickCount(columns);
      const tiles = quickTiles(eighteen, '/p15', count);
      expect(tiles).toHaveLength(count);
      expect(tiles.at(-1)).toBe('/p15');
      expect(tiles.slice(0, -1)).toEqual(eighteen.slice(0, count - 1));
      // One inside the top stays where it is.
      expect(quickTiles(eighteen, '/p2', count)).toEqual(eighteen.slice(0, count));
    }
  });

  it('move through the grid left to right, then down', () => {
    // Three columns, eight rows: 0 1 2 / 3 4 5 / 6 7.
    expect(gridMove('ArrowRight', 2, 8, 3)).toBe(3);
    expect(gridMove('ArrowLeft', 3, 8, 3)).toBe(2);
    expect(gridMove('ArrowDown', 1, 8, 3)).toBe(4);
    expect(gridMove('ArrowUp', 4, 8, 3)).toBe(1);
    expect(gridMove('ArrowDown', 5, 8, 3)).toBe(null);
    expect(gridMove('ArrowUp', 1, 8, 3)).toBe(null);
    expect(gridMove('ArrowLeft', 0, 8, 3)).toBe(null);
    expect(gridMove('Home', 5, 8, 3)).toBe(0);
    expect(gridMove('End', 0, 8, 3)).toBe(7);
    expect(gridMove('Enter', 0, 8, 3)).toBe(null);
    // One column: up and down are the next row.
    expect(gridMove('ArrowDown', 0, 6, 1)).toBe(1);
  });

  it('filter by name or path', () => {
    const names = new Map([['/u/me/switchboard', 'Switchboard'], ['/u/me/demo-time', 'Demo Time']]);
    const nameOf = (root: string) => names.get(root) ?? root;
    const all = [...names.keys()];
    expect(filterFolders(all, '', nameOf, '/u/me')).toEqual(all);
    expect(filterFolders(all, 'demo', nameOf, '/u/me')).toEqual(['/u/me/demo-time']);
    expect(filterFolders(all, '~/sw', nameOf, '/u/me')).toEqual(['/u/me/switchboard']);
    // A typed path is no longer offered here: path mode lists real folders instead (pathInput.ts).
    expect(filterFolders(all, '/tmp/x/', nameOf, '/u/me')).toEqual([]);
  });

  it('list the sessions to pick up: waiting and working first, archived ones left out', () => {
    const rows = [
      row('old', { updatedAt: NOW - 30 * HOUR }),
      row('new', { updatedAt: NOW - HOUR }),
      row('working', { live: live('running'), updatedAt: NOW - 5 * HOUR }),
      row('waiting', { live: live('needs-you'), updatedAt: NOW - 9 * HOUR }),
      row('archived', { archivedAt: NOW, updatedAt: NOW - 2 * HOUR }),
      row('elsewhere', { projectRoot: '/p/b' }),
    ];
    expect(pickUpRows(rows, '/p/a', NOW, 2).map((r) => r.id)).toEqual(['waiting', 'working', 'new', 'old']);
    expect(pickUpRows(rows, '/p/a', NOW, 2, 2).map((r) => r.id)).toEqual(['waiting', 'working']);
  });

  it('remember the branch of each folder\'s latest session, not its worktrees', () => {
    const summary = (projectRoot: string, updatedAt: number, gitBranch: string | null, worktree = false) =>
      ({ projectRoot, updatedAt, gitBranch, worktree: worktree ? { branch: 'wt' } : null }) as unknown as SessionSummary;
    const branches = latestBranches([summary('/a', 1, 'main'), summary('/a', 3, 'feature'), summary('/a', 5, 'wt', true), summary('/b', 1, 'HEAD')]);
    expect(branches.get('/a')).toBe('feature');
    expect(branches.get('/b')).toBe(null);
  });
});
