import { describe, expect, it } from 'vitest';
import { BUILT_IN_PIPELINES, type LiveSession, type PipelineRunState, type SessionSummary } from '@switchboard/protocol/client';
import { asksWords, childTone, parentRunLine, pipelinesRunning, runRowLine, sidebarForest, stepMeta, treeNeedsYouLine } from './pipelineTree.ts';
import type { SessionRowData } from './sessionsStore.ts';
import { buildListRows, buildSessionList, groupSessions, isActive, rowStatus } from './sidebarRows.ts';
import { sidebarGroups } from './sidebarOrder.ts';

const NOW = new Date(2026, 9, 20, 15, 0).getTime();
const HOUR = 3_600_000;
const pipeline = { ...BUILT_IN_PIPELINES[0]!, builtIn: true, createdAt: 0, updatedAt: 0 };

const row = (id: string, over: Partial<SessionRowData> = {}, parentId: string | null = null): SessionRowData => ({
  id,
  title: id,
  projectRoot: '/work/app',
  updatedAt: NOW - HOUR,
  branch: null,
  isWorktree: false,
  live: null,
  summary: { parentId, createdAt: NOW - 2 * HOUR } as SessionSummary,
  pinned: false,
  archivedAt: null,
  restoredAt: null,
  unread: false,
  inApp: true,
  error: false,
  profileId: 'default',
  ...over,
});
const live = (status: LiveSession['status']) => ({ status, origin: 'app' }) as LiveSession;

const run = (over: Partial<PipelineRunState['run']> = {}, steps: Array<Partial<PipelineRunState['steps'][number]>> = []): PipelineRunState => ({
  run: { id: 'run-1', pipelineId: pipeline.id, pipeline, parentSessionId: 'parent', task: null, title: 'Add a usage cost toggle', projectRoot: '/work/app', cwd: '/work/app', profileId: null, status: 'running', reason: null, waitingFor: null, hold: null, step: 0, round: 1, sentBackTo: null, pr: null, createdAt: NOW - HOUR, updatedAt: NOW - HOUR, endedAt: null, archivedAt: null, restoredAt: null, ...over },
  steps: steps.map((s) => ({ runId: over.id ?? 'run-1', step: 'Plan', index: 0, round: 1, sessionId: null, status: 'done', outcome: 'clean', verdict: null, reason: null, plan: null, actions: [], startedAt: 0, endedAt: null, ...s })),
});

const ids = (rows: readonly SessionRowData[]) => rows.map((r) => r.id);

