import { describe, expect, it } from 'vitest';
import type { RemoteSession } from '@switchboard/protocol/remote-client';
import { age, groupSessions, homeHeadline, nextNeedsYou, projectStatus, recentProjects, startOfDay, suggestedProject, toReview } from './groups.ts';

const NOW = new Date(2026, 9, 15, 14, 0).getTime();
const HOUR = 3_600_000;
const session = (id: string, status: RemoteSession['status'], updatedAt: number, projectId = 'aaaaaaaaaaaaaaaa'): RemoteSession => ({ id, title: id, projectId, projectName: 'Web', branch: null, status, updatedAt, unread: status === 'unread', pinned: false, model: null, permissionMode: null, profile: null });

describe('groupSessions', () => {
  it('puts what needs you and what works first, then the rest by calendar day, newest first', () => {
    const today = startOfDay(NOW);
    const groups = groupSessions(
      [
        session('old', 'idle', today - 3 * 24 * HOUR),
        session('morning', 'unread', today + HOUR),
        session('noon', 'idle', today + 4 * HOUR),
        session('last-night', 'idle', today - HOUR),
        session('asks', 'needs-you', today - 5 * 24 * HOUR),
        session('busy', 'working', today),
      ],
      NOW,
    );
    expect(groups.map((g) => [g.group, g.sessions.map((s) => s.id)])).toEqual([
      ['needs-you', ['asks']],
      ['working', ['busy']],
      ['today', ['noon', 'morning']],
      ['yesterday', ['last-night']],
      ['earlier', ['old']],
    ]);
  });

  it('leaves out empty sections', () => {
    expect(groupSessions([session('a', 'idle', NOW)], NOW).map((g) => g.group)).toEqual(['today']);
    expect(groupSessions([], NOW)).toEqual([]);
  });
});

describe('projectStatus', () => {
  const p = 'bbbbbbbbbbbbbbbb';
  it('says how many need you first, then how many work, else how long it has been quiet', () => {
    expect(projectStatus(p, [session('a', 'needs-you', NOW, p), session('b', 'needs-you', NOW, p), session('c', 'working', NOW, p)], NOW)).toEqual({ tone: 'needs-you', label: '2 needs you' });
    expect(projectStatus(p, [session('c', 'working', NOW, p)], NOW)).toEqual({ tone: 'working', label: '1 working' });
    expect(projectStatus(p, [session('d', 'idle', NOW - 2 * HOUR, p), session('e', 'needs-you', NOW, 'other')], NOW)).toEqual({ tone: 'idle', label: 'Idle · 2h' });
    expect(projectStatus(p, [], NOW)).toEqual({ tone: 'idle', label: 'No recent sessions' });
  });
});

describe('age', () => {
  it('is short', () => {
    expect([age(NOW, NOW), age(NOW - 5 * 60_000, NOW), age(NOW - 3 * HOUR, NOW), age(NOW - 50 * HOUR, NOW)]).toEqual(['now', '5m', '3h', '2d']);
  });
});

describe('recentProjects', () => {
  it('puts projects with the newest session first and keeps the order of the others', () => {
    const projects = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const sessions = [session('1', 'idle', NOW - 2 * HOUR, 'c'), session('2', 'idle', NOW - HOUR, 'b'), session('3', 'idle', NOW - 3 * HOUR, 'b')];
    expect(recentProjects(projects, sessions).map((p) => p.id)).toEqual(['b', 'c', 'a', 'd']);
  });
});

describe('suggestedProject', () => {
  const projects = [{ id: 'a' }, { id: 'b' }];
  it('takes the project last used from this device', () => {
    expect(suggestedProject(projects, [session('1', 'idle', NOW, 'b')], 'a')).toBe('a');
  });
  it('falls back to the project with the newest session when the last one is gone', () => {
    expect(suggestedProject(projects, [session('1', 'idle', NOW, 'b')], 'removed')).toBe('b');
  });
  it('takes the only project', () => {
    expect(suggestedProject([{ id: 'a' }], [], null)).toBe('a');
  });
  it('picks nothing without anything to go on', () => {
    expect(suggestedProject(projects, [], null)).toBeNull();
  });
});

describe('homeHeadline', () => {
  it('says what needs you, what works and what finished today', () => {
    const today = startOfDay(NOW);
    expect(homeHeadline([session('a', 'needs-you', today), session('b', 'needs-you', today), session('c', 'working', today), session('d', 'unread', today + HOUR), session('e', 'idle', today + 2 * HOUR), session('f', 'idle', today - HOUR)], NOW)).toEqual({
      title: '2 sessions need you',
      counts: '1 working · 2 finished today',
    });
    expect(homeHeadline([session('a', 'needs-you', today)], NOW).title).toBe('1 session needs you');
    expect(homeHeadline([session('e', 'idle', today - HOUR)], NOW)).toEqual({ title: 'Nothing needs you', counts: '' });
  });
});

describe('toReview', () => {
  it('lists unread finished sessions, newest first', () => {
    expect(toReview([session('a', 'unread', 1), session('b', 'idle', 3), session('c', 'unread', 2)]).map((s) => s.id)).toEqual(['c', 'a']);
    expect(toReview([session('a', 'unread', 1), session('c', 'unread', 2)], 1).map((s) => s.id)).toEqual(['c']);
  });
});

describe('nextNeedsYou', () => {
  it('goes through what waits for you (longest first), then what you haven\'t read, and round again', () => {
    const list = {
      sessions: [session('late', 'needs-you', 9), session('early', 'needs-you', 9), session('done', 'unread', 5), session('quiet', 'idle', 7)],
      prompts: [
        { sessionId: 'late', createdAt: 8 },
        { sessionId: 'early', createdAt: 2 },
      ],
    };
    expect(nextNeedsYou(list, null)).toBe('early');
    expect(nextNeedsYou(list, 'early')).toBe('late');
    expect(nextNeedsYou(list, 'late')).toBe('done');
    expect(nextNeedsYou(list, 'done')).toBe('early');
    expect(nextNeedsYou(list, 'quiet')).toBe('early');
    expect(nextNeedsYou({ sessions: [session('quiet', 'idle', 7)], prompts: [] }, null)).toBeNull();
  });
});
