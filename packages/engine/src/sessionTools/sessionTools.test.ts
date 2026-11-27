import { describe, expect, it } from 'vitest';
import type { ApprovalAnswer, ApprovalAsk, Pipeline, Schedule, Trigger } from '@seshboard/protocol';
import { NOTIFY_PER_HOUR, SessionTools, type SessionToolsDeps } from './sessionTools.ts';

// The tools check paths with this platform's AbsolutePath, which takes only a drive path on Windows.
const BASE = process.platform === 'win32' ? 'C:/work' : '/work';
const ROOT = `${BASE}/app`;
const OTHER = `${BASE}/site`;

const builtIn: Pipeline = { id: 'builtin-review', name: 'Review', builtIn: true, scope: { kind: 'all' }, autoPush: false, createdAt: 1, updatedAt: 1, steps: [{ kind: 'claude', name: 'Review', start: 'fresh', model: null, effort: null, permissionMode: 'plan', readOnly: true, prompt: 'Review {{task}}', actionsFirst: [], verdict: null, confirmBefore: false, approvePlan: false }] };

const PIPELINE = {
  name: 'Plan, build, review',
  autoPush: true,
  steps: [
    { kind: 'claude', name: 'Plan', model: 'opus', permissionMode: 'plan', prompt: 'Plan {{task}}', approvePlan: true },
    { kind: 'claude', name: 'Build', model: 'sonnet', start: { fork: 'Plan' }, permissionMode: 'acceptEdits', prompt: 'Build it' },
    { kind: 'claude', name: 'Review', model: 'opus', readOnly: true, actionsFirst: ['Test'], verdict: { sendTo: 'Build', rounds: 2 }, prompt: 'Review it' },
    { kind: 'push', name: 'Push', draft: true },
  ],
};

