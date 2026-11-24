import { describe, expect, it } from 'vitest';
import { remoteOrchestratorOf, remoteOrchestratorOfWorker, remoteOverview } from './remoteOrchestrator.ts';

const worker = (sessionId: string | null, title: string, startedAt: number, pr: { number: number; url: string; state: 'open' | 'merged' | 'closed' } | null = null) => ({ sessionId, itemId: sessionId ? null : `item-${title}`, title, startedAt, pr });

describe('the orchestrator overview from the list', () => {
  const orchestrator = {
    sessionId: 'orch',
    createdAt: 1,
    workers: [
      worker('a', 'Fix login', 1),
      worker('b', 'Add tests', 2),
      worker(null, 'Write docs', 3),
      worker('c', 'Refactor', 4, { number: 12, url: 'https://github.com/acme/web/pull/12', state: 'open' }),
      worker('gone', 'Old task', 5),
      worker('d', 'Failing one', 6),
    ],
  };
  const sessions = [
    { id: 'a', status: 'needs-you' as const, branch: 'fix-login' },
    { id: 'b', status: 'working' as const, branch: 'add-tests' },
    { id: 'c', status: 'idle' as const, branch: 'refactor' },
    { id: 'd', status: 'error' as const, branch: null },
  ];

  it('groups what needs you first, with the branch and what it asks', () => {
    const groups = remoteOverview(orchestrator, sessions, [{ sessionId: 'a', title: 'Allow Bash: npm test' }]);
    expect(groups.map((g) => [g.state, g.rows.map((r) => r.title)])).toEqual([
      ['waiting', ['Failing one', 'Fix login']],
      ['working', ['Add tests']],
      ['queued', ['Write docs']],
      ['review', ['Refactor']],
      ['idle', ['Old task']],
    ]);
    expect(groups[0]!.rows[1]).toMatchObject({ branch: 'fix-login', note: 'Allow Bash: npm test' });
    expect(groups[2]!.rows[0]!.note).toBe('Starts when a slot is free');
    // A session the list no longer has: idle, without a branch.
    expect(groups[4]!.rows[0]).toMatchObject({ branch: null, note: null });
  });

  it('is empty before the orchestrator starts a session', () => {
    expect(remoteOverview({ workers: [] }, sessions)).toEqual([]);
  });

  it('finds an orchestrator by its session, and the one that started a session', () => {
    expect(remoteOrchestratorOf([orchestrator], 'orch')).toBe(orchestrator);
    expect(remoteOrchestratorOf([orchestrator], 'a')).toBeNull();
    expect(remoteOrchestratorOf(undefined, 'orch')).toBeNull();
    expect(remoteOrchestratorOfWorker([orchestrator], 'b')).toBe(orchestrator);
    expect(remoteOrchestratorOfWorker([orchestrator], 'orch')).toBeNull();
  });
});