describe('sidebarForest', () => {
  it('nests sub-sessions under their parent in step order, and keeps them out of the top level', () => {
    const state = run({}, [
      { step: 'Plan', index: 0, sessionId: 'plan' },
      { step: 'Execute', index: 1, sessionId: 'exec' },
      { step: 'Validate', index: 2, sessionId: 'val' },
      { step: 'Execute', index: 1, round: 2, sessionId: 'exec2' },
    ]);
    const rows = [row('val', {}, 'parent'), row('exec2', {}, 'parent'), row('parent'), row('plan', {}, 'parent'), row('exec', {}, 'parent'), row('other')];
    const forest = sidebarForest(rows, [state], NOW);
    expect(ids(forest.roots)).toEqual(['parent', 'other']);
    expect(ids(forest.children.get('parent')!)).toEqual(['plan', 'exec', 'exec2', 'val']);
    expect(forest.parentOf.get('val')).toBe('parent');
  });

  it('shows a child on its own when its parent is not listed', () => {
    const forest = sidebarForest([row('orphan', {}, 'gone'), row('a')], [], NOW);
    expect(ids(forest.roots)).toEqual(['orphan', 'a']);
  });

  it('lifts a parent to the most urgent state of its children, which puts it in Needs you', () => {
    const rows = [row('parent'), row('exec', { live: live('needs-you') }, 'parent'), row('val', { live: live('running') }, 'parent')];
    const forest = sidebarForest(rows, [], NOW);
    const parent = forest.roots[0]!;
    expect(rowStatus(parent)).toBe('needs-you');
    expect(groupSessions(forest.roots, NOW)[0]).toMatchObject({ group: 'needs-you' });
    // The child itself is unchanged.
    expect(rowStatus(forest.children.get('parent')![1]!)).toBe('running');
  });

  it('counts the run waiting for you (Push, a stop) even with no child asking', () => {
    const forest = sidebarForest([row('parent'), row('plan', {}, 'parent')], [run({ status: 'waiting', waitingFor: 'push', step: 3 })], NOW);
    expect(rowStatus(forest.roots[0]!)).toBe('needs-you');
    const working = sidebarForest([row('parent')], [run({ status: 'running' })], NOW);
    expect(rowStatus(working.roots[0]!)).toBe('running');
  });

  it('keeps a parent with an old, idle tree in the main list while a child works', () => {
    const oldParent = row('parent', { updatedAt: NOW - 30 * 24 * HOUR });
    const forest = sidebarForest([oldParent, row('exec', { live: live('running') }, 'parent')], [], NOW);
    expect(isActive(oldParent, NOW, 2)).toBe(false);
    expect(isActive(forest.roots[0]!, NOW, 2)).toBe(true);
  });

  it('adds run rows with their sub-sessions under them, and archives a quiet one as a tree', () => {
    const active = run({ id: 'run-a', parentSessionId: null, title: 'Add dark mode' }, [{ step: 'Plan', index: 0, sessionId: 'plan', status: 'working' }]);
    const recent = run({ id: 'run-b', parentSessionId: null, status: 'done', endedAt: NOW - 2 * HOUR });
    const stale = run({ id: 'run-c', parentSessionId: null, status: 'stopped', endedAt: NOW - 30 * HOUR, updatedAt: NOW - 30 * HOUR });
    const rows = [row('plan', { live: live('running') }, 'run-a'), row('late', { updatedAt: NOW - 30 * HOUR }, 'run-c')];
    const forest = sidebarForest(rows, [active, recent, stale], NOW, 1);
    expect(ids(forest.roots)).toEqual(['run-a', 'run-b', 'run-c']);
    expect(ids(forest.children.get('run-a')!)).toEqual(['plan']);
    expect(ids(forest.children.get('run-c')!)).toEqual(['late']);
    const runRow = forest.roots.find((r) => r.id === 'run-a')!;
    expect(runRow).toMatchObject({ title: 'Add dark mode', projectRoot: '/work/app', summary: null });
    expect(rowStatus(runRow)).toBe('running');
    expect(isActive(runRow, NOW, 1)).toBe(true);
    // Quiet for longer than the archive days: the stale run row goes to Archived, with its sub-session under it.
    const { active: up, archived } = buildSessionList(forest.roots, { search: '', project: null, now: NOW, archiveAfterDays: 1, children: forest.children });
    expect(ids(up)).toEqual(['run-a', 'run-b']);
    expect(ids(archived)).toEqual(['run-c']);
  });

  it('auto-archives a tree by its newest activity, never while its run goes on', () => {
    const old = NOW - 5 * 24 * HOUR;
    const parent = row('parent', { updatedAt: old });
    // A sub-session written to an hour ago keeps the whole tree up.
    const fresh = sidebarForest([parent, row('exec', { updatedAt: old }, 'parent'), row('val', {}, 'parent')], [run({ status: 'stopped' })], NOW, 2);
    expect(isActive(fresh.roots[0]!, NOW, 2)).toBe(true);
    expect(ids(fresh.children.get('parent')!)).toEqual(['exec', 'val']);
    // Quiet everywhere: the parent goes, its sub-sessions with it.
    const quiet = sidebarForest([parent, row('exec', { updatedAt: old }, 'parent')], [run({ status: 'done' })], NOW, 2);
    expect(isActive(quiet.roots[0]!, NOW, 2)).toBe(false);
    expect(ids(quiet.children.get('parent')!)).toEqual(['exec']);
    // A run that waits for you keeps a quiet tree up.
    const waiting = sidebarForest([parent, row('exec', { updatedAt: old }, 'parent')], [run({ status: 'waiting', waitingFor: 'push', updatedAt: old })], NOW, 2);
    expect(isActive(waiting.roots[0]!, NOW, 2)).toBe(true);
  });

  it('archives and unarchives a tree together, and lets one sub-session leave it', () => {
    const at = NOW - 10 * 60_000;
    const archivedTree = sidebarForest([row('parent', { archivedAt: at }), row('exec', { archivedAt: at }, 'parent'), row('val', { archivedAt: at }, 'parent')], [run({ status: 'stopped' })], NOW, 2);
    expect(ids(archivedTree.roots)).toEqual(['parent']);
    expect(isActive(archivedTree.roots[0]!, NOW, 2)).toBe(false);
    expect(ids(archivedTree.children.get('parent')!)).toEqual(['exec', 'val']);
    const restored = sidebarForest([row('parent', { restoredAt: at }), row('exec', { restoredAt: at }, 'parent'), row('val', { restoredAt: at }, 'parent')], [run({ status: 'stopped' })], NOW, 2);
    expect(isActive(restored.roots[0]!, NOW, 2)).toBe(true);
    expect(ids(restored.children.get('parent')!)).toEqual(['exec', 'val']);
    // One sub-session archived alone: it leaves the tree for Archived; the parent and the other step stay.
    const one = sidebarForest([row('parent'), row('exec', { archivedAt: at }, 'parent'), row('val', {}, 'parent')], [run({ status: 'stopped' })], NOW, 2);
    expect(ids(one.roots)).toEqual(['parent', 'exec']);
    expect(ids(one.children.get('parent')!)).toEqual(['val']);
    const { active, archived } = buildSessionList(one.roots, { search: '', project: null, now: NOW, archiveAfterDays: 2, children: one.children });
    expect([ids(active), ids(archived)]).toEqual([['parent'], ['exec']]);
  });

  it('lets a search find a parent through its sub-sessions', () => {
    const forest = sidebarForest([row('parent'), row('Validate', {}, 'parent')], [], NOW);
    const { active } = buildSessionList(forest.roots, { search: 'valid', project: null, now: NOW, archiveAfterDays: 2, children: forest.children });
    expect(ids(active)).toEqual(['parent']);
  });
});