function setup(overrides: Partial<SessionToolsDeps> = {}) {
  const asks: ApprovalAsk[] = [];
  let answer: ApprovalAnswer = { allowed: true, message: null, reply: { options: {} } };
  const calls: Array<{ method: string; params: unknown }> = [];
  const pipelines: Pipeline[] = [builtIn];
  const triggers: Trigger[] = [];
  const schedules: Schedule[] = [];
  const notified: string[] = [];
  const runs: string[] = [];
  let now = Date.UTC(2026, 10, 26, 10, 0);
  const handlers: Record<string, (params: any) => unknown> = {
    'pipelines.list': ({ root }) => ({ pipelines: root ? pipelines.filter((p) => p.scope.kind === 'all' || p.scope.root === root) : pipelines }),
    'pipelines.save': ({ pipeline }) => {
      const saved = { ...pipeline, id: pipeline.id ?? `p${pipelines.length}`, builtIn: false, createdAt: now, updatedAt: now };
      pipelines.push(saved);
      return { pipeline: saved };
    },
    'pipelines.delete': ({ id }) => ({ pipeline: pipelines.find((p) => p.id === id) ?? null }),
    'pipelines.run': ({ pipelineId }) => ({ state: { run: { id: `run-${pipelineId}`, status: 'running' }, steps: [] } }),
    'triggers.list': () => ({ triggers, events: [], sessions: [] }),
    'triggers.save': ({ trigger }) => {
      const saved = { ...trigger, id: trigger.id ?? `t${triggers.length}` } as Trigger;
      triggers.push(saved);
      return { trigger: saved };
    },
    'triggers.setPaused': () => ({}),
    'schedules.list': () => ({ schedules, sessions: [] }),
    'schedules.save': ({ schedule }) => {
      const saved = { ...schedule, id: schedule.id ?? `s${schedules.length}` } as Schedule;
      schedules.push(saved);
      return { schedule: saved };
    },
    'actions.list': () => ({ actions: [{ id: 'test', name: 'Test', type: 'shell', command: 'npm test', cwd: 'session', scope: 'project', trusted: true }, { id: 'ask', name: 'Ask', type: 'prompt', command: 'Explain', cwd: 'session', scope: 'project', trusted: true }], sharedFile: null, errors: [] }),
    'actions.save': () => ({}),
    'usage.get': () => ({ usage: { fetchedAt: now, limits: [{ kind: 'session', group: 's', percent: 42.4, resetsAt: null, scope: null, severity: 'normal', isActive: true }], extraUsage: null }, error: null }),
    'limits.state': () => ({ limits: [], resumes: [], gaveUp: [] }),
    'worktrees.remove': ({ items }) => ({ results: items.map((i: { path: string }) => ({ path: i.path, ok: true, code: null, error: null })) }),
  };
  const tools = new SessionTools({
    session: (id) => (id === 'elsewhere' ? { projectRoot: OTHER, cwd: OTHER, profileId: null, title: 'Elsewhere' } : { projectRoot: ROOT, cwd: `${ROOT}/.claude/worktrees/w1`, profileId: 'default', title: id === 'old' ? 'Old work' : 'This one' }),
    projects: () => [
      { root: ROOT, name: 'app' },
      { root: OTHER, name: 'site' },
    ],
    call: (async (method: string, params: unknown) => {
      calls.push({ method, params });
      const handler = handlers[method];
      if (!handler) throw new Error(`unexpected ${method}`);
      return handler(params);
    }) as SessionToolsDeps['call'],
    ask: async (_id, ask) => (asks.push(ask), answer),
    startChild: async () => ({ text: 'child' }),
    listComputers: async () => ({ text: 'computers' }),
    draftFor: (_id, args) => ({ draft: { cwd: ROOT, prompt: args.prompt, workspace: 'worktree', permissionMode: 'acceptEdits', model: args.model } }),
    queueChild: () => 'item-1',
    findSessions: async (_root, query) => (query === 'auth' ? [{ id: 'old', title: 'Old work', updatedAt: now - 86_400_000 }] : []),
    catchUp: () => null,
    brief: async (_from, id, label) => `brief of ${label} (${id})`,
    notify: (_id, text) => (notified.push(text), true),
    runAction: async (_id, _root, _cwd, id) => (runs.push(id), { exitCode: 0, stopped: false, output: 'ok 12 tests' }),
    handOff: async () => 'next-1',
    mergedWorktrees: async () => [{ path: `${ROOT}/.claude/worktrees/done`, branch: 'done' }],
    labels: async () => ['bug'],
    now: () => now,
    log: () => {},
    ...overrides,
  });
  return { tools, asks, calls, pipelines, triggers, schedules, notified, runs, answer: (a: Partial<ApprovalAnswer>) => (answer = { allowed: true, message: null, reply: {}, ...a }), tick: (ms: number) => (now += ms) };
}

