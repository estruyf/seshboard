import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BUILTIN_PIPELINES,
  runRows,
  type CatchUpNeedKind,
  type Pipeline,
  type PipelineNeedsYou,
  type PipelinePushDraft,
  type PipelinePushProgress,
  type PipelineRun,
  type PipelineRunState,
  type SessionHostInfo,
} from '@switchboard/protocol';
import { openCacheDatabase } from '../db/database.ts';
import { removeDir } from '../util/removeDir.ts';
import type { PushPlan } from './push.ts';
import { PipelineRunner, type ActionRun, type PushEdits } from './runner.ts';
import { PipelineRunStore } from './runStore.ts';
import { makeRunWorktree } from './worktree.ts';

const dirs: string[] = [];
const databases: { close(): void }[] = [];
const runners: PipelineRunner[] = [];
afterEach(async () => {
  runners.splice(0).forEach((r) => r.close());
  databases.splice(0).forEach((db) => db.close());
  await Promise.all(dirs.splice(0).map((d) => removeDir(d)));
});

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
/** Lets everything the runner queued run: its work is promises, so a few turns of the event loop are enough. */
const settle = async () => {
  for (let i = 0; i < 25; i++) await tick();
};

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

interface Reply {
  reply?: string | null;
  plan?: string | null;
  need?: CatchUpNeedKind;
  ok?: boolean;
  stopped?: boolean;
  error?: string | null;
}

/** The builtin pipeline with the changes a test wants. */
const custom = (extra: Partial<Pipeline>, base: Pipeline = BUILTIN_PIPELINES[0]!): Pipeline => ({ ...base, ...extra });

/** A project folder, a real cache, and a runner whose host is a fake: sessions are made up, and turns end when the test says. */
function world(options: { git?: boolean; focus?: { limit: number | null; count: number } } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-runner-')));
  dirs.push(dir);
  const repo = join(dir, 'app');
  mkdirSync(repo);
  if (options.git) {
    git(repo, 'init', '--initial-branch=main');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'Test');
    writeFileSync(join(repo, 'README.md'), '# app\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'first');
  }
  const cache = openCacheDatabase(join(dir, 'cache.sqlite'));
  databases.push(cache.db);
  let now = 1_000_000;
  const clock = () => (now += 10);
  const store = new PipelineRunStore(cache.db, clock);

  const alive = new Set<string>(['parent']);
  const busy = new Set<string>();
  const turns = new Map<string, { reply: string | null; plan: string | null; need: CatchUpNeedKind }>();
  const created: Array<{ id: string; cwd: string; prompt: string; model: string | null; effort: string | null; permissionMode: string; readOnly: boolean; profileId: string | null }> = [];
  const forks: Array<{ id: string; from: string; text: string; model: string | null; effort: string | null; permissionMode: string | undefined; readOnly: boolean }> = [];
  const sent: Array<{ sessionId: string; text: string }> = [];
  const interrupted: string[] = [];
  const linked: string[] = [];
  const actionCalls: Array<{ name: string; cwd: string; sessionId: string | null }> = [];
  const actions: Record<string, ActionRun> = { Test: { status: 'ran', exitCode: 0, output: 'tests ok\n' }, Lint: { status: 'ran', exitCode: 0, output: '' } };
  const emitted: PipelineRunState[] = [];
  const notices: PipelineNeedsYou[] = [];
  const pushes: PushPlan[] = [];
  const progress: PipelinePushProgress[] = [];
  const state = {
    focus: options.focus ?? { limit: null as number | null, count: 0 },
    limit: null as { resetsAt: number | null } | null,
    failCreate: null as string | null,
    pushFails: null as string | null,
    worktrees: 0,
    onCreate: null as ((id: string) => void) | null,
    actionGate: null as Promise<void> | null,
    pushGate: null as Promise<void> | null,
  };
  let counter = 0;
  const draft: PipelinePushDraft = { commitMessage: 'feat: toggle', uncommitted: 2, branch: 'worktree-x', prTitle: 'Add a usage cost toggle', prBody: '## Task\n\nAdd a usage cost toggle', base: 'main', draft: false, refused: null };

  const make = (store2: PipelineRunStore = store) => {
    const runner = new PipelineRunner({
      store: store2,
      createSession: async (p) => {
        if (state.failCreate) throw new Error(state.failCreate);
        const id = `s${++counter}`;
        created.push({ id, cwd: p.cwd, prompt: p.prompt, model: p.model, effort: p.effort, permissionMode: p.permissionMode, readOnly: p.readOnly, profileId: p.profileId });
        alive.add(id);
        busy.add(id);
        state.onCreate?.(id);
        return id;
      },
      forkAndSend: async (p) => {
        const id = `s${++counter}`;
        forks.push({ id, from: p.sessionId, text: p.text, model: p.model, effort: p.effort, permissionMode: p.permissionMode, readOnly: p.readOnly });
        alive.add(id);
        busy.add(id);
        return id;
      },
      send: async (sessionId, text) => {
        sent.push({ sessionId, text });
        busy.add(sessionId);
      },
      interrupt: async (sessionId) => {
        interrupted.push(sessionId);
        busy.delete(sessionId);
      },
      lastTurn: async (id) => {
        const turn = turns.get(id);
        return turn ? { reply: turn.reply, plan: turn.plan } : null;
      },
      needOf: async (id) => turns.get(id)?.need ?? 'none',
      busy: (id) => busy.has(id),
      runAction: async ({ name, cwd, sessionId }) => {
        actionCalls.push({ name, cwd, sessionId });
        if (state.actionGate) await state.actionGate;
        return actions[name] ?? { status: 'missing' };
      },
      makeWorktree: async ({ root, name, fromCwd }) => {
        state.worktrees++;
        if (options.git) return makeRunWorktree({ root, name, fromCwd });
        const path = join(root, '.claude', 'worktrees', name);
        mkdirSync(path, { recursive: true });
        return path;
      },
      focus: () => state.focus,
      limitHeld: () => state.limit,
      sessionExists: (id) => alive.has(id),
      folderExists: (path) => existsSync(path) && statSync(path).isDirectory(),
      linked: (id) => linked.push(id),
      changed: (s) => emitted.push(s),
      notify: (n) => notices.push(n),
      pushDraft: async () => draft,
      push: async (_run, plan, onStep) => {
        pushes.push(plan);
        onStep('commit');
        if (state.pushGate) await state.pushGate;
        if (state.pushFails) throw new Error(state.pushFails);
        onStep('push');
        onStep('create');
        return { commit: { sha: 'abc', files: 2 }, pr: plan.pullRequest ? { number: 152, url: 'https://github.com/o/r/pull/152', draft: false } : null, compareUrl: null, note: plan.pullRequest ? 'Pull request #152 opened' : 'Pushed worktree-x' };
      },
      pushProgress: (p) => progress.push(p),
      now: clock,
      log: () => {},
    });
    runners.push(runner);
    return runner;
  };
  const runner = make();

  /** Ends a session's turn the way the host reports it. */
  const finish = async (sessionId: string, result: Reply = {}) => {
    turns.set(sessionId, { reply: result.reply === undefined ? 'Done.' : result.reply, plan: result.plan ?? null, need: result.need ?? 'none' });
    busy.delete(sessionId);
    runner.turnEnded(sessionId, { ok: result.ok ?? true, error: result.error ?? null, ...(result.stopped ? { stopped: true } : {}) });
    await settle();
  };
  const start = (pipeline: Pipeline = BUILTIN_PIPELINES[0]!, extra: { parentSessionId?: string | null; cwd?: string; scope?: boolean } = {}) =>
    runner.start({ pipeline, parentSessionId: extra.parentSessionId === undefined ? 'parent' : extra.parentSessionId, root: repo, cwd: extra.cwd ?? repo, task: 'Add a usage cost toggle', profileId: null });
  const current = (runId: string) => store.get(runId)!;
  const rows = (runId: string) => store.steps(runId);
  const rowOf = (runId: string, stepName: string, round = 1) => rows(runId).find((r) => r.stepName === stepName && r.round === round);
  const host = (sessionId: string, state: SessionHostInfo['state'], error: string | null = null) => runner.onHost({ sessionId, state, error } as SessionHostInfo);
  return { dir, repo, cache, store, runner, make, state, alive, busy, turns, created, forks, sent, interrupted, linked, actionCalls, actions, emitted, notices, pushes, progress, draft, finish, start, current, rows, rowOf, host, settle };
}

