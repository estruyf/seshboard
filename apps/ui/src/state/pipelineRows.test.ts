import { describe, expect, it } from 'vitest';
import { BUILTIN_PIPELINES, type LiveSession, type PipelineRun, type PipelineRunState, type PipelineRunStep, type SessionSummary } from '@switchboard/protocol/client';
import { withPipelines } from './pipelineRows.ts';
import type { SessionRowData } from './sessionsStore.ts';
import { buildListRows, buildSessionList, isActive, rowStatus, withOpenChildren } from './sidebarRows.ts';
import { needsYouPill, sidebarGroups, sidebarOrder } from './sidebarOrder.ts';

const NOW = Date.UTC(2026, 9, 5, 12);
const HOUR = 3_600_000;

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
const live = (status: LiveSession['status']) => ({ status, origin: 'app' }) as LiveSession;

const run = (patch: Partial<PipelineRun> = {}): PipelineRun => ({
  id: 'run1',
  pipelineId: 'plan-execute-validate-push',
  pipeline: { ...BUILTIN_PIPELINES[0]! },
  parentSessionId: 'parent',
  root: '/p/a',
  cwd: '/p/a',
  task: 'Add a toggle\nand test it',
  blanks: {},
  profileId: null,
  state: 'running',
  heldBy: null,
  stepIndex: 1,
  loopTo: null,
  note: null,
  briefSentAt: null,
  createdAt: 1,
  updatedAt: NOW - 1000,
  ...patch,
});
const step = (stepIndex: number, round: number, patch: Partial<PipelineRunStep> = {}): PipelineRunStep => ({
  id: `r${stepIndex}-${round}`,
  runId: 'run1',
  stepIndex,
  stepName: ['Plan', 'Execute', 'Validate', 'Push'][stepIndex] ?? 'Step',
  round,
  sessionId: null,
  state: 'done',
  verdict: null,
  verdictText: null,
  reply: null,
  plan: null,
  startedAt: 1,
  endedAt: 2,
  note: null,
  ...patch,
});
const state = (r: PipelineRun, steps: PipelineRunStep[]): PipelineRunState => ({ run: r, steps });

const parentWithSteps = () => {
  const rows = [row('parent'), row('exec', { parentId: 'parent' }), row('plan', { parentId: 'parent' }), row('other')];
  const runs = [state(run(), [step(0, 1, { sessionId: 'plan' }), step(1, 1, { sessionId: 'exec', state: 'running' })])];
  return { rows, runs };
};