describe('the tree in the list', () => {
  const forest = sidebarForest([row('parent'), row('plan', {}, 'parent'), row('exec', {}, 'parent'), row('solo')], [], NOW);

  it('lists a parent closed by default, and its sub-sessions under it once open', () => {
    const closed = buildListRows(forest.roots, [], { now: NOW, archivedOpen: false, children: forest.children });
    const sessions = closed.filter((r) => r.kind === 'session');
    expect(sessions.map((r) => r.kind === 'session' && r.data.id)).toEqual(['parent', 'solo']);
    expect(sessions[0]).toMatchObject({ parent: { open: false, count: 2 } });
    expect(sessions[1]).not.toHaveProperty('parent');

    const open = buildListRows(forest.roots, [], { now: NOW, archivedOpen: false, children: forest.children, openParents: new Set(['parent']) });
    const rows = open.flatMap((r) => (r.kind === 'session' ? [r] : []));
    expect(rows.map((r) => r.data.id)).toEqual(['parent', 'plan', 'exec', 'solo']);
    expect(rows[1]).toMatchObject({ child: { parentId: 'parent', position: 1, count: 2, level: 2 } });
    expect(rows[2]).toMatchObject({ child: { position: 2 } });
  });

  it('keeps the parent of the open sub-session in a closed section', () => {
    const list = buildListRows(forest.roots, [], { now: NOW, archivedOpen: false, children: forest.children, closed: new Set(['today']), selectedId: 'exec' });
    expect(list.flatMap((r) => (r.kind === 'session' ? [r.data.id] : []))).toEqual(['parent']);
  });

  it('orders ⌃⇥ and ⌘P like the open sidebar: children only under an open parent, none in the rail', () => {
    const rows = [row('parent'), row('plan', {}, 'parent'), row('solo')];
    const flat = (open: ReadonlySet<string>) => sidebarGroups(rows, { now: NOW, archiveAfterDays: 2, runs: [], openParents: open }).flatMap((g) => ids(g.rows));
    expect(flat(new Set())).toEqual(['parent', 'solo']);
    expect(flat(new Set(['parent']))).toEqual(['parent', 'plan', 'solo']);
  });

  it('puts a run row in its group by state', () => {
    const waiting = run({ id: 'run-a', parentSessionId: null, status: 'waiting', waitingFor: 'you', reason: 'Validate has no verdict.' });
    const groups = sidebarGroups([row('solo')], { now: NOW, archiveAfterDays: 2, runs: [waiting], openParents: new Set() });
    expect(groups[0]).toMatchObject({ group: 'needs-you' });
    expect(ids(groups[0]!.rows)).toEqual(['run-a']);
  });
});

