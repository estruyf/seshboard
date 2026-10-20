import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_PIPELINES, pipelineHash, type PipelineBody, type PipelineSave } from '@switchboard/protocol';
import { openCacheDatabase } from '../db/database.ts';
import { createSessionSettingsStore } from '../host/sessionSettings.ts';
import { removeDir } from '../util/removeDir.ts';
import { PipelineStore } from './pipelineStore.ts';
import { PipelineRunStore } from './runStore.ts';

const dirs: string[] = [];
const databases: { close(): void }[] = [];
afterEach(async () => {
  databases.splice(0).forEach((db) => db.close());
  await Promise.all(dirs.splice(0).map((d) => removeDir(d)));
});

function world() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-pipelines-')));
  dirs.push(dir);
  const project = join(dir, 'app');
  mkdirSync(project);
  const cache = openCacheDatabase(join(dir, 'cache.sqlite'));
  databases.push(cache.db);
  let now = 1_000;
  const clock = () => now;
  return { dir, project, cache, store: new PipelineStore(cache.db, clock), runs: new PipelineRunStore(cache.db, clock), tick: (ms = 1_000) => (now += ms) };
}

const body = (extra: Partial<PipelineBody> = {}): Omit<PipelineSave, 'scope'> => ({
  name: 'Check and push',
  workspace: 'worktree',
  steps: [
    { kind: 'claude', name: 'Work', prompt: '{{task}}', start: { kind: 'fresh' }, model: null, effort: null, permissionMode: null },
    { kind: 'push', name: 'Push', commit: true, pullRequest: null },
  ],
  confirmBefore: [],
  ...extra,
});