describe('withPipelines', () => {
  it('leaves the rows as they are without a run or a parent', () => {
    const rows = [row('a'), row('b')];
    expect(withPipelines(rows, [])).toBe(rows);
  });

  it('nests sub-sessions under their parent in step order, titled by their step', () => {
    const { rows, runs } = parentWithSteps();
    const out = withPipelines(rows, runs);
    expect(out.map((r) => r.id)).toEqual(['parent', 'other']);
    const parent = out[0]!;
    expect(parent.children!.map((c) => [c.id, c.title, c.depth])).toEqual([
      ['plan', 'Plan', 1],
      ['exec', 'Execute', 1],
    ]);
    expect(parent.children![1]!.step).toEqual({ runId: 'run1', name: 'Execute', number: 2, total: 4, round: 1 });
    expect(parent.pipeline).toMatchObject({ runId: 'run1', progress: 'Execute · 2 of 4', state: 'running' });
  });

  it('keeps the title you gave a sub-session', () => {
    const { rows, runs } = parentWithSteps();
    const named = rows.map((r) => (r.id === 'exec' ? { ...r, title: 'My fix', summary: { customTitle: 'My fix' } as SessionSummary } : r));
    expect(withPipelines(named, runs)[0]!.children!.map((c) => c.title)).toEqual(['Plan', 'My fix']);
  });

  it('puts the parent in Needs you when a step needs you, and in Working when one works', () => {
    const { rows, runs } = parentWithSteps();
    expect(rowStatus(withPipelines(rows, runs)[0]!)).toBe('running');
    const asking = rows.map((r) => (r.id === 'exec' ? { ...r, live: live('needs-you') } : r));
    expect(rowStatus(withPipelines(asking, runs)[0]!)).toBe('needs-you');
  });

  it('puts a run that waits for you in Needs you, with the reason on the row', () => {
    const { rows } = parentWithSteps();
    const waiting = state(run({ state: 'needs-you', heldBy: 'push', stepIndex: 3 }), [step(0, 1, { sessionId: 'plan' }), step(1, 1, { sessionId: 'exec' })]);
    const parent = withPipelines(rows, [waiting])[0]!;
    expect(rowStatus(parent)).toBe('needs-you');
    expect(parent.pipeline).toMatchObject({ progress: 'Push · 4 of 4', wait: 'Ready to push' });
  });

  it('keeps a child top-level when its parent is not in the list', () => {
    const out = withPipelines([row('exec', { parentId: 'gone' })], []);
    expect(out.map((r) => [r.id, r.depth])).toEqual([['exec', undefined]]);
  });

  it('adds a row for a run with no session, in its project, titled by the task, with its steps under it', () => {
    const r = run({ parentSessionId: null });
    const rows = [row('plan', { parentId: 'run:run1' }), row('exec', { parentId: 'run:run1' })];
    const out = withPipelines(rows, [state(r, [step(0, 1, { sessionId: 'plan' }), step(1, 1, { sessionId: 'exec', state: 'running' })])]);
    expect(out.map((x) => x.id)).toEqual(['run:run1']);
    const runRow = out[0]!;
    expect(runRow).toMatchObject({ title: 'Add a toggle', projectRoot: '/p/a', isWorktree: true, run: { runId: 'run1' }, summary: null });
    expect(runRow.children!.map((c) => c.id)).toEqual(['plan', 'exec']);
    expect(rowStatus(runRow)).toBe('running');
  });

  it('adds a run row even before it has a step', () => {
    const out = withPipelines([], [state(run({ parentSessionId: null, stepIndex: 0 }), [])]);
    expect(out.map((x) => x.id)).toEqual(['run:run1']);
    expect(out[0]!.children).toBeUndefined();
  });

  it('leaves another computer’s rows alone', () => {
    const remote = row('remote:c:s', { remote: { computerId: 'c' } as SessionRowData['remote'] });
    expect(withPipelines([remote, row('a', { parentId: 'gone' })], []).map((r) => r.id)).toEqual(['remote:c:s', 'a']);
  });
});

