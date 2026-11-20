import { describe, expect, it } from 'vitest';
import type { CatchUp, OrchestratorInfo } from '@seshboard/protocol/client';
import { goToOrchestrator, orchestratorOfWorker, orchestratorRowLine, overviewGroups, projectOrchestrator, workerNote, workerStatus } from './orchestrator.ts';
import type { SessionRowData } from './sessionsStore.ts';

const row = (id: string, over: Partial<SessionRowData> = {}): SessionRowData => ({
  id,
  title: id,
  projectRoot: '/work/app',
  updatedAt: 1,
  branch: `branch-${id}`,
  isWorktree: true,
  live: null,
  summary: null,
  pinned: false,
  archivedAt: null,
  restoredAt: null,
  unread: false,
  inApp: true,
  error: false,
  profileId: 'default',
  ...over,
});
const live = (status: 'running' | 'needs-you' | 'idle') => ({ status }) as SessionRowData['live'];
const card = (state: CatchUp['state'], did: string[], need = '') => ({ state, did, need: { title: need, text: need } }) as unknown as CatchUp;

const info: OrchestratorInfo = {
  sessionId: 'orc',
  projectRoot: '/work/app',
  createdAt: 10,
  workers: [
    { sessionId: 'a', itemId: null, title: 'Fix login', startedAt: 1 },
    { sessionId: 'b', itemId: null, title: 'Lint config', startedAt: 2, pr: { number: 152, url: 'https://github.com/o/r/pull/152', state: 'open' } },
    { sessionId: 'c', itemId: null, title: 'Update docs', startedAt: 3 },
    { sessionId: null, itemId: 'item-1', title: 'Flaky test', startedAt: 4 },
    { sessionId: 'not-listed-yet', itemId: null, title: 'Just started', startedAt: 5 },
  ],
};

describe('overviewGroups', () => {
  const rows = new Map([row('a', { live: live('running') }), row('b', { unread: true }), row('c', { live: live('needs-you') })].map((r) => [r.id, r]));
  const cards = new Map([
    ['b', card('finished', ['Changed the lint config'])],
    ['c', card('waiting', [], 'Approve the plan')],
  ]);
  const groups = overviewGroups(info, rows, cards);

  it('groups the sessions by what needs you first', () => {
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.title)])).toEqual([
      ['Waiting on you', ['Update docs']],
      ['Working', ['Fix login']],
      ['Queued', ['Flaky test']],
      ['Ready for review', ['Lint config']],
      ['Idle', ['Just started']],
    ]);
  });

  it('says what each waits for or did, and its branch', () => {
    const byTitle = new Map(groups.flatMap((g) => g.rows).map((r) => [r.title, r]));
    expect(byTitle.get('Update docs')).toMatchObject({ note: 'Approve the plan', branch: 'branch-c' });
    expect(byTitle.get('Lint config')).toMatchObject({ note: 'Changed the lint config' });
    expect(byTitle.get('Fix login')).toMatchObject({ note: null });
    expect(byTitle.get('Flaky test')).toMatchObject({ note: 'Starts when a slot is free', branch: null });
  });
});

describe('the orchestrator of a session and a project', () => {
  it('reads a row’s state in the overview’s words', () => {
    expect(workerStatus(row('a', { live: live('running') }))).toBe('working');
    expect(workerStatus(row('a', { error: true }))).toBe('failed');
    expect(workerStatus(row('a'))).toBe('idle');
    expect(workerStatus(undefined)).toBeNull();
    expect(workerNote('working', card('finished', ['Old news']))).toBeNull();
  });

  it('finds who started a session, and a project’s newest orchestrator that is still listed', () => {
    const older = { ...info, sessionId: 'old', createdAt: 1, workers: [] };
    expect(orchestratorOfWorker([older, info], 'b')?.sessionId).toBe('orc');
    expect(orchestratorOfWorker([older, info], 'orc')).toBeNull();
    expect(projectOrchestrator([older, info], '/work/app', () => true)?.sessionId).toBe('orc');
    expect(projectOrchestrator([older, info], '/work/app', (id) => id === 'old')?.sessionId).toBe('old');
    expect(projectOrchestrator([info], '/work/other', () => true)).toBeNull();
    expect(projectOrchestrator([info], null, () => true)).toBeNull();
  });

  it('goes to the open session’s project’s orchestrator, or the newest one, never to itself', () => {
    const other = { ...info, sessionId: 'other', projectRoot: '/work/site', createdAt: 99, workers: [] };
    expect(goToOrchestrator([info, other], { id: 'a', projectRoot: '/work/app' }, () => true)).toBe('orc');
    expect(goToOrchestrator([info, other], { id: 'orc', projectRoot: '/work/app' }, () => true)).toBeNull();
    expect(goToOrchestrator([info, other], null, () => true)).toBe('other');
    expect(goToOrchestrator([info], { id: 'x', projectRoot: '/work/none' }, () => true)).toBeNull();
  });

  it('says what an orchestrator is on its row', () => {
    expect(orchestratorRowLine(0, 'app')).toBe('Orchestrator · no sessions yet · app');
    expect(orchestratorRowLine(1, null)).toBe('Orchestrator · 1 session');
    expect(orchestratorRowLine(3, 'app')).toBe('Orchestrator · 3 sessions · app');
  });
});