describe('the tree in words', () => {
  const state = run({ step: 2, round: 2 }, [
    { step: 'Plan', index: 0, sessionId: 'plan', reason: 'plan approved' },
    { step: 'Execute', index: 1, sessionId: 'exec', status: 'working' },
    { step: 'Validate', index: 2, round: 2, sessionId: 'val', status: 'working' },
    { step: 'Validate', index: 2, sessionId: 'val1', verdict: { kind: 'changes', items: [] } },
  ]);

  it('says the model and state of a sub-session', () => {
    expect(stepMeta(state, state.steps[0]!)).toBe('Opus · plan approved');
    expect(stepMeta(state, state.steps[1]!)).toBe('Sonnet · fork of Plan · working');
    expect(stepMeta(state, state.steps[2]!)).toBe('Opus · read only · working');
    expect(stepMeta(state, state.steps[3]!)).toBe('Opus · changes needed');
  });

  it('says where the run is, on the parent and on a run row', () => {
    expect(parentRunLine(state, 'switchboard')).toBe('Validate · round 2 · 3 of 4 · switchboard');
    expect(runRowLine(run({ parentSessionId: null }), 'switchboard')).toBe('Run · Plan · 1 of 4 · switchboard');
    expect(runRowLine(run({ parentSessionId: null }), null)).toBe('Run · Plan · 1 of 4');
  });

  it('says what a parent waits for', () => {
    expect(treeNeedsYouLine(state, { title: 'Execute', toolName: 'AskUserQuestion' })).toBe('Needs you · Execute asks a question');
    expect(treeNeedsYouLine(run({ status: 'waiting', waitingFor: 'push', step: 3 }), null)).toBe('Needs you · Push waits for you');
    expect(treeNeedsYouLine(run({ status: 'waiting', waitingFor: 'you', reason: 'Validate has no verdict.' }), null)).toBe('Needs you · Validate has no verdict');
    expect(treeNeedsYouLine(null, null)).toBe('Needs you');
    expect(asksWords('Bash')).toBe('asks to use Bash');
    expect(asksWords(null)).toBe('waits for you');
  });

  it('colours a sub-session by its session first, then its step', () => {
    expect(childTone('needs-you', 'done')).toBe('needs-you');
    expect(childTone(null, 'done')).toBe('done');
    // A step the run finished is done, read or not; a session outside a run's steps still shows unread.
    expect(childTone('unread', 'done')).toBe('done');
    expect(childTone('unread', null)).toBe('unread');
    expect(childTone('idle', 'working')).toBe('working');
    expect(childTone(null, null)).toBe('idle');
  });

  it('counts the pipelines running for the footer', () => {
    expect(pipelinesRunning([state, run({ id: 'run-2', status: 'done' })])).toBe('1 pipeline running');
    expect(pipelinesRunning([state, run({ id: 'run-2', status: 'waiting' })])).toBe('2 pipelines running');
    expect(pipelinesRunning([])).toBeNull();
  });
});