describe('save_pipeline', () => {
  it('shows the steps, every prompt and the risky choices unticked, then saves what you allowed', async () => {
    const { tools, asks, pipelines } = setup();
    const result = await tools.run('s1', 'save_pipeline', { pipeline: PIPELINE });
    expect(asks[0]!.title).toBe('wants to save a pipeline: "Plan, build, review"');
    expect(asks[0]!.tool).toBe('mcp__seshboard__save_pipeline');
    const card = asks[0]!.card;
    expect(card.lines.map((l) => [l.text, l.detail])).toEqual([
      ['A new pipeline', 'for this project (app)'],
      ['Plan', 'Opus · plan mode · plan approved for you'],
      ['Build', 'Sonnet · forked from Plan · accept edits'],
      ['Review', 'Opus · read only · runs Test first · verdict → Build, 2 rounds'],
      ['Push', 'draft pull request (waits for you)'],
    ]);
    expect(card.blocks.map((b) => b.label)).toEqual(['Plan’s prompt', 'Build’s prompt', 'Review’s prompt']);
    expect(card.options.map((o) => [o.key, o.checked])).toEqual([
      ['autoPush', false],
      ['approvePlan:Plan', false],
    ]);
    expect(card.editor).toBe('pipeline');
    // The editors start where the card does: with the risky choices off.
    expect(card.draft).toMatchObject({ root: ROOT, isNew: true, value: { id: '', name: 'Plan, build, review', autoPush: false, scope: { kind: 'project', root: ROOT } } });
    // Nothing was ticked: the pull request waits for you, and the plan too.
    const saved = pipelines.at(-1)!;
    expect(saved.autoPush).toBe(false);
    expect(saved.steps[0]).toMatchObject({ approvePlan: false });
    expect(result.text).toContain('Saved "Plan, build, review"');
  });

  it('keeps a risky choice you ticked', async () => {
    const { tools, pipelines, answer } = setup();
    answer({ reply: { options: { autoPush: true } } });
    await tools.run('s1', 'save_pipeline', { pipeline: PIPELINE });
    expect(pipelines.at(-1)!.autoPush).toBe(true);
  });

  it('saves nothing when you deny it, and passes on what you said', async () => {
    const { tools, calls, answer } = setup();
    answer({ allowed: false, message: 'Use Haiku for the plan' });
    const result = await tools.run('s1', 'save_pipeline', { pipeline: PIPELINE });
    expect(result.text).toContain('The user did not save the pipeline. They said: Use Haiku for the plan');
    expect(calls.some((c) => c.method === 'pipelines.save')).toBe(false);
  });

  it('says what the editor saved when you opened it there', async () => {
    const { tools, calls, answer } = setup();
    answer({ reply: { saved: { id: 'p9', name: 'Plan and build' } } });
    expect((await tools.run('s1', 'save_pipeline', { pipeline: PIPELINE })).text).toContain('saved it as "Plan and build" (p9)');
    expect(calls.some((c) => c.method === 'pipelines.save')).toBe(false);
  });

  it('refuses before any card: bypass, a broken pipeline, a built-in to change', async () => {
    const { tools, asks } = setup();
    const bypass = await tools.run('s1', 'save_pipeline', { pipeline: { ...PIPELINE, steps: [{ kind: 'claude', name: 'Go', permissionMode: 'bypassPermissions', prompt: 'x' }] } });
    expect(bypass).toMatchObject({ error: true, text: expect.stringContaining('bypasses permissions') });
    const broken = await tools.run('s1', 'save_pipeline', { pipeline: { ...PIPELINE, steps: [{ kind: 'claude', name: 'Build', start: { fork: 'Nowhere' }, prompt: 'x' }] } });
    expect(broken).toMatchObject({ error: true, text: expect.stringContaining('The pipeline has problems') });
    const built = await tools.run('s1', 'save_pipeline', { pipeline: { ...PIPELINE, id: 'builtin-review' } });
    expect(built).toMatchObject({ error: true, text: expect.stringContaining('can only be copied') });
    expect(asks).toEqual([]);
  });

  it('checks a draft without saving or asking', async () => {
    const { tools, asks, calls } = setup();
    expect((await tools.run('s1', 'check_pipeline', { pipeline: PIPELINE })).text).toBe('The pipeline is fine. save_pipeline asks the user to save it.');
    expect((await tools.run('s1', 'check_pipeline', { pipeline: { name: 'x', steps: [] } })).text).toContain('problems');
    expect(asks).toEqual([]);
    expect(calls.some((c) => c.method === 'pipelines.save')).toBe(false);
  });
});

describe('run_pipeline', () => {
  it('asks, then runs under the session; an orchestrator runs a run row without a card', async () => {
    const { tools, asks, calls } = setup();
    const run = await tools.run('s1', 'run_pipeline', { pipeline: 'review', task: 'the login fix' });
    expect(asks[0]!.card).toMatchObject({ kind: 'run', allowLabel: 'Run', blocks: [{ label: 'Task', text: 'the login fix' }, { label: 'Review’s prompt' }] });
    expect(calls.at(-1)).toEqual({ method: 'pipelines.run', params: { pipelineId: 'builtin-review', parentSessionId: 's1', task: 'the login fix', project: null } });
    expect(run.text).toContain('runs as run run-builtin-review, under this session');
    await tools.run('orc', 'run_pipeline', { pipeline: 'Review', task: 'docs' }, true);
    expect(asks).toHaveLength(1);
    expect(calls.at(-1)).toEqual({ method: 'pipelines.run', params: { pipelineId: 'builtin-review', parentSessionId: null, task: 'docs', project: ROOT } });
    expect(await tools.run('s1', 'run_pipeline', { pipeline: 'Deploy' })).toMatchObject({ error: true, text: expect.stringContaining('Pick one of: Review') });
  });
});

