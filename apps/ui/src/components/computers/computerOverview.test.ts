import { describe, expect, it } from 'vitest';
import type { RemotePrompt, RemoteSession, RemoteSessions } from '@seshboard/protocol/client';
import { computerOverview, overviewSummary, versionText } from './computerOverview.ts';

const MIN = 60_000;
const NOW = new Date(2026, 10, 3, 15, 0).getTime();

const session = (id: string, status: RemoteSession['status'], extra: Partial<RemoteSession> = {}): RemoteSession => ({
  id,
  title: `Session ${id}`,
  projectId: 'p1',
  projectName: 'tideline',
  branch: 'main',
  status,
  updatedAt: NOW - MIN,
  unread: false,
  pinned: false,
  model: null,
  permissionMode: null,
  profile: null,
  ...extra,
});

const prompt = (requestId: string, sessionId: string, createdAt: number): RemotePrompt => ({
  requestId,
  sessionId,
  toolName: 'Bash',
  input: { command: 'npm test' },
  title: null,
  description: null,
  alwaysLabel: null,
  createdAt,
});

const list = (sessions: RemoteSession[], prompts: RemotePrompt[] = []): RemoteSessions => ({ sessions, prompts });
const everyone = { mineHere: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'w1', 'w2'] };

describe('computerOverview', () => {
  it('puts the longest wait first, with each session’s prompts oldest first', () => {
    const overview = computerOverview(
      list([session('a', 'idle'), session('b', 'needs-you', { updatedAt: NOW - 30 * MIN }), session('c', 'idle')], [prompt('r2', 'a', NOW - 2 * MIN), prompt('r1', 'a', NOW - 5 * MIN), prompt('r3', 'c', NOW - 10 * MIN)]),
      everyone,
      'all',
    );
    expect(overview.needs.map((w) => w.session.id)).toEqual(['b', 'c', 'a']);
    expect(overview.needs.find((w) => w.session.id === 'a')?.prompts.map((p) => p.requestId)).toEqual(['r1', 'r2']);
    expect(overview.recent).toEqual([]);
  });

  it('lists what works, the one set going last first, with background tasks', () => {
    const overview = computerOverview(
      list([
        session('w1', 'working', { workingSince: NOW - 20 * MIN }),
        session('w2', 'working', { workingSince: NOW - 2 * MIN }),
        // Its turn ended 5 minutes ago, and a task it started still runs.
        session('g', 'idle', { updatedAt: NOW - 5 * MIN, background: [{ taskId: 't', type: 'local_bash', description: 'npm run dev', startedAt: NOW - 6 * MIN }] }),
      ]),
      everyone,
      'all',
    );
    expect(overview.working.map((s) => s.id)).toEqual(['w2', 'g', 'w1']);
  });

  it('groups the newest recent sessions by project, leaves pipeline steps out and counts the rest', () => {
    const overview = computerOverview(
      list([
        session('a', 'idle', { updatedAt: NOW - 3 * MIN }),
        session('b', 'unread', { updatedAt: NOW - MIN, projectId: 'p2', projectName: 'harbor-api' }),
        session('c', 'idle', { updatedAt: NOW - 2 * MIN }),
        session('d', 'idle', { updatedAt: NOW - 4 * MIN, parentId: 'a' }),
        session('e', 'idle', { updatedAt: NOW - 9 * MIN }),
      ]),
      everyone,
      'all',
      3,
    );
    expect(overview.recent.map((p) => [p.projectName, p.sessions.map((s) => s.id)])).toEqual([
      ['harbor-api', ['b']],
      ['tideline', ['c', 'a']],
    ]);
    expect(overview.more).toBe(1);
  });

  it('keeps only what is mine with Mine, and counts the others', () => {
    const overview = computerOverview(list([session('a', 'idle'), session('x', 'idle'), session('y', 'working')], [prompt('r', 'x', NOW)]), { mineHere: ['a'] }, 'mine');
    expect(overview.recent.flatMap((p) => p.sessions.map((s) => s.id))).toEqual(['a']);
    expect(overview.needs).toEqual([]);
    expect(overview.working).toEqual([]);
    expect(overview.fromOthers).toBe(2);
  });
});

describe('overviewSummary', () => {
  const w = (n: number) => Array.from({ length: n }, (_, i) => session(String(i), 'working'));
  it('says what needs you and what works', () => {
    expect(overviewSummary({ needs: w(2).map((s) => ({ session: s, prompts: [] })), working: w(1) }, 'mystic')).toBe('2 sessions need you, 1 is working.');
    expect(overviewSummary({ needs: w(1).map((s) => ({ session: s, prompts: [] })), working: [] }, 'mystic')).toBe('1 session needs you.');
    expect(overviewSummary({ needs: [], working: w(3) }, 'mystic')).toBe('3 sessions are working on mystic. Nothing needs you.');
    expect(overviewSummary({ needs: [], working: [] }, 'mystic')).toBe('Nothing needs you on mystic.');
  });

  it('names the version once the computer said it', () => {
    expect(versionText({ version: '0.9.1' })).toBe('Seshboard 0.9.1');
    expect(versionText({ version: null })).toBeNull();
  });
});
