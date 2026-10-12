import { describe, expect, it } from 'vitest';
import type { LiveSession, SessionSummary } from '@switchboard/protocol/client';
import type { SessionRowData } from '../../state/sessionsStore.ts';
import { activityByProject, filterFolders, latestBranches, orderProjects, pickUpRows, quickTiles, recentFirst, tileStatus } from './projectTiles.ts';

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
    expect(quickTiles(recent, '/b')).toEqual(['/a', '/b', '/c', '/d']);
    expect(quickTiles(recent, '/e')).toEqual(['/a', '/b', '/c', '/e']);
    expect(quickTiles(recent, '/elsewhere')).toEqual(['/a', '/b', '/c', '/elsewhere']);
    expect(quickTiles(recent, null)).toEqual(['/a', '/b', '/c', '/d']);
  });

  it('filter by name or path, and offer a typed path', () => {
    const names = new Map([['/u/me/switchboard', 'Switchboard'], ['/u/me/demo-time', 'Demo Time']]);
    const nameOf = (root: string) => names.get(root) ?? root;
    const all = [...names.keys()];
    expect(filterFolders(all, '', nameOf, '/u/me')).toEqual(all);
    expect(filterFolders(all, 'demo', nameOf, '/u/me')).toEqual(['/u/me/demo-time']);
    expect(filterFolders(all, '/tmp/x/', nameOf, '/u/me')).toEqual(['/tmp/x']);
    // Windows: a drive path is a typed path too; its root keeps the separator after the drive letter.
    expect(filterFolders(all, 'E:\\repos\\app\\', nameOf, '/u/me')).toEqual(['E:\\repos\\app']);
    expect(filterFolders(all, 'E:\\', nameOf, '/u/me')).toEqual(['E:\\']);
    expect(filterFolders(all, 'E:/', nameOf, '/u/me')).toEqual(['E:/']);
    expect(filterFolders(all, 'E:/repos/', nameOf, '/u/me')).toEqual(['E:/repos']);
    expect(filterFolders(all, 'repos\\app', nameOf, '/u/me')).toEqual([]);
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
    expect(pickUpRows(rows, '/p/a', NOW).map((r) => r.id)).toEqual(['waiting', 'working', 'new', 'old']);
    expect(pickUpRows(rows, '/p/a', NOW, 2).map((r) => r.id)).toEqual(['waiting', 'working']);
  });

  it('remember the branch of each folder\'s latest session, not its worktrees', () => {
    const summary = (projectRoot: string, updatedAt: number, gitBranch: string | null, worktree = false) =>
      ({ projectRoot, updatedAt, gitBranch, worktree: worktree ? { branch: 'wt' } : null }) as unknown as SessionSummary;
    const branches = latestBranches([summary('/a', 1, 'main'), summary('/a', 3, 'feature'), summary('/a', 5, 'wt', true), summary('/b', 1, 'HEAD')]);
    expect(branches.get('/a')).toBe('feature');
    expect(branches.get('/b')).toBe(null);
  });
});