/** The run at Validate, with Plan and Execute done: the sessions are s1 (Plan), s2 (Execute) and s3 (Validate). */
async function atValidate(w: ReturnType<typeof world>, pipeline: Pipeline = BUILTIN_PIPELINES[0]!) {
  const run = await w.start(pipeline);
  await w.finish('s1', { reply: 'Plan text', plan: 'The plan' });
  await w.finish('s2', { reply: 'Built it', plan: 'The plan' });
  return run;
}

describe('PipelineRunner', () => {
  describe('a run through every kind of step', () => {
    it('plans, forks to execute, validates in a read-only session, sends changes back, validates again and waits to push', async () => {
      const w = world({ git: true });
      const started = await w.start();
      // The run made its worktree first, and every step works in it.
      expect(started.cwd).toBe(join(w.repo, '.claude', 'worktrees', started.cwd.split(/[\\/]/).at(-1)!));
      expect(git(started.cwd, 'branch', '--show-current')).toMatch(/^worktree-/);
      expect(started).toMatchObject({ state: 'running', stepIndex: 0, parentSessionId: 'parent' });

      // Plan: a fresh session on its own model, effort and mode, with the task and a brief of the parent.
      expect(w.created).toHaveLength(1);
      expect(w.created[0]).toMatchObject({ id: 's1', cwd: started.cwd, model: 'opus', effort: 'high', permissionMode: 'plan', readOnly: false });
      expect(w.created[0]!.prompt).toContain('Add a usage cost toggle\n\nPlan this. Don’t edit files.');
      expect(w.created[0]!.prompt).toContain('Linked session: Parent session\n```switchboard-session\nsession: parent\n```');
      expect(w.store.parentOf('s1')).toBe('parent');
      expect(w.linked).toEqual(['s1']);

      // Execute: a fork of Plan on Sonnet and Accept edits, with nothing copied into its prompt.
      await w.finish('s1', { reply: 'Here is the plan.', plan: 'Step one\nStep two' });
      expect(w.forks).toEqual([{ id: 's2', from: 's1', text: 'Build the plan you just made. Run the tests.', model: 'sonnet', effort: null, permissionMode: 'acceptEdits', readOnly: false }]);
      expect(w.store.parentOf('s2')).toBe('parent');
      expect(w.rowOf(started.id, 'Plan')).toMatchObject({ state: 'done', reply: 'Here is the plan.', plan: 'Step one\nStep two', sessionId: 's1' });

      // Validate: the actions ran first, their results are in the prompt, a brief of Execute follows, and it can only read.
      await w.finish('s2', { reply: 'Built it.', plan: 'Step one\nStep two' });
      expect(w.rowOf(started.id, 'Execute')).toMatchObject({ state: 'done', reply: 'Built it.', plan: null });
      expect(w.actionCalls).toEqual([
        { name: 'Test', cwd: started.cwd, sessionId: 'parent' },
        { name: 'Lint', cwd: started.cwd, sessionId: 'parent' },
      ]);
      expect(w.created[1]).toMatchObject({ id: 's3', cwd: started.cwd, model: 'opus', permissionMode: 'default', readOnly: true });
      expect(w.created[1]!.prompt).toContain('Check the diff against main and the results above.');
      expect(w.created[1]!.prompt).toContain('Action Test: exit 0\n```text\ntests ok\n```');
      expect(w.created[1]!.prompt).toContain('Action Lint: exit 0 (no output)');
      expect(w.created[1]!.prompt).toContain('Linked session: Execute\n```switchboard-session\nsession: s2\n```');
      expect(w.created[1]!.prompt).not.toContain('session: parent');

      // A verdict that wants changes goes to Execute as a message, and Execute works again.
      await w.finish('s3', { reply: 'Looked at it.\n\nVerdict: changes needed\n- Add a test for the toggle' });
      expect(w.sent).toEqual([{ sessionId: 's2', text: 'Validate asked for changes:\n\n- Add a test for the toggle' }]);
      expect(w.current(started.id)).toMatchObject({ state: 'running', stepIndex: 1, loopTo: 2 });
      expect(w.rowOf(started.id, 'Execute')).toMatchObject({ state: 'running', endedAt: null, note: 'Changes from Validate' });
      expect(w.rowOf(started.id, 'Validate')).toMatchObject({ state: 'done', verdict: 'changes', verdictText: '- Add a test for the toggle' });

      // When Execute ends, Validate starts again, fresh, as round 2.
      await w.finish('s2', { reply: 'Added the test.', plan: 'Step one\nStep two' });
      expect(w.created).toHaveLength(3);
      expect(w.created[2]).toMatchObject({ id: 's4', readOnly: true });
      expect(w.actionCalls).toHaveLength(4);
      expect(w.rowOf(started.id, 'Validate', 2)).toMatchObject({ state: 'running', sessionId: 's4' });
      expect(w.current(started.id)).toMatchObject({ stepIndex: 2, loopTo: null });

      // A pass stops the run at the push step, and tells you.
      await w.finish('s4', { reply: 'All good.\n\nVerdict: pass' });
      expect(w.current(started.id)).toMatchObject({ state: 'needs-you', heldBy: 'push', stepIndex: 3, note: 'Ready to push' });
      expect(w.pushes).toEqual([]);
      expect(w.notices.at(-1)).toEqual({ runId: started.id, parentId: 'parent', title: 'Add a usage cost toggle', step: 'Push', reason: 'Ready to push' });

      // Push does what the card says, reports its steps, and the run is done.
      await w.runner.push(started.id, { commitMessage: 'feat: cost toggle', prTitle: 'Add a usage cost toggle', prBody: 'Body' } satisfies PushEdits);
      await w.settle();
      expect(w.pushes).toEqual([{ commit: true, message: 'feat: cost toggle', pullRequest: { title: 'Add a usage cost toggle', body: 'Body', base: null, draft: false } }]);
      expect(w.progress.map((p) => p.step)).toEqual(['commit', 'push', 'create', 'done']);
      expect(w.progress.at(-1)).toMatchObject({ runId: started.id, pr: { number: 152 } });
      expect(w.current(started.id)).toMatchObject({ state: 'done', heldBy: null, note: null });
      expect(w.rowOf(started.id, 'Push')).toMatchObject({ state: 'done', note: 'Pull request #152 opened' });
      expect(runRows(w.current(started.id), w.rows(started.id)).map((r) => r.text)).toEqual([
        'Plan done',
        'Validate: changes needed, sent to Execute',
        // Execute ended again after the changes, so its row has that end.
        'Execute done',
        'Validate (round 2): passed',
        'Pull request #152 opened',
      ]);
    });

    it('hands a plan step’s plan on as the previous reply, and names earlier replies', async () => {
      const w = world();
      const pipeline = custom({
        steps: [
          { kind: 'claude', name: 'Plan', prompt: '{{task}}', start: { kind: 'fresh' }, model: null, effort: null, permissionMode: null },
          { kind: 'claude', name: 'Build', prompt: 'Plan:\n{{previous.reply}}', start: { kind: 'fresh', briefOf: [] }, model: null, effort: null, permissionMode: null },
          { kind: 'claude', name: 'Check', prompt: 'Plan was: {{step:Plan.reply}}\nBuilder said: {{step:Build.reply}}', start: { kind: 'fresh', briefOf: [] }, model: null, effort: null, permissionMode: null },
        ],
      });
      await w.start(pipeline);
      await w.finish('s1', { reply: 'Short reply after approval', plan: 'The approved plan' });
      expect(w.created[1]!.prompt).toBe('Plan:\nThe approved plan');
      await w.finish('s2', { reply: 'Built.' });
      expect(w.created[2]!.prompt).toBe('Plan was: The approved plan\nBuilder said: Built.');
    });

    it('fills the pipeline’s own blanks from the values the run started with', async () => {
      const w = world();
      const pipeline = custom({ workspace: 'current', steps: [{ kind: 'claude', name: 'Fix', prompt: 'Fix {{issue:issue}} on {{branch:branch}}', start: { kind: 'fresh', briefOf: [] }, model: null, effort: null, permissionMode: null }] });
      await w.runner.start({ pipeline, parentSessionId: null, root: w.repo, cwd: w.repo, task: 't', blanks: { issue: '#12', branch: 'main' }, profileId: 'work' });
      expect(w.created[0]).toMatchObject({ prompt: 'Fix #12 on main', profileId: 'work', cwd: w.repo });
    });

    it('works in the parent’s folder for a pipeline that says current, without making a worktree', async () => {
      const w = world();
      const run = await w.start(custom({ workspace: 'current' }));
      expect(run.cwd).toBe(w.repo);
      expect(w.state.worktrees).toBe(0);
      expect(w.created[0]!.cwd).toBe(w.repo);
    });

    it('tells the actions a missing, skipped and failing step apart in the prompt', async () => {
      const w = world();
      w.actions.Lint = { status: 'skipped', note: 'it asks Claude' };
      w.actions.Test = { status: 'ran', exitCode: 2, output: `${Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join('\n')}\n` };
      const pipeline = custom({
        workspace: 'current',
        steps: [{ kind: 'claude', name: 'Check', prompt: 'Check', start: { kind: 'fresh', briefOf: [] }, model: null, effort: null, permissionMode: null, actionsFirst: ['Test', 'Lint', 'Build'] }],
      });
      await w.start(pipeline);
      const prompt = w.created[0]!.prompt;
      expect(prompt).toContain('Action Test: exit 2');
      // Only the last 150 lines of the output go in.
      expect(prompt).toContain('line 300');
      expect(prompt).toContain('line 151');
      expect(prompt).not.toContain('line 150\n');
      expect(prompt).toContain('Action Lint: not run, it asks Claude.');
      expect(prompt).toContain('Action Build: not run, there is no action with this name here.');
    });
  });

  describe('verdicts and rounds', () => {
    it('stops with Needs you when the rounds are used up, and sends changes back only once', async () => {
      const w = world();
      const run = await atValidate(w);
      await w.finish('s3', { reply: 'Verdict: changes needed\n- first' });
      await w.finish('s2', { reply: 'Fixed.', plan: 'The plan' });
      await w.finish('s4', { reply: 'Verdict: changes needed\n- still wrong' });
      expect(w.sent).toHaveLength(1);
      expect(w.current(run.id)).toMatchObject({ state: 'needs-you', heldBy: 'verdict', stepIndex: 2, note: 'Validate still asks for changes after 2 rounds' });
      expect(w.rowOf(run.id, 'Validate', 2)).toMatchObject({ state: 'needs-you', verdict: 'changes', verdictText: '- still wrong' });
      expect(w.notices.at(-1)).toMatchObject({ reason: 'Validate still asks for changes after 2 rounds', step: 'Validate' });
      // Continue goes on past it, as it is.
      await w.runner.continue(run.id);
      expect(w.current(run.id)).toMatchObject({ state: 'needs-you', heldBy: 'push', stepIndex: 3 });
      expect(w.rowOf(run.id, 'Validate', 2)).toMatchObject({ state: 'done', note: 'You went on as it is' });
    });

    it('stops on a missing verdict, and goes on when the reviewer answers properly in its session', async () => {
      const w = world();
      const run = await atValidate(w);
      await w.finish('s3', { reply: 'Looks fine to me.' });
      expect(w.current(run.id)).toMatchObject({ state: 'needs-you', heldBy: 'verdict' });
      expect(w.current(run.id).note).toMatch(/gave no verdict/);
      // You write in the Validate session; its next turn ends with a verdict.
      await w.finish('s3', { reply: 'Verdict: pass' });
      expect(w.current(run.id)).toMatchObject({ state: 'needs-you', heldBy: 'push' });
      expect(w.rowOf(run.id, 'Validate')).toMatchObject({ state: 'done', verdict: 'pass' });
    });

    it('does not read a verdict in a reply that is not the end of a clean turn', async () => {
      const w = world();
      const run = await atValidate(w);
      await w.finish('s3', { reply: 'Verdict: pass', ok: false, error: 'rate limited' });
      expect(w.current(run.id)).toMatchObject({ state: 'needs-you', heldBy: 'error' });
      expect(w.rowOf(run.id, 'Validate')!.verdict).toBeNull();
    });

    it('stops when the session changes should go to is gone', async () => {
      const w = world();
      const run = await atValidate(w);
      w.alive.delete('s2');
      await w.finish('s3', { reply: 'Verdict: changes needed\n- fix' });
      expect(w.current(run.id)).toMatchObject({ state: 'needs-you', heldBy: 'closed' });
      expect(w.current(run.id).note).toMatch(/Execute session is gone/);
      expect(w.sent).toEqual([]);
    });
  });

  describe('stopping and going on', () => {
    it('stops at a step that errors, once, and goes on when the person fixes it in that session', async () => {
      const w = world();
      const run = await w.start();
      await w.finish('s1', { reply: 'Plan', plan: 'P' });
      await w.finish('s2', { ok: false, error: 'Claude Code process exited with code 1', reply: null });
      expect(w.current(run.id)).toMatchObject({ state: 'needs-you', heldBy: 'error', note: 'Execute stopped with an error: Claude Code process exited with code 1' });
      expect(w.rowOf(run.id, 'Execute')).toMatchObject({ state: 'failed' });
      const noticed = w.notices.length;
      // The host reports the crash too; the same stop isn't told twice.
      w.host('s2', 'error', 'Claude Code process exited with code 1');
      await w.settle();
      expect(w.notices).toHaveLength(noticed);
      // A reply in the sub-session that ends clean carries the run on.
      await w.finish('s2', { reply: 'Fixed it.', plan: 'P' });
      expect(w.current(run.id)).toMatchObject({ state: 'running', stepIndex: 2 });
      expect(w.created.at(-1)).toMatchObject({ id: 's3', readOnly: true });
    });

    it('stops when you stopped the step, and goes on after a clean answer', async () => {
      const w = world();
      const run = await w.start();
      await w.finish('s1', { stopped: true, ok: false, reply: null });
      expect(w.current(run.id)).toMatchObject({ state: 'needs-you', heldBy: 'error', note: 'Plan was stopped' });
      expect(w.rowOf(run.id, 'Plan')).toMatchObject({ state: 'stopped' });
      await w.finish('s1', { reply: 'Plan', plan: 'P' });
      expect(w.forks).toHaveLength(1);
    });

    it('stops when Claude asks a question, and goes on once it is answered', async () => {
      const w = world();
      const run = await w.start();
      await w.finish('s1', { reply: 'Should the toggle live in Settings?', need: 'reply' });
      expect(w.current(run.id)).toMatchObject({ state: 'needs-you', heldBy: 'reply', note: 'Plan waits for you' });
      expect(w.forks).toEqual([]);
      await w.finish('s1', { reply: 'Plan', plan: 'P', need: 'none' });
      expect(w.current(run.id).stepIndex).toBe(1);
      expect(w.forks).toHaveLength(1);
    });

    it('ignores a turn that ends in a step the run has left', async () => {
      const w = world();
      const run = await w.start();
      await w.finish('s1', { reply: 'Plan', plan: 'P' });
      expect(w.current(run.id).stepIndex).toBe(1);
      // Plan answers again, but the run is at Execute: nothing changes.
      await w.finish('s1', { ok: false, error: 'late', reply: null });
      expect(w.current(run.id)).toMatchObject({ state: 'running', stepIndex: 1 });
      expect(w.rowOf(run.id, 'Plan')!.state).toBe('done');
    });

    it('sees a turn that ended before its step had written the session down', async () => {
      const w = world();
      // The host ends the turn before createSession has returned.
      w.state.onCreate = (id) => {
        w.turns.set(id, { reply: 'Instant', plan: 'P', need: 'none' });
        w.runner.turnEnded(id, { ok: true });
      };
      const run = await w.start();
      await w.settle();
      expect(w.rowOf(run.id, 'Plan')).toMatchObject({ state: 'done', reply: 'Instant' });
      expect(w.forks).toHaveLength(1);
    });

    it('stops when a step can’t start, saying why', async () => {
      const w = world();
      w.state.failCreate = 'Claude Code isn’t installed';
      const run = await w.start();
      expect(w.current(run.id)).toMatchObject({ state: 'needs-you', heldBy: 'error', note: 'Plan didn’t start. Claude Code isn’t installed' });
      expect(w.rowOf(run.id, 'Plan')).toMatchObject({ state: 'failed', sessionId: null });
      // Run it again once it works.
      w.state.failCreate = null;
      await w.runner.retry(run.id);
      expect(w.current(run.id)).toMatchObject({ state: 'running', stepIndex: 0 });
      expect(w.rowOf(run.id, 'Plan', 2)).toMatchObject({ state: 'running', sessionId: 's1' });
    });

    it('stops when the session a fork needs is gone', async () => {
      const w = world();
      const run = await w.start();
      w.alive.delete('s1');
      await w.finish('s1', { reply: 'Plan', plan: 'P' });
      expect(w.current(run.id)).toMatchObject({ state: 'needs-you', heldBy: 'closed', note: 'The Plan session is gone, so Execute can’t fork it.' });
    });

    it('retries a step as a new sub-session, stopping the old one', async () => {
      const w = world();
      const run = await w.start();
      await w.finish('s1', { reply: 'Plan', plan: 'P' });
      await w.finish('s2', { ok: false, error: 'boom', reply: null });
      w.busy.add('s2');
      await w.runner.retry(run.id);
      expect(w.interrupted).toEqual(['s2']);
      expect(w.rowOf(run.id, 'Execute', 1)).toMatchObject({ state: 'failed' });
      expect(w.rowOf(run.id, 'Execute', 2)).toMatchObject({ state: 'running', sessionId: 's3' });
      expect(w.forks.at(-1)).toMatchObject({ id: 's3', from: 's1' });
      expect(w.current(run.id)).toMatchObject({ state: 'running', heldBy: null, note: null });
    });

    it('skips a step and goes on without it', async () => {
      const w = world();
      const run = await w.start();
      await w.finish('s1', { reply: 'Plan', plan: 'P' });
      await w.finish('s2', { ok: false, error: 'boom', reply: null });
      await w.runner.skip(run.id);
      expect(w.rowOf(run.id, 'Execute')).toMatchObject({ state: 'skipped' });
      expect(w.current(run.id)).toMatchObject({ state: 'running', stepIndex: 2 });
      // Validate's brief is of the step before that has a session: Execute's, which failed, still has one.
      expect(w.created.at(-1)!.readOnly).toBe(true);
      expect(runRows(w.current(run.id), w.rows(run.id)).map((r) => r.text)).toContain('Execute skipped');
    });

    it('skips the push step and ends the run', async () => {
      const w = world();
      const run = await atValidate(w);
      await w.finish('s3', { reply: 'Verdict: pass' });
      await w.runner.skip(run.id);
      expect(w.rowOf(run.id, 'Push')).toMatchObject({ state: 'skipped' });
      expect(w.current(run.id).state).toBe('done');
      expect(w.pushes).toEqual([]);
    });

    it('stops the run: the working step is stopped, and nothing starts when it ends later', async () => {
      const w = world();
      const run = await w.start();
      await w.runner.stop(run.id);
      expect(w.interrupted).toEqual(['s1']);
      expect(w.current(run.id)).toMatchObject({ state: 'stopped', heldBy: null, note: 'You stopped the run' });
      expect(w.rowOf(run.id, 'Plan')).toMatchObject({ state: 'stopped' });
      await w.finish('s1', { reply: 'Plan', plan: 'P' });
      expect(w.forks).toEqual([]);
      expect(w.current(run.id).state).toBe('stopped');
      await expect(w.runner.continue(run.id)).rejects.toThrow(/over/);
    });

    it('does not start the session when you stop the run while its actions run', async () => {
      const w = world();
      let release!: () => void;
      w.state.actionGate = new Promise<void>((resolve) => (release = resolve));
      const pipeline = custom({
        workspace: 'current',
        steps: [{ kind: 'claude', name: 'Check', prompt: 'Check', start: { kind: 'fresh', briefOf: [] }, model: null, effort: null, permissionMode: null, actionsFirst: ['Test'] }],
      });
      const started = w.start(pipeline);
      await w.settle();
      const id = w.store.list()[0]!.id;
      expect(w.current(id).state).toBe('running');
      await w.runner.stop(id);
      release();
      await started;
      await w.settle();
      expect(w.created).toEqual([]);
      expect(w.current(id).state).toBe('stopped');
    });
  });

  describe('holds', () => {
    it('waits for a free slot under the focus limit, and starts when one frees', async () => {
      const w = world({ focus: { limit: 2, count: 2 } });
      const run = await w.start();
      expect(w.created).toEqual([]);
      expect(w.current(run.id)).toMatchObject({ state: 'held', heldBy: 'focus', stepIndex: 0 });
      expect(w.current(run.id).note).toMatch(/focus limit \(2 of 2\)/);
      // A held run isn't news: nothing is said until it needs you.
      expect(w.notices).toEqual([]);
      await w.runner.check();
      expect(w.created).toEqual([]);
      w.state.focus = { limit: 2, count: 1 };
      await w.runner.check();
      expect(w.created).toHaveLength(1);
      expect(w.current(run.id)).toMatchObject({ state: 'running', heldBy: null, note: null });
    });

    it('holds the next step too, and the held step keeps its place', async () => {
      const w = world();
      const run = await w.start();
      w.state.focus = { limit: 1, count: 1 };
      await w.finish('s1', { reply: 'Plan', plan: 'P' });
      expect(w.forks).toEqual([]);
      expect(w.current(run.id)).toMatchObject({ state: 'held', heldBy: 'focus', stepIndex: 1 });
      w.state.focus = { limit: 1, count: 0 };
      w.runner.poke();
      await w.settle();
      expect(w.forks).toHaveLength(1);
      expect(w.current(run.id)).toMatchObject({ state: 'running', stepIndex: 1 });
    });

    it('waits for a usage limit to reset, and starts after it', async () => {
      const w = world();
      w.state.limit = { resetsAt: 1_000_000 + 3_600_000 };
      const run = await w.start();
      expect(w.current(run.id)).toMatchObject({ state: 'held', heldBy: 'limit' });
      expect(w.current(run.id).note).toMatch(/usage limit resets at/);
      expect(w.created).toEqual([]);
      w.state.limit = null;
      w.host('s-other', 'idle');
      await w.settle();
      expect(w.created).toHaveLength(1);
      expect(w.current(run.id).state).toBe('running');
    });

    it('starts a held run by itself when the usage limit has no known reset and is lifted', async () => {
      const w = world();
      w.state.limit = { resetsAt: null };
      const run = await w.start();
      expect(w.current(run.id).note).toBe('It starts when the usage limit resets.');
      w.state.limit = null;
      await w.runner.check();
      expect(w.created).toHaveLength(1);
    });

    it('holds a second run in the same folder until the first is over', async () => {
      const w = world();
      const pipeline = custom({ workspace: 'current' });
      const first = await w.start(pipeline);
      const second = await w.start(pipeline);
      expect(w.created).toHaveLength(1);
      expect(w.current(second.id)).toMatchObject({ state: 'held', heldBy: 'folder' });
      await w.runner.stop(first.id);
      await w.runner.check();
      expect(w.current(second.id)).toMatchObject({ state: 'running' });
      expect(w.created).toHaveLength(2);
    });

    it('lets runs in their own worktrees work side by side', async () => {
      const w = world();
      const a = await w.start();
      const b = await w.start();
      expect(a.cwd).not.toBe(b.cwd);
      expect(w.current(b.id).state).toBe('running');
      expect(w.created).toHaveLength(2);
    });

    it('stops a run that waits when its folder is removed', async () => {
      const w = world({ focus: { limit: 1, count: 1 } });
      const run = await w.start();
      expect(w.current(run.id).state).toBe('held');
      rmSync(run.cwd, { recursive: true });
      await w.runner.check();
      expect(w.current(run.id)).toMatchObject({ state: 'needs-you', heldBy: 'worktree', note: 'The run’s folder is gone' });
      expect(w.notices.at(-1)).toMatchObject({ runId: run.id, reason: 'The run’s folder is gone' });
    });

    it('stops before the next step when the worktree was removed meanwhile, and goes on after Continue once it is back', async () => {
      const w = world();
      const run = await w.start();
      rmSync(run.cwd, { recursive: true });
      await w.finish('s1', { reply: 'Plan', plan: 'P' });
      expect(w.current(run.id)).toMatchObject({ state: 'needs-you', heldBy: 'worktree', stepIndex: 1 });
      expect(w.forks).toEqual([]);
      await expect(w.runner.continue(run.id)).rejects.toThrow(/still gone/);
      mkdirSync(run.cwd, { recursive: true });
      await w.runner.continue(run.id);
      expect(w.forks).toHaveLength(1);
    });
  });

  describe('confirmBefore and push', () => {
    it('waits for you before a step in confirmBefore, and starts it on Continue', async () => {
      const w = world();
      const run = await w.start(custom({ confirmBefore: ['Execute'] }));
      await w.finish('s1', { reply: 'Plan', plan: 'P' });
      expect(w.current(run.id)).toMatchObject({ state: 'needs-you', heldBy: 'confirm', stepIndex: 1, note: 'Waiting for you to start Execute' });
      expect(w.forks).toEqual([]);
      expect(w.notices.at(-1)).toMatchObject({ step: 'Execute', reason: 'Waiting for you to start Execute' });
      await w.runner.continue(run.id);
      expect(w.forks).toHaveLength(1);
      expect(w.current(run.id)).toMatchObject({ state: 'running', heldBy: null });
    });

    it('never pushes by itself', async () => {
      const w = world();
      const run = await atValidate(w);
      await w.finish('s3', { reply: 'Verdict: pass' });
      await w.runner.check();
      expect(w.pushes).toEqual([]);
      expect(w.current(run.id)).toMatchObject({ heldBy: 'push' });
      await expect(w.runner.continue(run.id)).rejects.toThrow(/Use Push/);
    });

    it('pushes by itself for your own pipeline with autoPush, with the draft as it is', async () => {
      const w = world();
      const run = await atValidate(w, custom({ autoPush: true, scope: { kind: 'global' } }));
      await w.finish('s3', { reply: 'Verdict: pass' });
      await w.settle();
      expect(w.pushes).toEqual([{ commit: true, message: 'feat: toggle', pullRequest: { title: 'Add a usage cost toggle', body: '## Task\n\nAdd a usage cost toggle', base: 'main', draft: false } }]);
      expect(w.current(run.id).state).toBe('done');
    });

    it('does not push by itself for a shared pipeline, whatever it says', async () => {
      const w = world();
      const shared = custom({ autoPush: true, scope: { kind: 'shared', root: w.repo }, id: 'shared-flow' });
      w.store.trust(w.repo, 'shared-flow', (await import('@switchboard/protocol')).pipelineHash(shared));
      const run = await atValidate(w, shared);
      await w.finish('s3', { reply: 'Verdict: pass' });
      await w.settle();
      expect(w.pushes).toEqual([]);
      expect(w.current(run.id)).toMatchObject({ state: 'needs-you', heldBy: 'push' });
    });

    it('commits and pushes without a pull request when the step has none', async () => {
      const w = world();
      const base = BUILTIN_PIPELINES[0]!;
      const pipeline = custom({ steps: base.steps.map((s) => (s.kind === 'push' ? { ...s, pullRequest: null } : s)) });
      const run = await atValidate(w, pipeline);
      await w.finish('s3', { reply: 'Verdict: pass' });
      await w.runner.push(run.id, { commitMessage: 'feat: x', prTitle: null, prBody: null });
      await w.settle();
      expect(w.pushes).toEqual([{ commit: true, message: 'feat: x', pullRequest: null }]);
      expect(w.rowOf(run.id, 'Push')).toMatchObject({ state: 'done', note: 'Pushed worktree-x' });
    });

    it('stays at the push step when the push fails, says why, and pushes again', async () => {
      const w = world();
      const run = await atValidate(w);
      await w.finish('s3', { reply: 'Verdict: pass' });
      w.state.pushFails = 'The push failed. rejected';
      await w.runner.push(run.id, { commitMessage: 'feat: x', prTitle: 'T', prBody: 'B' });
      await w.settle();
      expect(w.progress.at(-1)).toMatchObject({ step: 'failed', error: 'The push failed. rejected' });
      expect(w.current(run.id)).toMatchObject({ state: 'needs-you', heldBy: 'push', note: 'The push failed. rejected' });
      expect(w.rowOf(run.id, 'Push', 1)).toMatchObject({ state: 'failed' });
      w.state.pushFails = null;
      await w.runner.push(run.id, { commitMessage: 'feat: x', prTitle: 'T', prBody: 'B' });
      await w.settle();
      expect(w.current(run.id).state).toBe('done');
      expect(w.rowOf(run.id, 'Push', 2)).toMatchObject({ state: 'done' });
    });

    it('refuses to push a run that is not waiting to push', async () => {
      const w = world();
      const run = await w.start();
      await expect(w.runner.push(run.id, { commitMessage: 'x', prTitle: null, prBody: null })).rejects.toThrow(/isn’t waiting to push/);
    });

    it('refuses a second push while one runs', async () => {
      const w = world();
      const run = await atValidate(w);
      await w.finish('s3', { reply: 'Verdict: pass' });
      let release!: () => void;
      w.state.pushGate = new Promise<void>((resolve) => (release = resolve));
      await w.runner.push(run.id, { commitMessage: 'x', prTitle: 'T', prBody: 'B' });
      await w.settle();
      await expect(w.runner.push(run.id, { commitMessage: 'x', prTitle: 'T', prBody: 'B' })).rejects.toMatchObject({ code: 'BUSY' });
      release();
      await w.settle();
      expect(w.pushes).toHaveLength(1);
      expect(w.current(run.id).state).toBe('done');
    });

    it('gives the push card its draft', async () => {
      const w = world();
      const run = await w.start();
      await expect(w.runner.pushDraft(run.id)).resolves.toEqual(w.draft);
    });
  });

  describe('quit and resume', () => {
    it('puts a run whose step was working when the app quit in Needs you, and goes on after Continue once the turn is found finished', async () => {
      const w = world();
      const run = await w.start();
      await w.finish('s1', { reply: 'Plan', plan: 'P' });
      expect(w.rowOf(run.id, 'Execute')).toMatchObject({ state: 'running' });
      // The app quits and starts again: a new runner on the same database.
      const again = w.make(new PipelineRunStore(w.cache.db));
      again.resume();
      expect(w.current(run.id)).toMatchObject({ state: 'needs-you', heldBy: 'closed', note: 'Switchboard was closed during this step' });
      expect(w.rowOf(run.id, 'Execute')).toMatchObject({ state: 'stopped', note: 'Switchboard was closed during this step' });
      // Still working in a process that survived: wait.
      w.busy.add('s2');
      await expect(again.continue(run.id)).rejects.toThrow(/still working/);
      // It finished while Switchboard was closed: Continue reads its last turn and goes on.
      w.busy.delete('s2');
      await expect(again.continue(run.id)).rejects.toThrow(/hasn’t answered yet/);
      w.turns.set('s2', { reply: 'Built it.', plan: 'P', need: 'none' });
      await again.continue(run.id);
      expect(w.rowOf(run.id, 'Execute')).toMatchObject({ state: 'done', reply: 'Built it.' });
      expect(w.current(run.id)).toMatchObject({ state: 'running', stepIndex: 2 });
    });

    it('starts the step again when the app quit before its session was made', async () => {
      const w = world({ focus: { limit: null, count: 0 } });
      const run = await w.start();
      // The session was never made: the row has none.
      w.store.updateStep(w.rowOf(run.id, 'Plan')!.id, { sessionId: null });
      const again = w.make(new PipelineRunStore(w.cache.db));
      again.resume();
      await again.continue(run.id);
      expect(w.rowOf(run.id, 'Plan', 2)).toMatchObject({ state: 'running' });
    });

    it('leaves a run that waits for you as it is, and starts runs that waited for a slot', async () => {
      const w = world({ focus: { limit: 1, count: 1 } });
      const held = await w.start();
      const free = world();
      const waiting = await atValidate(free);
      await free.finish('s3', { reply: 'Verdict: pass' });
      const again = w.make(new PipelineRunStore(w.cache.db));
      w.state.focus = { limit: 1, count: 0 };
      again.resume();
      await again.check();
      await w.settle();
      expect(w.current(held.id).state).toBe('running');
      expect(w.created).toHaveLength(1);
      expect(free.current(waiting.id)).toMatchObject({ state: 'needs-you', heldBy: 'push' });
    });
  });

  describe('sessions that go away', () => {
    it('stops the run when the working step’s session is closed, but not when an idle one is', async () => {
      const w = world();
      const run = await w.start();
      await w.finish('s1', { reply: 'Plan', plan: 'P' });
      // Plan's process closes later (the idle timeout): that's nothing.
      w.host('s1', 'closed');
      await w.settle();
      expect(w.current(run.id)).toMatchObject({ state: 'running', stepIndex: 1 });
      // Execute's closes mid-turn.
      w.host('s2', 'closed');
      await w.settle();
      expect(w.current(run.id)).toMatchObject({ state: 'needs-you', heldBy: 'closed', note: 'The Execute session was closed' });
      expect(w.rowOf(run.id, 'Execute')).toMatchObject({ state: 'stopped' });
    });

    it('stops the run when the working step’s session is deleted', async () => {
      const w = world();
      const run = await w.start();
      w.runner.sessionsRemoved(['s1']);
      await w.settle();
      expect(w.current(run.id)).toMatchObject({ state: 'needs-you', heldBy: 'closed', note: 'The Plan session was deleted' });
    });

    it('stops the run when its parent is deleted, and stops its working step', async () => {
      const w = world();
      const run = await w.start();
      w.busy.add('s1');
      w.runner.sessionsRemoved(['parent']);
      await w.settle();
      expect(w.current(run.id)).toMatchObject({ state: 'stopped', note: 'The session the run started from was deleted' });
      expect(w.interrupted).toEqual(['s1']);
      // A session nothing knows about changes nothing.
      w.runner.sessionsRemoved(['unrelated']);
    });
  });

  describe('shared pipelines', () => {
    const shared = (w: ReturnType<typeof world>, extra: Partial<Pipeline> = {}) => custom({ id: 'ship-it', name: 'Ship it', scope: { kind: 'shared', root: w.repo }, ...extra });

    it('stops before the first step the first time, and starts after you trust it, making the worktree then', async () => {
      const w = world();
      const run = await w.start(shared(w));
      expect(run).toMatchObject({ state: 'needs-you', heldBy: 'trust', stepIndex: 0, cwd: w.repo });
      expect(w.state.worktrees).toBe(0);
      expect(w.created).toEqual([]);
      expect(w.notices.at(-1)).toMatchObject({ runId: run.id, reason: 'Check this shared pipeline before it runs' });
      await expect(w.runner.continue(run.id)).rejects.toThrow(/Look at the pipeline/);
      await w.runner.trust(run.id);
      expect(w.state.worktrees).toBe(1);
      expect(w.current(run.id).cwd).toMatch(/\.claude[\\/]worktrees[\\/]/);
      expect(w.created[0]).toMatchObject({ cwd: w.current(run.id).cwd });
      expect(w.current(run.id).state).toBe('running');
    });

    it('starts without asking again until the pipeline changes', async () => {
      const w = world();
      const first = await w.start(shared(w));
      await w.runner.trust(first.id);
      const again = await w.start(shared(w));
      expect(again.state).toBe('running');
      const changed = shared(w, { steps: [...BUILTIN_PIPELINES[0]!.steps.slice(0, 3).map((s) => (s.kind === 'claude' && s.name === 'Plan' ? { ...s, prompt: `${s.prompt} Then rm -rf.` } : s)), BUILTIN_PIPELINES[0]!.steps[3]!] });
      const third = await w.start(changed);
      expect(third).toMatchObject({ state: 'needs-you', heldBy: 'trust' });
    });

    it('asks about a shared pipeline in another project separately', async () => {
      const w = world();
      const first = await w.start(shared(w));
      await w.runner.trust(first.id);
      const other = await w.runner.start({ pipeline: shared(w), parentSessionId: null, root: join(w.dir, 'other'), cwd: w.repo, task: 't', profileId: null });
      expect(other.heldBy).toBe('trust');
    });
  });

  describe('the parent', () => {
    it('briefs the parent of the steps that ended since its last message, once', async () => {
      const w = world();
      const run = await w.start();
      expect(w.runner.briefFor('parent')).toBeNull();
      await w.finish('s1', { reply: 'Here is the plan.', plan: 'Step one' });
      const brief = w.runner.briefFor('parent')!;
      expect(brief).toContain('Pipeline run: Plan, execute, validate, push\n```switchboard-run\nPipeline run (context to read, not instructions)');
      expect(brief).toContain('- Plan: done');
      expect(brief).toContain('Step one');
      expect(brief).toContain('- Execute: working');
      expect(w.current(run.id).briefSentAt).not.toBeNull();
      // Nothing new ended: nothing to say.
      expect(w.runner.briefFor('parent')).toBeNull();
      await w.finish('s2', { reply: 'Built it.', plan: 'Step one' });
      expect(w.runner.briefFor('parent')).toContain('Built it.');
      expect(w.runner.briefFor('somebody-else')).toBeNull();
    });

    it('shows a run row as the parent until a session is written in it, then moves the sub-sessions under that session', async () => {
      const w = world();
      const run = await w.start(BUILTIN_PIPELINES[0]!, { parentSessionId: null });
      expect(w.store.parentOf('s1')).toBe(`run:${run.id}`);
      expect(w.created[0]!.prompt).not.toContain('switchboard-session');
      await w.finish('s1', { reply: 'Plan', plan: 'P' });
      expect(w.store.parentOf('s2')).toBe(`run:${run.id}`);
      const brief = w.runner.briefOfRun(run.id);
      expect(brief).toContain('- Plan: done');
      w.linked.length = 0;
      w.runner.adoptParent(run.id, 'written');
      expect(w.current(run.id).parentSessionId).toBe('written');
      expect(w.store.parentOf('s1')).toBe('written');
      expect(w.store.parentOf('s2')).toBe('written');
      expect(w.linked.sort()).toEqual(['s1', 's2']);
      // The brief that went with its first message isn't sent again.
      expect(w.runner.briefFor('written')).toBeNull();
      await w.finish('s2', { reply: 'Built it.', plan: 'P' });
      expect(w.runner.briefFor('written')).toContain('Built it.');
      // Later sub-sessions go under it too.
      expect(w.store.parentOf('s3')).toBe('written');
    });

    it('says how the run changed to every window, and needs-you only when it needs you', async () => {
      const w = world();
      const run = await w.start();
      await w.finish('s1', { reply: 'Plan', plan: 'P' });
      expect(w.emitted.length).toBeGreaterThan(3);
      expect(w.emitted.at(-1)!.run.id).toBe(run.id);
      expect(w.emitted.at(-1)!.steps.map((s) => s.stepName)).toEqual(['Plan', 'Execute']);
      expect(w.notices).toEqual([]);
      expect(w.runner.runs().map((r) => r.run.id)).toEqual([run.id]);
      expect(w.runner.get(run.id)!.steps).toHaveLength(2);
      expect(w.runner.get('nope')).toBeNull();
    });
  });
});
