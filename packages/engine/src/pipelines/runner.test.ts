import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BUILT_IN_PIPELINES, parseActionResults, parseBriefs, type CatchUp, type ImageAttachment, type Pipeline, type PipelineNotice, type PipelineStep, type SessionSummary, type StepActionResult } from '@switchboard/protocol';
import { openCacheDatabase } from '../db/database.ts';
import { removeDir } from '../util/removeDir.ts';
import { builtInPipelines, PipelineStore } from './pipelineStore.ts';
import { PipelineRunner, PLAN_APPROVED_MESSAGE, RESUME_STEP_PROMPT, type StepHold, type StepSettings } from './runner.ts';
import { RunStore } from './runStore.ts';

const ROOT = resolve('/work/web');
const WORKTREE = resolve('/work/web/.claude/worktrees/run-1');

const dirs: string[] = [];
const databases: { close(): void }[] = [];
afterEach(async () => {
  databases.splice(0).forEach((db) => db.close());
  await Promise.all(dirs.splice(0).map((d) => removeDir(d)));
});

const summary = (id: string, title: string, over: Partial<SessionSummary> = {}): SessionSummary => ({
  id,
  title,
  firstPrompt: title,
  customTitle: null,
  cwd: ROOT,
  projectRoot: ROOT,
  gitBranch: 'main',
  worktree: null,
  origin: 'app',
  createdAt: 0,
  updatedAt: 0,
  fileSize: null,
  tag: null,
  pinned: false,
  archivedAt: null,
  restoredAt: null,
  viewedAt: null,
  unread: false,
  inApp: true,
  profileId: 'default',
  ...over,
});

const card = (over: Partial<CatchUp> = {}): CatchUp => ({
  sessionId: 'x',
  turnId: 't',
  generatedAt: 0,
  source: 'fallback',
  state: 'finished',
  ask: '',
  did: [],
  skipped: [],
  need: { kind: 'none', title: '', text: '' },
  signals: { tests: { state: 'notRun' }, diff: null, outOfScope: [], scope: null, plan: null },
  reviewMinutes: 1,
  ...over,
});

/** A session the runner started: how, with what, and what it was sent after. */
interface Started {
  id: string;
  kind: 'fresh' | 'fork';
  from?: string;
  cwd?: string;
  prompt: string;
  settings: StepSettings;
  sent: string[];
}