describe('save_trigger', () => {
  const TRIGGER = { name: 'Bugs for me', source: { kind: 'issues', label: 'bug', assignee: '@me', collaboratorsOnly: false }, prompt: 'Fix {{event.title}}', stateLabels: { on: true }, assignOnPickUp: true };

  it('saves a new trigger paused, and its risky parts off, unless you tick them', async () => {
    const { tools, asks, triggers } = setup();
    await tools.run('s1', 'save_trigger', { trigger: TRIGGER });
    const card = asks[0]!.card;
    expect(card.lines[0]).toMatchObject({ text: 'Watches', detail: 'Issues labelled bug assigned to @me from anyone' });
    expect(card.options.map((o) => o.key)).toEqual(['watch', 'stateLabels', 'assign', 'anyone']);
    expect(card.blocks).toEqual([{ label: 'Prompt for each event', text: 'Fix {{event.title}}' }]);
    expect(triggers[0]).toMatchObject({ projectRoot: ROOT, paused: true, assignOnPickUp: false, stateLabels: { on: false }, source: { collaboratorsOnly: true } });
  });

  it('watches at once when you tick it', async () => {
    const { tools, triggers, answer } = setup();
    answer({ reply: { options: { watch: true, anyone: true } } });
    await tools.run('s1', 'save_trigger', { trigger: TRIGGER });
    expect(triggers[0]).toMatchObject({ paused: false, source: { collaboratorsOnly: false } });
  });

  it('never saves bypass, and checks without saving', async () => {
    const { tools, asks } = setup();
    expect(await tools.run('s1', 'save_trigger', { trigger: { ...TRIGGER, draft: { permissionMode: 'bypassPermissions' } } })).toMatchObject({ error: true });
    expect((await tools.run('s1', 'check_trigger', { trigger: { ...TRIGGER, source: { kind: 'issues' } } })).text).toContain('Pick a label, an assignee, or both');
    expect((await tools.run('s1', 'check_trigger', { trigger: TRIGGER })).text).toContain('fine');
    expect(asks).toEqual([]);
  });
});

describe('the other saves', () => {
  it('saves a schedule in this project, with its rule on the card', async () => {
    const { tools, asks, schedules } = setup();
    await tools.run('s1', 'save_schedule', { schedule: { name: 'Morning review', rule: { kind: 'weekdays', time: '09:00' }, draft: { prompt: 'Review open pull requests' } } });
    expect(asks[0]!.card.lines[0]).toMatchObject({ text: 'Runs' });
    expect(asks[0]!.card.blocks).toEqual([{ label: 'Prompt', text: 'Review open pull requests' }]);
    expect(schedules[0]).toMatchObject({ name: 'Morning review', draft: { cwd: ROOT } });
  });

  it('shows an action’s command in full', async () => {
    const { tools, asks, calls } = setup();
    await tools.run('s1', 'save_action', { action: { id: 'lint', name: 'Lint', command: 'npm run lint -- --fix' }, shared: true });
    expect(asks[0]!.card.blocks).toEqual([{ label: 'Command', text: 'npm run lint -- --fix' }]);
    expect(asks[0]!.description).toContain('for everyone on the project');
    expect(calls.at(-1)).toMatchObject({ method: 'actions.save', params: { projectRoot: ROOT, shared: true, action: { id: 'lint' } } });
  });

  it('pauses and deletes only what is this project’s, after a card', async () => {
    const { tools, triggers, calls, asks } = setup();
    triggers.push({ id: 't1', projectRoot: ROOT, name: 'CI', source: { kind: 'ci', branch: null, workflows: [] }, paused: false } as unknown as Trigger);
    triggers.push({ id: 't2', projectRoot: OTHER, name: 'Theirs', source: { kind: 'ci', branch: null, workflows: [] }, paused: false } as unknown as Trigger);
    await tools.run('s1', 'set_paused', { kind: 'trigger', id: 't1', paused: true });
    expect(calls.at(-1)).toEqual({ method: 'triggers.setPaused', params: { id: 't1', paused: true } });
    expect(await tools.run('s1', 'set_paused', { kind: 'trigger', id: 't2', paused: true })).toMatchObject({ error: true });
    expect(await tools.run('s1', 'delete', { kind: 'pipeline', id: 'builtin-review' })).toMatchObject({ error: true, text: expect.stringContaining('can’t be deleted') });
    expect(asks).toHaveLength(1);
  });
});

