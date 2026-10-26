import { describe, expect, it } from 'vitest';
import type { RemotePrompt, RemoteRunState, RemoteSession } from '@seshboard/protocol/remote-client';
import { mergeSessions } from './everywhere.ts';
import { childLine, listTree, runOfRow, runsOf, treeLine } from './runs.ts';

const session = (id: string, over: Partial<RemoteSession> = {}): RemoteSession => ({ id, title: id, projectId: 'p', projectName: 'tideline', branch: null, status: 'idle', unread: false, updatedAt: 1, parentId: null, ...over }) as RemoteSession;
const prompt = (requestId: string, sessionId: string, toolName = 'Bash'): RemotePrompt => ({ requestId, sessionId, toolName, input: {}, title: null, description: null, alwaysLabel: null, createdAt: 1 }) as RemotePrompt;

const claude = (name: string, model: string) => ({ kind: 'claude' as const, name, start: 'fresh' as const, model, effort: null, permissionMode: null, readOnly: false, prompt: '', actionsFirst: [], verdict: null, confirmBefore: false, approvePlan: false });

/** A run of Plan, Execute and Push from `parent` (null: a run row), at Execute. */
function run(id: string, parent: string | null, over: Partial<RemoteRunState['run']> = {}): RemoteRunState {
  return {
    run: {
      id,
      pipelineId: 'pl',
      pipeline: { id: 'pl', name: 'Plan and build', builtIn: false, autoPush: false, createdAt: 1, updatedAt: 1, steps: [claude('Plan', 'opus'), claude('Execute', 'sonnet'), { kind: 'push', name: 'Push', draft: false }] },
      parentSessionId: parent,
      task: parent ? null : 'Add a toggle',
      title: 'Add a toggle',
      projectId: 'p',
      projectName: 'tideline',
      worktree: true,
      status: 'running',
      reason: null,
      waitingFor: null,
      hold: null,
      step: 1,
      round: 1,
      sentBackTo: null,
      pr: null,
      unattended: false,
      createdAt: 1,
      updatedAt: 1,
      endedAt: null,
      archivedAt: null,
      restoredAt: null,
      ...over,
    },
    steps: [
      { runId: id, step: 'Plan', index: 0, round: 1, sessionId: `${id}-plan`, status: 'done', outcome: 'clean', verdict: null, reason: 'plan approved', startedAt: 1, endedAt: 2 },
      { runId: id, step: 'Execute', index: 1, round: 1, sessionId: `${id}-execute`, status: 'working', outcome: null, verdict: null, reason: null, startedAt: 2, endedAt: null },
    ],
  };
}

describe('runs in the list', () => {
  it('puts sub-sessions under their parent in step order, per computer, and lifts the parent', () => {
    const merged = mergeSessions([
      {
        id: 'aa',
        sessions: {
          sessions: [session('parent', { updatedAt: 5 }), session('r1-execute', { parentId: 'parent', status: 'needs-you', updatedAt: 9 }), session('r1-plan', { parentId: 'parent', updatedAt: 3 }), session('alone')],
          prompts: [prompt('q1', 'r1-execute', 'AskUserQuestion')],
          runs: [run('r1', 'parent')],
        },
      },
      // The same ids on another computer stay apart.
      { id: 'bb', sessions: { sessions: [session('parent')], prompts: [] } },
    ]);
    const tree = listTree(merged.sessions, merged.runs);
    expect(tree.roots.map((s) => s.id)).toEqual(['aa:parent', 'aa:alone', 'bb:parent']);
    expect(tree.children.get('aa:parent')?.map((s) => s.id)).toEqual(['aa:r1-plan', 'aa:r1-execute']);
    expect(tree.children.has('bb:parent')).toBe(false);
    // A step that asks makes its parent Needs you, at the time of its news.
    expect(tree.roots[0]).toMatchObject({ status: 'needs-you', updatedAt: 9 });
    const parentRun = runOfRow(merged.runs, tree.roots[0]!);
    expect(treeLine(tree.roots[0]!, parentRun, tree.children.get('aa:parent')!, merged.prompts)).toBe('Needs you · r1-execute asks a question');
    expect(childLine(merged.runs, tree.children.get('aa:parent')![0]!)).toEqual({ tone: 'done', line: 'Opus · plan approved' });
    expect(childLine(merged.runs, tree.children.get('aa:parent')![1]!)).toMatchObject({ tone: 'needs-you' });
  });

  it('lists a run started from New session as a row of its own, with its steps under it', () => {
    const merged = mergeSessions([{ id: 'aa', sessions: { sessions: [session('row-plan', { parentId: 'row' })], prompts: [], runs: [run('row', null, { status: 'waiting', waitingFor: 'push', reason: 'Push waits for you.' })] } }]);
    expect(merged.sessions.find((s) => s.runRow)).toMatchObject({ id: 'aa:row', sessionId: 'row', status: 'needs-you', title: 'Add a toggle' });
    const tree = listTree(merged.sessions, merged.runs);
    expect(tree.roots.map((s) => s.id)).toEqual(['aa:row']);
    expect(tree.children.get('aa:row')?.map((s) => s.id)).toEqual(['aa:row-plan']);
    expect(treeLine(tree.roots[0]!, runOfRow(merged.runs, tree.roots[0]!), tree.children.get('aa:row')!, [])).toBe('Needs you · Push waits for you');
  });

  it('says where a run is on its parent and its run row, and nothing once a parent’s run is over', () => {
    const merged = mergeSessions([{ id: 'aa', sessions: { sessions: [session('parent')], prompts: [], runs: [run('r1', 'parent'), run('row', null)] } }]);
    const [parent, row] = [merged.sessions.find((s) => s.id === 'aa:parent')!, merged.sessions.find((s) => s.runRow)!];
    expect(treeLine(parent, runOfRow(merged.runs, parent), [], [])).toBe('Execute · 2 of 3 · tideline');
    expect(treeLine(row, runOfRow(merged.runs, row), [], [])).toBe('Run · Execute · 2 of 3 · tideline');
    const done = mergeSessions([{ id: 'aa', sessions: { sessions: [session('parent')], prompts: [], runs: [run('r1', 'parent', { status: 'done' })] } }]);
    expect(treeLine(done.sessions[0]!, runOfRow(done.runs, done.sessions[0]!), [], [])).toBeNull();
  });

  it('finds the run a session started and the run a sub-session is a step of', () => {
    const list = { runs: [run('r1', 'parent'), run('row', null)] };
    expect(runsOf(list, 'parent').parent?.run.id).toBe('r1');
    expect(runsOf(list, 'row').parent?.run.id).toBe('row');
    expect(runsOf(list, 'r1-execute')).toMatchObject({ parent: null, step: { index: 1, round: 1, state: { run: { id: 'r1' } } } });
    expect(runsOf({}, 'parent')).toEqual({ parent: null, step: null });
  });
});