/** A runner on a real SQLite file, with sessions the test drives instead of Claude Code. */
function world(options: { hold?: () => StepHold | null; actions?: StepActionResult[]; pipelines?: Pipeline[] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'switchboard-pipelines-'));
  dirs.push(dir);
  const { db } = openCacheDatabase(join(dir, 'cache.sqlite'));
  databases.push(db);
  const runs = new RunStore(db);
  const pipelines = new PipelineStore(db);
  for (const p of options.pipelines ?? []) pipelines.restore(p);
  const sessions = new Map<string, SessionSummary>([['parent', summary('parent', 'Add a usage cost toggle', { firstPrompt: 'Add a toggle to hide the cost' })]]);
  const started: Started[] = [];
  const notices: PipelineNotice[] = [];
  const replies = new Map<string, string>();
  const busy = new Map<string, 'working' | 'waiting'>();
  const titles = new Map<string, string>();
  const interrupted: string[] = [];
  const pushed: Array<{ message: string; title: string; body: string }> = [];
  /** What the session index was told: archived and hidden sessions, deleted runs. */
  const archived = new Set<string>();
  const hidden = new Set<string>();
  const removed: string[] = [];
  const republished: string[][] = [];
  let hold = options.hold ?? (() => null);
  const images = new Map<string, ImageAttachment[]>();
  let next = 0;
  const add = (entry: Omit<Started, 'id' | 'sent'>) => {
    const id = `s${++next}`;
    started.push({ ...entry, id, sent: [] });
    sessions.set(id, summary(id, id, { cwd: entry.cwd ?? WORKTREE }));
    busy.set(id, 'working');
    return id;
  };
  const runner = new PipelineRunner({
    runs,
    pipeline: (id) => pipelines.get(id),
    session: (id) => sessions.get(id) ?? null,
    workspace: async () => WORKTREE,
    create: async ({ cwd, prompt, attachments, profileId: _p, ...settings }) => {
      const id = add({ kind: 'fresh', cwd, prompt, settings });
      images.set(id, attachments);
      return id;
    },
    fork: async ({ from, prompt, ...settings }) => add({ kind: 'fork', from, cwd: sessions.get(from)?.cwd ?? undefined, prompt, settings }),
    send: async (sessionId, text) => {
      started.find((s) => s.id === sessionId)?.sent.push(text);
      busy.set(sessionId, 'working');
    },
    interrupt: async (sessionId) => {
      interrupted.push(sessionId);
      busy.delete(sessionId);
    },
    title: (sessionId, title) => titles.set(sessionId, title),
    reparented: () => {},
    republishSessions: (ids) => republished.push([...ids]),
    archiveSessions: (ids, on) => ids.forEach((id) => (on ? archived.add(id) : archived.delete(id))),
    hideSessions: (ids) => ids.forEach((id) => hidden.add(id)),
    removed: (runId) => removed.push(runId),
    runActions: async (_run, names) => (options.actions ?? []).filter((a) => names.includes(a.name)),
    lastReply: async (id) => replies.get(id) ?? null,
    hold: () => hold(),
    busy: (id) => busy.get(id) ?? null,
    pushPreview: async () => ({ message: 'feat(usage): add a toggle', files: 6, branch: 'worktree-run-1', base: 'main', problem: null }),
    push: async (_run, request) => {
      pushed.push(request);
      return { number: 152, url: 'https://github.com/demo/web/pull/152' };
    },
    changed: () => {},
    notify: (notice) => notices.push(notice),
    log: () => {},
  });
  const w = {
    runner,
    runs,
    started,
    images,
    notices,
    titles,
    interrupted,
    pushed,
    replies,
    archived,
    hidden,
    removed,
    republished,
    setHold(next: () => StepHold | null) {
      hold = next;
    },
    /** The last session started. */
    last: () => started.at(-1)!,
    /** A session's turn ended, the catch-up made. */
    async end(id: string, outcome: 'clean' | 'error' | 'stopped' = 'clean', reply?: string, catchUp: CatchUp | null = card()) {
      if (reply !== undefined) replies.set(id, reply);
      busy.delete(id);
      await runner.turnEnded(id, outcome, catchUp);
    },
    state: (runId: string) => runner.state(runId)!,
  };
  return w;
}

const planExecute = BUILT_IN_PIPELINES[0]!.id;
const executeValidate = BUILT_IN_PIPELINES[1]!.id;