describe('the helpers', () => {
  it('runs a shell action, asking only the first time', async () => {
    const { tools, asks, runs } = setup();
    expect((await tools.run('s1', 'run_action', { action: 'Test' })).text).toBe('"Test" exited with 0. The end of its output:\nok 12 tests');
    await tools.run('s1', 'run_action', { action: 'test' });
    expect(asks).toHaveLength(1);
    expect(asks[0]!.card.blocks).toEqual([{ label: 'Command', text: 'npm test' }]);
    expect(runs).toEqual(['test', 'test']);
    expect(await tools.run('s1', 'run_action', { action: 'Ask' })).toMatchObject({ error: true });
  });

  it('notifies at most once a minute and ten times an hour', async () => {
    const { tools, notified, tick } = setup();
    expect((await tools.run('s1', 'notify_me', { text: 'Tests pass' })).text).toBe('Sent to the user’s phone.');
    expect(await tools.run('s1', 'notify_me', { text: 'Again' })).toMatchObject({ error: true });
    for (let i = 1; i < NOTIFY_PER_HOUR; i++) {
      tick(61_000);
      await tools.run('s1', 'notify_me', { text: `n${i}` });
    }
    tick(61_000);
    expect(await tools.run('s1', 'notify_me', { text: 'one too many' })).toMatchObject({ error: true, text: expect.stringContaining('in the last hour') });
    expect(notified).toHaveLength(NOTIFY_PER_HOUR);
  });

  it('finds and reads sessions of this project only', async () => {
    const { tools } = setup();
    expect((await tools.run('s1', 'find_sessions', { query: 'auth' })).text).toContain('old "Old work"');
    expect((await tools.run('s1', 'read_session', { session: 'old' })).text).toBe('brief of Old work (old)');
    expect(await tools.run('s1', 'read_session', { session: 'elsewhere' })).toMatchObject({ error: true });
  });

  it('starts later: after the reset in the queue, or at a time as a schedule', async () => {
    const { tools, asks, schedules } = setup();
    expect((await tools.run('s1', 'start_later', { prompt: 'Run the full suite', when: 'reset' })).text).toContain('waits in the queue (item item-1)');
    await tools.run('s1', 'start_later', { title: 'Nightly', prompt: 'Run it', when: 'at', at: '2026-11-27T09:00' });
    expect(schedules[0]).toMatchObject({ name: 'Nightly', rule: { kind: 'once', date: '2026-11-27', time: '09:00' } });
    expect(asks.map((a) => a.card.kind)).toEqual(['later', 'later']);
    expect(await tools.run('s1', 'start_later', { prompt: 'x', when: 'at', at: '2020-01-01T09:00' })).toMatchObject({ error: true });
  });

  it('says the limits, hands off and cleans up merged worktrees after a card', async () => {
    const { tools, calls, asks } = setup();
    expect((await tools.run('s1', 'usage', {})).text).toContain('- session: 42% used');
    expect((await tools.run('s1', 'hand_off', { brief: 'Goal: X. Done: Y.' })).text).toContain('session next-1');
    expect(asks.at(-1)!.card.blocks).toEqual([{ label: 'Brief', text: 'Goal: X. Done: Y.' }]);
    expect((await tools.run('s1', 'clean_worktrees', {})).text).toBe('Removed 1 of 1.');
    expect(calls.at(-1)).toMatchObject({ method: 'worktrees.remove', params: { root: ROOT, items: [{ deleteBranch: true, recoveryRef: true }] } });
  });

  it('names another project only when asked, and refuses one it doesn’t know', async () => {
    const { tools } = setup();
    expect((await tools.run('s1', 'list_pipelines', { project: 'site' })).text).toContain('builtin-review');
    expect(await tools.run('s1', 'list_triggers', { project: 'nowhere' })).toMatchObject({ error: true, text: expect.stringContaining('Pick one of: app, site') });
  });
});