describe('PipelineStore', () => {
  it('lists the built-in pipelines first, then yours', () => {
    const { store, project } = world();
    store.save({ ...body({ name: 'Mine everywhere' }), scope: { kind: 'global' } });
    store.save({ ...body({ name: 'Mine here' }), scope: { kind: 'project', root: project } });
    expect(store.list().pipelines.map((p) => p.name)).toEqual([...BUILTIN_PIPELINES.map((p) => p.name), 'Mine everywhere']);
    const withRoot = store.list(project).pipelines;
    expect(withRoot.map((p) => [p.name, p.scope.kind])).toEqual([
      ...BUILTIN_PIPELINES.map((p) => [p.name, 'builtin']),
      ['Mine everywhere', 'global'],
      ['Mine here', 'project'],
    ]);
  });

  it('keeps a project’s pipelines to that project', () => {
    const { store, project, dir } = world();
    store.save({ ...body(), scope: { kind: 'project', root: project } });
    expect(store.list(join(dir, 'other')).pipelines.filter((p) => p.scope.kind === 'project')).toEqual([]);
  });

  it('creates, changes and deletes one of yours, keeping its id and when it was made', () => {
    const { store, tick } = world();
    const made = store.save({ ...body(), scope: { kind: 'global' } });
    tick();
    const changed = store.save({ ...body({ name: 'Renamed' }), id: made.id, scope: { kind: 'global' } });
    expect(changed).toMatchObject({ id: made.id, name: 'Renamed', createdAt: made.createdAt });
    expect(changed.updatedAt).toBeGreaterThan(made.updatedAt);
    expect(store.get(made.id, { kind: 'global' }).name).toBe('Renamed');
    store.remove(made.id, { kind: 'global' });
    expect(store.find(made.id, { kind: 'global' })).toBeNull();
    expect(() => store.get(made.id, { kind: 'global' })).toThrow(/gone/);
  });

  it('does not find a pipeline in another scope, and refuses to change a built-in', () => {
    const { store, project } = world();
    const made = store.save({ ...body(), scope: { kind: 'global' } });
    expect(store.find(made.id, { kind: 'project', root: project })).toBeNull();
    expect(() => store.remove(BUILTIN_PIPELINES[0]!.id, { kind: 'builtin' })).toThrow(/can’t be deleted/);
    expect(store.find(BUILTIN_PIPELINES[0]!.id, { kind: 'builtin' })?.name).toBe(BUILTIN_PIPELINES[0]!.name);
  });

  it('refuses a pipeline that can’t run', () => {
    const { store } = world();
    const steps = body().steps;
    expect(() => store.save({ ...body({ steps: [steps[0]!, { ...steps[0]!, name: 'Work' }] }), scope: { kind: 'global' } })).toThrow(/both called “Work”/);
    expect(() => store.save({ ...body({ confirmBefore: ['Nope'] }), scope: { kind: 'global' } })).toThrow(/“Nope”/);
  });

  it('duplicates a built-in into yours, as a copy it can change', () => {
    const { store, project } = world();
    const copy = store.duplicate(BUILTIN_PIPELINES[0]!.id, { kind: 'builtin' }, { kind: 'project', root: project });
    expect(copy).toMatchObject({ name: 'Plan, execute, validate, push copy', scope: { kind: 'project', root: project } });
    expect(copy.id).not.toBe(BUILTIN_PIPELINES[0]!.id);
    expect(copy.steps).toEqual(BUILTIN_PIPELINES[0]!.steps);
    const named = store.duplicate(copy.id, copy.scope, { kind: 'global' }, 'Another');
    expect(named).toMatchObject({ name: 'Another', scope: { kind: 'global' } });
  });

  it('keeps autoPush on your own, and not when copied into the project’s shared file', () => {
    const { store, project } = world();
    const own = store.save({ ...body({ autoPush: true }), scope: { kind: 'global' } });
    expect(own.autoPush).toBe(true);
    const shared = store.duplicate(own.id, own.scope, { kind: 'shared', root: project });
    expect(shared.autoPush).toBeUndefined();
    expect(readFileSync(join(project, '.switchboard.json'), 'utf8')).not.toContain('autoPush');
  });

  describe('shared in .switchboard.json', () => {
    it('writes a pipeline under `pipelines`, keeping the rest of the file, and reads it back', () => {
      const { store, project } = world();
      writeFileSync(join(project, '.switchboard.json'), JSON.stringify({ actions: [{ id: 'test', name: 'Test', command: 'npm test' }], other: 1 }, null, 4));
      const saved = store.save({ ...body({ name: 'Plan & ship' }), scope: { kind: 'shared', root: project } });
      expect(saved).toMatchObject({ id: 'plan-ship', scope: { kind: 'shared', root: project } });
      const file = JSON.parse(readFileSync(join(project, '.switchboard.json'), 'utf8'));
      expect(file.other).toBe(1);
      expect(file.actions).toHaveLength(1);
      expect(file.pipelines).toHaveLength(1);
      expect(Object.keys(file.pipelines[0]).slice(0, 3)).toEqual(['id', 'name', 'workspace']);
      expect(readFileSync(join(project, '.switchboard.json'), 'utf8')).toContain('\n    "pipelines"');
      expect(store.list(project).pipelines.find((p) => p.id === 'plan-ship')?.steps).toHaveLength(2);
      // Saving again changes it where it is.
      store.save({ ...body({ name: 'Plan & ship v2' }), id: 'plan-ship', scope: { kind: 'shared', root: project } });
      expect(store.shared(project).pipelines.map((p) => [p.id, p.name])).toEqual([['plan-ship', 'Plan & ship v2']]);
      store.remove('plan-ship', { kind: 'shared', root: project });
      expect(JSON.parse(readFileSync(join(project, '.switchboard.json'), 'utf8')).pipelines).toBeUndefined();
    });

    it('makes room for a second pipeline with the same name', () => {
      const { store, project } = world();
      const scope = { kind: 'shared', root: project } as const;
      store.save({ ...body(), scope });
      const second = store.save({ ...body(), scope });
      expect(second.id).toBe('check-and-push-2');
    });

    it('refuses bypass permissions in a shared pipeline', () => {
      const { store, project } = world();
      const steps = body().steps.map((s) => (s.kind === 'claude' ? { ...s, permissionMode: 'bypassPermissions' as const } : s));
      expect(() => store.save({ ...body({ steps }), scope: { kind: 'shared', root: project } })).toThrow(/can’t bypass permissions/);
      expect(() => store.save({ ...body({ steps }), scope: { kind: 'global' } })).not.toThrow();
    });

    it('reads a hand-written file as it will run: default mode instead of bypass, no autoPush, and says so', () => {
      const { store, project } = world();
      writeFileSync(
        join(project, '.switchboard.json'),
        JSON.stringify({
          pipelines: [
            {
              name: 'Risky',
              autoPush: true,
              steps: [
                { kind: 'claude', name: 'Go', prompt: 'Do {{task}}', permissionMode: 'bypassPermissions' },
                { kind: 'push', name: 'Push', commit: true, pullRequest: null },
              ],
            },
            { name: 'Broken', steps: [] },
            { name: 'Risky', steps: [{ kind: 'claude', name: 'Dup', prompt: 'x' }] },
          ],
        }),
      );
      const { pipelines, errors } = store.shared(project);
      expect(pipelines).toHaveLength(1);
      expect(pipelines[0]!.id).toBe('risky');
      expect(pipelines[0]!.autoPush).toBeUndefined();
      expect(pipelines[0]!.steps[0]).toMatchObject({ permissionMode: 'default' });
      expect(pipelines[0]!.issues).toHaveLength(2);
      expect(errors).toHaveLength(2);
      expect(errors[0]).toMatch(/pipeline 2: It doesn’t read/);
      expect(errors[1]).toMatch(/pipeline 3: another pipeline has the id “risky”/);
    });

    it('reports a file that does not read, and refuses to overwrite it', () => {
      const { store, project } = world();
      writeFileSync(join(project, '.switchboard.json'), '{ nope');
      expect(store.shared(project)).toMatchObject({ pipelines: [], errors: [expect.stringContaining('.switchboard.json')] });
      expect(() => store.save({ ...body(), scope: { kind: 'shared', root: project } })).toThrow(/won't overwrite/);
    });
  });

  it('exports and restores your own, by id, with their project', () => {
    const a = world();
    const made = a.store.save({ ...body(), scope: { kind: 'project', root: a.project } });
    const global = a.store.save({ ...body({ name: 'Everywhere' }), scope: { kind: 'global' } });
    const all = a.store.ownAll();
    expect(all.map((x) => [x.pipeline.id, x.root])).toEqual([
      [made.id, a.project],
      [global.id, null],
    ]);
    const b = world();
    b.store.restore({ ...made, scope: { kind: 'project', root: b.project } });
    expect(b.store.list(b.project).pipelines.find((p) => p.id === made.id)).toMatchObject({ name: made.name, scope: { kind: 'project', root: b.project } });
    b.store.removeOwn(made.id);
    expect(b.store.ownAll()).toEqual([]);
  });
});

describe('PipelineRunStore', () => {
  const run = (w: ReturnType<typeof world>, extra = {}) =>
    w.runs.create({ pipeline: BUILTIN_PIPELINES[0]!, parentSessionId: 'parent', root: w.project, cwd: w.project, task: 'Add a toggle', blanks: { a: 'b' }, profileId: null, state: 'running', heldBy: null, ...extra });

  it('keeps a run with a snapshot of its pipeline and reads it back', () => {
    const w = world();
    const made = run(w);
    expect(made).toMatchObject({ pipelineId: 'plan-execute-validate-push', parentSessionId: 'parent', task: 'Add a toggle', blanks: { a: 'b' }, state: 'running', stepIndex: 0, loopTo: null, briefSentAt: null });
    expect(made.pipeline.steps.map((s) => s.name)).toEqual(['Plan', 'Execute', 'Validate', 'Push']);
    w.tick();
    const next = w.runs.update(made.id, { state: 'needs-you', heldBy: 'push', stepIndex: 3, note: 'Ready to push' })!;
    expect(next).toMatchObject({ state: 'needs-you', heldBy: 'push', stepIndex: 3, note: 'Ready to push' });
    expect(next.updatedAt).toBeGreaterThan(made.updatedAt);
    // null clears a field, and a field left out stays.
    expect(w.runs.update(made.id, { heldBy: null, loopTo: null })).toMatchObject({ heldBy: null, note: 'Ready to push' });
    expect(w.runs.get('nope')).toBeNull();
  });

  it('separates runs that are over from the ones that are not', () => {
    const w = world();
    const a = run(w);
    const b = run(w, { state: 'held', heldBy: 'focus' });
    const c = run(w);
    w.runs.update(c.id, { state: 'done' });
    expect(w.runs.active().map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
    expect(w.runs.hasWaiting()).toBe(true);
    w.runs.update(b.id, { state: 'running', heldBy: null });
    expect(w.runs.hasWaiting()).toBe(false);
    w.runs.update(a.id, { state: 'needs-you', heldBy: 'confirm' });
    expect(w.runs.hasWaiting()).toBe(true);
    w.runs.update(a.id, { heldBy: 'reply' });
    expect(w.runs.hasWaiting()).toBe(false);
  });

  it('finds the runs of a parent, newest first', () => {
    const w = world();
    const first = run(w);
    w.tick();
    const second = run(w);
    run(w, { parentSessionId: 'other' });
    expect(w.runs.ofParent('parent').map((r) => r.id)).toEqual([second.id, first.id]);
  });

  it('keeps a row per step and round, and finds the step of a session', () => {
    const w = world();
    const made = run(w);
    const one = w.runs.addStep({ runId: made.id, stepIndex: 0, stepName: 'Plan', round: 1, state: 'running' });
    w.runs.updateStep(one.id, { sessionId: 's1', state: 'done', reply: 'Planned', plan: 'The plan', verdict: 'pass', endedAt: 5 });
    w.runs.addStep({ runId: made.id, stepIndex: 2, stepName: 'Validate', round: 2, state: 'running' });
    w.runs.addStep({ runId: made.id, stepIndex: 2, stepName: 'Validate', round: 1, state: 'done' });
    expect(w.runs.steps(made.id).map((s) => [s.stepIndex, s.round])).toEqual([[0, 1], [2, 1], [2, 2]]);
    expect(w.runs.stepOfSession('s1')).toMatchObject({ stepName: 'Plan', state: 'done', reply: 'Planned', plan: 'The plan', verdict: 'pass', endedAt: 5 });
    expect(w.runs.stepOfSession('nope')).toBeNull();
    expect(w.runs.allSteps().get(made.id)).toHaveLength(3);
  });

  it('keeps the tree apart from the sessions, and moves a run row’s children under the session it gets', () => {
    const w = world();
    const made = run(w, { parentSessionId: null });
    w.runs.link('s1', `run:${made.id}`, made.id);
    w.runs.link('s2', `run:${made.id}`, made.id);
    expect(w.runs.parentOf('s1')).toBe(`run:${made.id}`);
    expect(w.runs.parentOf('plain')).toBeUndefined();
    // A new store (the engine restarted) has it from the database.
    expect(new PipelineRunStore(w.cache.db).parentOf('s2')).toBe(`run:${made.id}`);
    expect(w.runs.repoint(made.id, `run:${made.id}`, 'real').sort()).toEqual(['s1', 's2']);
    expect(w.runs.parentOf('s1')).toBe('real');
    expect(new PipelineRunStore(w.cache.db).parentOf('s1')).toBe('real');
    w.runs.unlink('s1');
    expect(w.runs.parentOf('s1')).toBeUndefined();
    expect(w.runs.childrenOfRun(made.id)).toEqual(['s2']);
  });

  it('forgets a run with its steps and links', () => {
    const w = world();
    const made = run(w);
    w.runs.addStep({ runId: made.id, stepIndex: 0, stepName: 'Plan', round: 1, state: 'done', sessionId: 's1' });
    w.runs.link('s1', 'parent', made.id);
    w.runs.remove(made.id);
    expect(w.runs.get(made.id)).toBeNull();
    expect(w.runs.steps(made.id)).toEqual([]);
    expect(w.runs.parentOf('s1')).toBeUndefined();
  });

  it('forgets runs that ended long ago when the engine starts', () => {
    const w = world();
    const old = run(w);
    w.runs.update(old.id, { state: 'done' });
    const recent = run(w);
    w.runs.update(recent.id, { state: 'done' });
    const stuck = run(w);
    const later = new PipelineRunStore(w.cache.db, () => 1_000 + 91 * 24 * 3_600_000);
    expect(later.list().map((r) => r.id)).toEqual([stuck.id]);
    expect(later.get(old.id)).toBeNull();
  });

  it('remembers which version of a shared pipeline you trusted', () => {
    const w = world();
    const hash = pipelineHash(BUILTIN_PIPELINES[0]!);
    expect(w.runs.isTrusted(w.project, 'ship', hash)).toBe(false);
    w.runs.trust(w.project, 'ship', hash);
    expect(w.runs.isTrusted(w.project, 'ship', hash)).toBe(true);
    expect(w.runs.isTrusted(w.project, 'ship', pipelineHash(BUILTIN_PIPELINES[1]!))).toBe(false);
    expect(w.runs.isTrusted(w.project, 'other', hash)).toBe(false);
    w.runs.trust(w.project, 'ship', pipelineHash(BUILTIN_PIPELINES[1]!));
    expect(w.runs.isTrusted(w.project, 'ship', hash)).toBe(false);
  });

  it('keeps a session read only in the settings, apart from its other choices', () => {
    const w = world();
    const settings = createSessionSettingsStore(w.cache.db);
    settings.set('s1', { model: 'opus' });
    expect(settings.get('s1')?.readOnly).toBe(false);
    settings.set('s1', { readOnly: true });
    expect(settings.get('s1')).toMatchObject({ model: 'opus', readOnly: true });
    settings.set('s1', { model: 'sonnet' });
    expect(settings.get('s1')).toMatchObject({ model: 'sonnet', readOnly: true });
  });
});