describe('PipelineRunner', () => {
  it('runs a fresh step, then a fork of it, in the run’s folder, under the parent', async () => {
    const w = world();
    const { run } = await w.runner.start({ pipelineId: planExecute, parentSessionId: 'parent' });
    expect(run).toMatchObject({ cwd: WORKTREE, parentSessionId: 'parent', status: 'running', step: 0 });
    const plan = w.last();
    expect(plan).toMatchObject({ kind: 'fresh', cwd: WORKTREE, settings: { model: 'opus', effort: 'high', permissionMode: 'plan', readOnly: false } });
    expect(w.titles.get(plan.id)).toBe('Plan');
    expect(w.runs.parentOf(plan.id)).toBe('parent');

    await w.end(plan.id);
    const execute = w.last();
    expect(execute).toMatchObject({ kind: 'fork', from: plan.id, cwd: WORKTREE, settings: { model: 'sonnet', permissionMode: 'acceptEdits' } });
    expect(w.runs.parentOf(execute.id)).toBe('parent');
    expect(w.state(run.id).steps.map((s) => [s.step, s.status])).toEqual([
      ['Plan', 'done'],
      ['Execute', 'working'],
    ]);
  });

  it('links @parent and @<step> as sessions, with the labels in the text', async () => {
    const w = world({ actions: [{ name: 'Test', exitCode: 0, tail: '214 passed', ms: 10 }, { name: 'Lint', exitCode: 1, tail: '2 problems', ms: 10 }] });
    const { run } = await w.runner.start({ pipelineId: executeValidate, parentSessionId: 'parent' });
    const execute = w.last();
    expect(parseBriefs(execute.prompt).briefs.map((b) => [b.label, b.sessionId])).toEqual([['Add a usage cost toggle', 'parent']]);
    await w.end(execute.id);
    const validate = w.last();
    expect(validate.settings.readOnly).toBe(true);
    const { text, briefs } = parseBriefs(validate.prompt);
    expect(briefs.map((b) => [b.label, b.sessionId])).toEqual([
      ['Execute', execute.id],
      ['Add a usage cost toggle', 'parent'],
    ]);
    expect(text).toContain('Check the work in @Execute against the task in @Add a usage cost toggle.');
    expect(parseActionResults(validate.prompt).actions.map((a) => [a.name, a.exitCode])).toEqual([
      ['Test', 0],
      ['Lint', 1],
    ]);
    expect(w.state(run.id).steps[1]!.actions.map((a) => a.name)).toEqual(['Test', 'Lint']);
    expect(w.runner.isReadOnly(validate.id)).toBe(true);
    expect(w.runner.isReadOnly(execute.id)).toBe(false);
  });

  it('gives a run row’s task as a block, and puts its steps under the run', async () => {
    const w = world();
    const { run } = await w.runner.start({ pipelineId: executeValidate, task: 'Add dark mode to the remote app', projectRoot: ROOT });
    expect(run).toMatchObject({ parentSessionId: null, task: 'Add dark mode to the remote app', title: 'Add dark mode to the remote app' });
    const execute = w.last();
    expect(execute.prompt).toContain('The task, from @Add dark mode to the remote app:');
    expect(w.runs.parentOf(execute.id)).toBe(run.id);
    // You write in the run row: it gets a session, and its steps go under it.
    w.runner.adopt(run.id, 'parent');
    expect(w.runs.parentOf(execute.id)).toBe('parent');
    expect(w.state(run.id).run.parentSessionId).toBe('parent');
  });

  it('starts the steps with the images sent with the task', async () => {
    const w = world();
    const image: ImageAttachment = { type: 'image', mediaType: 'image/png', data: 'aGk=', name: 'mock.png' };
    await w.runner.start({ pipelineId: executeValidate, task: 'Match the mock', attachments: [image], projectRoot: ROOT });
    expect(w.images.get(w.last().id)).toEqual([image]);
  });

  it('gives the steps that leave them open New session’s model, effort and mode', async () => {
    const w = world();
    const { run } = await w.runner.start({ pipelineId: executeValidate, task: 'Add dark mode', projectRoot: ROOT, choices: { model: 'haiku', effort: 'low', permissionMode: 'auto' } });
    // Execute sets its model and mode, not its effort; Validate sets all three (read only).
    expect(w.last().settings).toMatchObject({ model: 'sonnet', effort: 'low', permissionMode: 'acceptEdits' });
    expect(run.pipeline.steps[1]).toMatchObject({ model: 'opus', effort: 'high', permissionMode: null, readOnly: true });
  });

  it('archives and unarchives a run’s tree in one go, never while it goes on', async () => {
    const w = world();
    const { run } = await w.runner.start({ pipelineId: executeValidate, parentSessionId: 'parent' });
    const execute = w.last();
    expect(() => w.runner.archive(run.id, true)).toThrow(/Stop it first/);
    await w.runner.stop(run.id);
    w.runner.archive(run.id, true);
    expect([...w.archived].sort()).toEqual([execute.id, 'parent'].sort());
    w.runner.archive(run.id, false);
    expect(w.archived.size).toBe(0);
  });

  it('archives a run row itself, with its sub-sessions', async () => {
    const w = world();
    const { run } = await w.runner.start({ pipelineId: executeValidate, task: 'Add dark mode', projectRoot: ROOT });
    const execute = w.last();
    await w.end(execute.id, 'clean', 'Done.');
    const validate = w.last();
    await w.runner.stop(run.id);
    const [state] = w.runner.archive(run.id, true);
    expect(state!.run.archivedAt).not.toBeNull();
    expect([...w.archived].sort()).toEqual([execute.id, validate.id].sort());
    const [back] = w.runner.archive(run.id, false);
    expect(back!.run).toMatchObject({ archivedAt: null, restoredAt: expect.any(Number) });
  });

  it('deletes a run’s tree, stopping it first, with or without its sub-sessions', async () => {
    const w = world();
    const { run } = await w.runner.start({ pipelineId: executeValidate, task: 'Add dark mode', projectRoot: ROOT });
    const execute = w.last();
    await w.runner.delete(run.id, false);
    expect(w.interrupted).toContain(execute.id);
    expect(w.runner.state(run.id)).toBeNull();
    expect(w.removed).toEqual([run.id]);
    expect([...w.hidden]).toEqual([execute.id]);

    const kept = await w.runner.start({ pipelineId: executeValidate, parentSessionId: 'parent' });
    const second = w.last();
    await w.runner.delete(kept.run.id, true);
    expect(w.runs.parentOf(second.id)).toBeNull();
    // The parent goes; its sub-session stays, on its own.
    expect([...w.hidden]).toEqual([execute.id, 'parent']);
    expect(w.republished).toEqual([[second.id]]);
  });

  it('stops on an error, and goes on when a reply in that step ends cleanly', async () => {
    const w = world();
    const { run } = await w.runner.start({ pipelineId: executeValidate, parentSessionId: 'parent' });
    const execute = w.last();
    await w.end(execute.id, 'error');
    expect(w.state(run.id).run).toMatchObject({ status: 'waiting', waitingFor: 'you', reason: 'Execute ended with an error.' });
    expect(w.state(run.id).steps[0]!.status).toBe('failed');
    // The session's own notification says it failed: no second one.
    expect(w.notices).toEqual([]);
    // You reply in Execute; that turn ends cleanly.
    await w.end(execute.id);
    expect(w.state(run.id).run).toMatchObject({ status: 'running', step: 1 });
    expect(w.last().prompt).toContain('@Execute');
  });

  it('stops on a question, and goes on once it is answered and the turn ends', async () => {
    const w = world();
    const { run } = await w.runner.start({ pipelineId: planExecute, parentSessionId: 'parent' });
    const plan = w.last();
    w.runner.needsYou(plan.id, 'AskUserQuestion');
    expect(w.state(run.id).run).toMatchObject({ status: 'waiting', reason: 'Plan asks a question.' });
    expect(w.state(run.id).steps[0]!.status).toBe('waiting');
    expect(w.notices).toEqual([]);
    w.runner.answered(plan.id);
    expect(w.state(run.id).run.status).toBe('running');
    await w.end(plan.id);
    expect(w.state(run.id).run.step).toBe(1);
  });

  it('stops when the catch-up says Claude waits for you', async () => {
    const w = world();
    const { run } = await w.runner.start({ pipelineId: planExecute, parentSessionId: 'parent' });
    await w.end(w.last().id, 'clean', 'Which file?', card({ need: { kind: 'reply', title: 'Answer the question', text: '' } }));
    expect(w.state(run.id).run).toMatchObject({ status: 'waiting', reason: 'Plan waits for you.' });
  });

  it('keeps an approved plan for briefs and tells Plan not to build it', async () => {
    const w = world();
    const { run } = await w.runner.start({ pipelineId: planExecute, parentSessionId: 'parent' });
    const plan = w.last();
    expect(w.runner.planApproved(plan.id, '1. Add the setting')).toBe(PLAN_APPROVED_MESSAGE);
    expect(w.runs.planOf(plan.id)).toBe('1. Add the setting');
    expect(w.state(run.id).steps[0]!.reason).toBe('plan approved');
    expect(w.runner.planApproved('parent', 'x')).toBeNull();
  });

  it('sends changes back with @Validate linked, runs a new round, then waits at Push', async () => {
    const w = world();
    const { run } = await w.runner.start({ pipelineId: planExecute, parentSessionId: 'parent' });
    await w.end(w.last().id);
    const execute = w.last();
    await w.end(execute.id);
    const validate = w.last();
    await w.end(validate.id, 'clean', 'Mostly fine.\n\nVerdict: changes needed\n1. LimitsCard still shows the cost.\n2. Two lint errors.');
    expect(w.state(run.id).run).toMatchObject({ status: 'running', step: 2, round: 2, sentBackTo: 1 });
    const message = execute.sent.at(-1)!;
    expect(parseBriefs(message).briefs.map((b) => [b.label, b.sessionId])).toEqual([['Validate', validate.id]]);
    expect(parseBriefs(message).text).toContain('@Validate found changes needed (round 1 of 2):\n\n1. LimitsCard still shows the cost.\n2. Two lint errors.');
    expect(w.state(run.id).steps.find((s) => s.step === 'Validate')).toMatchObject({ verdict: { kind: 'changes' }, reason: 'Changes needed: sent to Execute.' });

    // Execute's turn after the changes ends: Validate round 2, in a new sub-session.
    await w.end(execute.id);
    const again = w.last();
    expect(again.id).not.toBe(validate.id);
    expect(w.titles.get(again.id)).toBe('Validate · round 2');
    expect(w.state(run.id).run).toMatchObject({ step: 2, round: 2, sentBackTo: null });
    await w.end(again.id, 'clean', 'All good.\nVerdict: pass');
    expect(w.state(run.id).run).toMatchObject({ status: 'waiting', waitingFor: 'push', step: 3, reason: 'Push waits for you.' });
    expect(w.state(run.id).steps.map((s) => [s.step, s.round, s.status])).toEqual([
      ['Plan', 1, 'done'],
      ['Execute', 1, 'done'],
      ['Validate', 1, 'done'],
      ['Validate', 2, 'done'],
    ]);

    // Push: commit, push and open the pull request with the task and the verdict.
    expect((await w.runner.pushPreview(run.id)).message).toBe('feat(usage): add a toggle');
    await w.runner.continue(run.id, 'feat: edited');
    expect(w.pushed[0]).toMatchObject({ message: 'feat: edited', title: 'Add a usage cost toggle' });
    expect(w.pushed[0]!.body).toContain('Add a toggle to hide the cost');
    expect(w.pushed[0]!.body).toContain('Verdict: pass (round 2)');
    expect(w.state(run.id).run).toMatchObject({ status: 'done', pr: { number: 152 } });
    expect(w.notices.at(-1)).toMatchObject({ kind: 'done', body: 'Done. Pull request #152 is open.' });
  });

  it('checks again after a stop while the changes were with Execute: Continue starts the next Validate round, never Push', async () => {
    const w = world();
    const { run } = await w.runner.start({ pipelineId: planExecute, parentSessionId: 'parent' });
    await w.end(w.last().id);
    const execute = w.last();
    await w.end(execute.id);
    await w.end(w.last().id, 'clean', 'Verdict: changes needed\n1. Fix the tooltip.');
    // Execute's turn with the changes fails: the run waits for you.
    await w.end(execute.id, 'error');
    expect(w.state(run.id).run).toMatchObject({ status: 'waiting', step: 2, sentBackTo: 1 });
    await w.runner.continue(run.id);
    expect(w.titles.get(w.last().id)).toBe('Validate · round 2');
    expect(w.state(run.id).run).toMatchObject({ status: 'running', step: 2, round: 2, sentBackTo: null });
    expect(w.pushed).toEqual([]);
    expect(w.state(run.id).steps.filter((s) => s.step === 'Execute').map((s) => s.status)).toEqual(['done']);
  });

  it('ends the send-back when a step is skipped or run again, so Execute doesn’t stay working', async () => {
    const w = world();
    const { run } = await w.runner.start({ pipelineId: planExecute, parentSessionId: 'parent' });
    await w.end(w.last().id);
    const execute = w.last();
    await w.end(execute.id);
    await w.end(w.last().id, 'clean', 'Verdict: changes needed\n1. Fix the tooltip.');
    expect(w.state(run.id).run.sentBackTo).toBe(1);
    await w.runner.retryStep(run.id);
    expect(w.interrupted).toContain(execute.id);
    expect(w.state(run.id).run).toMatchObject({ step: 2, sentBackTo: null });
    expect(w.state(run.id).steps.filter((s) => s.step === 'Execute').map((s) => s.status)).toEqual(['stopped']);
    // Execute's late turn end changes nothing: the run waits on Validate now.
    const count = w.started.length;
    await w.end(execute.id);
    expect(w.started).toHaveLength(count);
  });

  it('stops on a missing verdict, and when changes are still needed after the last round', async () => {
    const w = world();
    const { run } = await w.runner.start({ pipelineId: executeValidate, parentSessionId: 'parent' });
    const execute = w.last();
    await w.end(execute.id);
    await w.end(w.last().id, 'clean', 'Looks fine.');
    expect(w.state(run.id).run).toMatchObject({ status: 'waiting', reason: 'Validate has no verdict.' });
    expect(w.notices.at(-1)).toMatchObject({ kind: 'stopped', body: 'Validate has no verdict.' });

    const v = world();
    const second = (await v.runner.start({ pipelineId: executeValidate, parentSessionId: 'parent' })).run;
    const exec = v.last();
    await v.end(exec.id);
    await v.end(v.last().id, 'clean', 'Verdict: changes needed\n- a');
    await v.end(exec.id);
    await v.end(v.last().id, 'clean', 'Verdict: changes needed\n- a');
    expect(v.state(second.id).run).toMatchObject({ status: 'waiting', reason: 'Still changes needed after 2 rounds.' });
    // Continue goes on as if it had passed: the run is done.
    await v.runner.continue(second.id);
    expect(v.state(second.id).run.status).toBe('done');
  });

  it('waits at the focus limit, and starts once a slot frees', async () => {
    let full = true;
    const w = world({ hold: () => (full ? { kind: 'focus' } : null) });
    const { run } = await w.runner.start({ pipelineId: executeValidate, parentSessionId: 'parent' });
    expect(w.started).toHaveLength(0);
    expect(w.state(run.id).run).toMatchObject({ status: 'running', hold: 'focus' });
    full = false;
    w.runner.check();
    await new Promise((r) => setTimeout(r, 10));
    expect(w.started).toHaveLength(1);
    expect(w.state(run.id).run.hold).toBeNull();
  });

  it('pauses on quit, and goes on at the next start with a new message, never mid-turn', async () => {
    const w = world();
    const { run } = await w.runner.start({ pipelineId: executeValidate, parentSessionId: 'parent' });
    const execute = w.last();
    w.runner.pauseAll();
    // The process ends with the app: that turn's end is not the step's.
    await w.end(execute.id, 'clean');
    expect(w.state(run.id).run).toMatchObject({ status: 'paused', reason: 'Paused: Switchboard was closed. The run goes on at the next start.', step: 0 });

    const next = new PipelineRunner({ ...(w.runner as unknown as { deps: ConstructorParameters<typeof PipelineRunner>[0] }).deps });
    await next.resumeAll();
    expect(next.state(run.id)!.run.status).toBe('running');
    expect(execute.sent).toEqual([RESUME_STEP_PROMPT]);
    await next.turnEnded(execute.id, 'clean', card());
    expect(next.state(run.id)!.run.step).toBe(1);
  });

  it('stops when a step’s session is closed in the middle of a turn', async () => {
    const w = world();
    const { run } = await w.runner.start({ pipelineId: executeValidate, parentSessionId: 'parent' });
    const execute = w.last();
    w.runner.onHost({ sessionId: execute.id, state: 'running' });
    w.runner.onHost({ sessionId: execute.id, state: 'closed' });
    await new Promise((r) => setTimeout(r, 10));
    expect(w.state(run.id).run).toMatchObject({ status: 'waiting', reason: 'Execute was stopped.' });
  });

  it('skips a step, runs one again, and stops the run', async () => {
    const w = world();
    const { run } = await w.runner.start({ pipelineId: planExecute, parentSessionId: 'parent' });
    const plan = w.last();
    await w.runner.retryStep(run.id);
    expect(w.interrupted).toEqual([plan.id]);
    expect(w.state(run.id).run.round).toBe(2);
    expect(w.titles.get(w.last().id)).toBe('Plan · round 2');

    await w.runner.skipStep(run.id);
    expect(w.state(run.id).steps.filter((s) => s.step === 'Plan').map((s) => s.status)).toEqual(['stopped', 'skipped']);
    expect(w.state(run.id).run.step).toBe(1);

    await w.runner.stop(run.id);
    expect(w.state(run.id).run).toMatchObject({ status: 'stopped', reason: 'You stopped the run.' });
    // Nothing starts after a stop.
    const count = w.started.length;
    await w.end(w.last().id);
    expect(w.started).toHaveLength(count);
  });

  it('holds before a step that waits for you, and starts it on Continue', async () => {
    const steps: PipelineStep[] = [
      { ...(BUILT_IN_PIPELINES[1]!.steps[0] as Extract<PipelineStep, { kind: 'claude' }>), name: 'A' },
      { ...(BUILT_IN_PIPELINES[1]!.steps[0] as Extract<PipelineStep, { kind: 'claude' }>), name: 'B', confirmBefore: true },
    ];
    const mine: Pipeline = { ...builtInPipelines()[1]!, id: 'mine', name: 'Mine', builtIn: false, steps };
    const w = world({ pipelines: [mine] });
    const { run } = await w.runner.start({ pipelineId: 'mine', parentSessionId: 'parent' });
    await w.end(w.last().id);
    expect(w.state(run.id).run).toMatchObject({ status: 'waiting', waitingFor: 'confirm', step: 1, reason: 'B waits for you to start it.' });
    expect(w.started).toHaveLength(1);
    await w.runner.continue(run.id);
    expect(w.started).toHaveLength(2);
    expect(w.state(run.id).run.status).toBe('running');
  });
});