describe('the sidebar with a tree', () => {
  const options = { now: NOW, archiveAfterDays: 2 };

  it('lists only top-level rows, and a parent’s steps after it while it is open', () => {
    const { rows, runs } = parentWithSteps();
    const nested = withPipelines(rows, runs);
    const closed = sidebarOrder(sidebarGroups(nested, options)).map((r) => r.id);
    expect(closed.sort()).toEqual(['other', 'parent']);
    const open = sidebarOrder(sidebarGroups(nested, { ...options, open: new Set(['parent']) })).map((r) => r.id);
    expect(open.indexOf('plan')).toBe(open.indexOf('parent') + 1);
    expect(open.indexOf('exec')).toBe(open.indexOf('parent') + 2);
    expect(sidebarOrder(sidebarGroups(nested, { ...options, open: 'all' })).map((r) => r.id)).toContain('exec');
  });

  it('agrees with the open sidebar: the rail, the keys and the list show the same rows', () => {
    const { rows, runs } = parentWithSteps();
    const nested = withPipelines(rows, runs);
    const open = new Set(['parent']);
    const { active, archived } = buildSessionList(nested, { search: '', project: null, now: NOW, archiveAfterDays: 2 });
    const list = buildListRows(active, archived, { now: NOW, archivedOpen: false, open }).flatMap((r) => (r.kind === 'session' ? [r.data.id] : []));
    expect(sidebarOrder(sidebarGroups(nested, { ...options, open })).map((r) => r.id)).toEqual(list);
  });

  it('puts the parent in Needs you while a step needs you, and the steps under it', () => {
    const { rows, runs } = parentWithSteps();
    const asking = rows.map((r) => (r.id === 'exec' ? { ...r, live: live('needs-you') } : r));
    const groups = sidebarGroups(withPipelines(asking, runs), { ...options, open: new Set(['parent']) });
    expect(groups[0]!.group).toBe('needs-you');
    expect(groups[0]!.rows.map((r) => r.id)).toEqual(['parent', 'plan', 'exec']);
  });

  it('keeps a quiet parent listed while a step still needs you', () => {
    const old = NOW - 10 * 24 * HOUR;
    const rows = [row('parent', { updatedAt: old }), row('exec', { parentId: 'parent', updatedAt: old, live: live('needs-you') })];
    const runs = [state(run({ stepIndex: 1 }), [step(1, 1, { sessionId: 'exec', state: 'running' })])];
    const [parent] = withPipelines(rows, runs);
    expect(isActive(parent!, NOW, 2)).toBe(true);
    expect(isActive(row('parent', { updatedAt: old }), NOW, 2)).toBe(false);
  });

  it('lists steps flat while searching, once each', () => {
    const { rows, runs } = parentWithSteps();
    const nested = withPipelines(rows, runs);
    const { active } = buildSessionList(nested, { search: 'exec', project: null, now: NOW, archiveAfterDays: 2 });
    expect(active.map((r) => [r.id, r.depth])).toEqual([['exec', 0]]);
    const all = buildSessionList(nested, { search: 'a', project: null, now: NOW, archiveAfterDays: 2 }).active;
    const rowsOut = buildListRows(all, [], { now: NOW, archivedOpen: false, open: new Set(['parent']) }).flatMap((r) => (r.kind === 'session' ? [r.data.id] : []));
    expect(new Set(rowsOut).size).toBe(rowsOut.length);
  });

  it('puts a run row in its group like any session', () => {
    const r = run({ parentSessionId: null, state: 'needs-you', heldBy: 'push', stepIndex: 3 });
    const groups = sidebarGroups(withPipelines([], [state(r, [])]), options);
    expect(groups.map((g) => [g.group, g.rows.map((x) => x.id)])).toEqual([['needs-you', ['run:run1']]]);
  });

  it('opens children only for the parents asked for', () => {
    const { rows, runs } = parentWithSteps();
    const nested = withPipelines(rows, runs);
    expect(withOpenChildren(nested, new Set()).map((r) => r.id)).toEqual(['parent', 'other']);
    expect(withOpenChildren(nested, new Set(['parent'])).map((r) => r.id)).toEqual(['parent', 'plan', 'exec', 'other']);
    expect(withOpenChildren(nested, 'all').map((r) => r.id)).toEqual(['parent', 'plan', 'exec', 'other']);
  });
});

describe('the header pill with pipelines', () => {
  it('counts a parent once when its steps need you, and opens the parent', () => {
    const { rows, runs } = parentWithSteps();
    const waiting = rows.map((r) => (r.id === 'exec' || r.id === 'plan' ? { ...r, live: live('needs-you') } : r));
    const pill = needsYouPill(withPipelines(waiting, runs), [
      { sessionId: 'plan', toolName: 'Bash', input: {}, createdAt: NOW - 5 * 60_000 },
      { sessionId: 'exec', toolName: 'Bash', input: {}, createdAt: NOW - 9 * 60_000 },
    ]);
    expect(pill).toEqual({ count: 1, label: '1 needs you', targetId: 'parent' });
  });

  it('counts a run that waits for you (a push) and a run row', () => {
    const waitingRun = state(run({ state: 'needs-you', heldBy: 'push', stepIndex: 3 }), [step(0, 1, { sessionId: 'plan' })]);
    expect(needsYouPill(withPipelines([row('parent'), row('plan', { parentId: 'parent' }), row('other')], [waitingRun]), [])).toMatchObject({ count: 1, targetId: 'parent' });
    const rowRun = state(run({ id: 'run2', parentSessionId: null, state: 'needs-you', heldBy: 'verdict' }), []);
    expect(needsYouPill(withPipelines([row('other')], [rowRun]), [])).toMatchObject({ count: 1, targetId: 'run:run2' });
  });

  it('says nothing for a run that works', () => {
    const { rows, runs } = parentWithSteps();
    expect(needsYouPill(withPipelines(rows, runs), [])).toBeNull();
  });
});
