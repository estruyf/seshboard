import { describe, expect, it } from 'vitest';
import type { LiveSession } from '@switchboard/protocol/client';
import type { SessionRowData } from '../../state/sessionsStore.ts';
import { homeSessions, homeSummary, profileActivity, profileActivityLine, projectMeta } from './homeModel.ts';

const live = (status: LiveSession['status']): LiveSession => ({
  sessionId: 'x',
  pid: 1,
  cwd: null,
  projectRoot: '/p',
  status,
  rawStatus: status,
  name: null,
  origin: 'app',
  startedAt: null,
  updatedAt: null,
  profileId: 'default',
});

const row = (id: string, updatedAt: number, status: LiveSession['status'] | null): SessionRowData => ({
  id,
  title: id,
  projectRoot: '/p',
  updatedAt,
  branch: null,
  isWorktree: false,
  live: status ? live(status) : null,
  summary: null,
  pinned: false,
  archivedAt: null,
  restoredAt: null,
  unread: false,
  inApp: true,
  error: false,
  profileId: 'default',
});

describe('home', () => {
  it('lists waiting sessions longest wait first, and working ones newest first', () => {
    const { needs, working } = homeSessions([row('w1', 1, 'running'), row('n1', 5, 'needs-you'), row('w2', 9, 'running'), row('n2', 2, 'needs-you'), row('idle', 3, 'idle'), row('off', 4, null)]);
    expect(needs.map((r) => r.id)).toEqual(['n2', 'n1']);
    expect(working.map((r) => r.id)).toEqual(['w2', 'w1']);
  });

  it('sums up in plain words', () => {
    expect(homeSummary(2, 2)).toBe('2 sessions need you, 2 are working.');
    expect(homeSummary(1, 1)).toBe('1 session needs you, 1 is working.');
    expect(homeSummary(1, 0)).toBe('1 session needs you.');
    expect(homeSummary(0, 3)).toBe('3 sessions are working. Nothing needs you.');
    expect(homeSummary(0, 0)).toBe('Nothing needs you. Start a session, or pick one in the sidebar.');
  });

  it('describes a project tile by branch and open sessions', () => {
    expect(projectMeta('main', 2)).toBe('main · 2 open');
    expect(projectMeta(null, 1)).toBe('1 open');
    expect(projectMeta('main', 0)).toBe('main');
    expect(projectMeta(undefined, 0)).toBe('No sessions open');
  });
});

describe('profileActivity', () => {
  const now = new Date(2026, 9, 6, 15, 0).getTime();
  const yesterday = new Date(2026, 9, 5, 22, 0).getTime();
  const work = (id: string, profileId: string, updatedAt: number, status: LiveSession['status'] | null) => ({ ...row(id, updatedAt, status), profileId });

  it('counts open, working, waiting and today per profile', () => {
    const stats = profileActivity([work('a', 'default', now, 'running'), work('b', 'default', now, 'needs-you'), work('c', 'work', yesterday, 'idle'), work('d', 'work', now, null)], now);
    expect(stats.get('default')).toEqual({ open: 2, working: 1, needs: 1, today: 2 });
    expect(stats.get('work')).toEqual({ open: 1, working: 0, needs: 0, today: 1 });
  });

  it('says it in words, leaving out zeros', () => {
    expect(profileActivityLine({ open: 3, working: 2, needs: 1, today: 5 })).toBe('1 needs you · 2 working · 5 today');
    expect(profileActivityLine({ open: 0, working: 0, needs: 0, today: 0 })).toBe('No sessions today');
    expect(profileActivityLine(undefined)).toBe('No sessions today');
  });
});
