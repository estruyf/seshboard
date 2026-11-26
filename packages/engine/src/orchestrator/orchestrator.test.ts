import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isSessionUpdate, ORCHESTRATOR_MAX_WORKING, ORCHESTRATOR_PROMPT, WORKER_JUDGMENT, type CatchUp, type LaterDraft, type ProfileDefaults, type ProjectDefaults, type SessionStartAsk, type WorkerStatus } from '@seshboard/protocol';
import { openCacheDatabase } from '../db/database.ts';
import { Orchestrator, type OrchestratorDeps } from './orchestrator.ts';
import { OrchestratorBridge } from './orchestratorBridge.ts';
import { OrchestratorStore } from './orchestratorStore.ts';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

function tempStore() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-orchestrator-')));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const cache = openCacheDatabase(join(dir, 'cache.sqlite'));
  cleanups.unshift(() => cache.close());
  let now = 1_000;
  return { cache, store: new OrchestratorStore(cache.db, () => now++) };
}

const ROOT = '/work/app';
const AGENTS = [
  { profileId: 'default', name: 'Work', agent: 'Claude Code', worktree: true },
  { profileId: 'copilot-1', name: 'Copilot', agent: 'GitHub Copilot', worktree: true },
  { profileId: 'codex-1', name: 'Codex', agent: 'OpenAI Codex', worktree: false },
];
const card = (state: CatchUp['state'], did: string[] = [], need = ''): CatchUp =>
  ({ sessionId: 's', turnId: 't', generatedAt: 0, source: 'fallback', state, ask: '', did, skipped: [], need: { kind: 'none', title: need, text: need }, signals: { tests: null, diff: null, outOfScope: [], scope: null, plan: null }, reviewMinutes: 1 }) as unknown as CatchUp;

function setup(overrides: Partial<OrchestratorDeps> = {}) {
  const { store } = tempStore();
  const started: Array<{ draft: LaterDraft; title: string; instructions: string | null }> = [];
  const queued: LaterDraft[] = [];
  const sent: Array<{ sessionId: string; text: string }> = [];
  const parents = new Map<string, string>();
  const asks: Array<{ sessionId: string; ask: SessionStartAsk }> = [];
  let answer = true;
  const status = new Map<string, WorkerStatus>();
  let defaults = {} as ProjectDefaults;
  const profileDefaults = new Map<string, ProfileDefaults>();
  let changes = 0;
  const orchestrator = new Orchestrator({
    store,
    session: () => ({ projectRoot: ROOT, profileId: 'default' }),
    defaults: () => defaults,
    profileDefaults: (id) => profileDefaults.get(id) ?? ({} as ProfileDefaults),
    globals: () => ({ model: null, effort: null }),
    inRepo: () => true,
    agents: () => AGENTS,
    hold: () => null,
    queue: (draft) => (queued.push(draft), `item-${queued.length}`),
    start: async (draft, title, instructions) => (started.push({ draft, title, instructions }), `worker-${started.length}`),
    setParent: (sessionId, parent) => void parents.set(sessionId, parent),
    askStart: async (sessionId, ask) => (asks.push({ sessionId, ask }), answer),
    status: (id) => status.get(id) ?? 'working',
    info: async () => ({ gone: false, branch: 'fix-login', pr: null }),
    pr: () => null,
    catchUp: () => null,
    brief: async (_from, id, label) => `brief of ${label} (${id})`,
    send: async (sessionId, text) => void sent.push({ sessionId, text }),
    changed: () => void changes++,
    log: () => {},
    ...overrides,
  });
  orchestrator.mark('orc', ROOT);
  return { orchestrator, store, started, queued, sent, parents, asks, answer: (value: boolean) => (answer = value), status, changes: () => changes, setDefaults: (d: Partial<ProjectDefaults>) => (defaults = d as ProjectDefaults), setProfileDefaults: (id: string, d: Partial<ProfileDefaults>) => void profileDefaults.set(id, d as ProfileDefaults) };
}

describe('Orchestrator: start_session', () => {
  it('starts a session in its own worktree, in the project’s mode, under the orchestrator', async () => {
    const { orchestrator, started, parents, store } = setup();
    const result = await orchestrator.run('orc', 'start_session', { title: 'Fix login', prompt: 'Fix the redirect.' });
    expect(result).toEqual({ text: expect.stringContaining('Started "Fix login" as session worker-1, in its own worktree') });
    expect(started[0]).toMatchObject({ title: 'Fix login', instructions: expect.stringContaining(WORKER_JUDGMENT), draft: { cwd: ROOT, prompt: 'Fix the redirect.', workspace: 'worktree', permissionMode: 'acceptEdits', profileId: 'default', baseRef: 'fresh' } });
    expect(parents.get('worker-1')).toBe('orc');
    expect(store.workersOf('orc')).toMatchObject([{ sessionId: 'worker-1', itemId: null, title: 'Fix login' }]);
    expect(orchestrator.infos()).toMatchObject([{ sessionId: 'orc', projectRoot: ROOT, workers: [{ sessionId: 'worker-1', title: 'Fix login', pr: null }] }]);
  });

  it('uses the project’s defaults and gives its instructions to the session', async () => {
    const { orchestrator, started, setDefaults } = setup();
    setDefaults({ model: 'sonnet', effort: 'low', permissionMode: 'plan', baseRef: 'head', orchestratorInstructions: 'Branch from dev.' });
    await orchestrator.run('orc', 'start_session', { title: 'Docs', prompt: 'Write them.', model: 'haiku' });
    expect(started[0]!.draft).toMatchObject({ model: 'haiku', effort: 'low', permissionMode: 'plan', baseRef: 'head' });
    expect(started[0]!.instructions).toContain('Branch from dev.');
  });

  it('takes its profile’s defaults where the project sets none, and the global model last', async () => {
    const { orchestrator, started, setDefaults, setProfileDefaults } = setup({ globals: () => ({ model: 'opus', effort: 'high' }) });
    setProfileDefaults('default', { permissionMode: 'auto', effort: 'medium', baseRef: 'head' });
    await orchestrator.run('orc', 'start_session', { title: 'A', prompt: 'a' });
    expect(started[0]!.draft).toMatchObject({ model: 'opus', effort: 'medium', permissionMode: 'auto', baseRef: 'head' });
    setDefaults({ permissionMode: 'plan' });
    await orchestrator.run('orc', 'start_session', { title: 'B', prompt: 'b' });
    expect(started[1]!.draft.permissionMode).toBe('plan');
    setDefaults({ permissionMode: null, globalPermissionMode: true });
    setProfileDefaults('default', {});
    await orchestrator.run('orc', 'start_session', { title: 'C', prompt: 'c' });
    expect(started[2]!.draft).toMatchObject({ permissionMode: 'acceptEdits', baseRef: 'fresh' });
  });

  it('starts with the orchestrator’s own profile, not the project’s, when no agent is asked for', async () => {
    const { orchestrator, started } = setup({ session: (id) => ({ projectRoot: ROOT, profileId: id === 'orc' ? 'copilot-1' : 'default' }) });
    const result = await orchestrator.run('orc', 'start_session', { title: 'A', prompt: 'a' });
    expect(started[0]!.draft.profileId).toBe('copilot-1');
    expect(result.text).toContain('with Copilot');
  });

  it('starts with another agent by its profile’s or its own name, in the folder when it has no worktrees', async () => {
    const { orchestrator, started } = setup();
    await orchestrator.run('orc', 'start_session', { title: 'A', prompt: 'a', agent: 'copilot' });
    const codex = await orchestrator.run('orc', 'start_session', { title: 'B', prompt: 'b', agent: 'OpenAI Codex', workspace: 'worktree' });
    expect(started.map((s) => [s.draft.profileId, s.draft.workspace])).toEqual([
      ['copilot-1', 'worktree'],
      ['codex-1', 'current'],
    ]);
    expect(codex.text).toContain('a worktree is not possible here');
    const unknown = await orchestrator.run('orc', 'start_session', { title: 'C', prompt: 'c', agent: 'gemini' });
    expect(unknown).toMatchObject({ error: true, text: expect.stringContaining('Work, Copilot, Codex') });
  });

  it('queues a start at a limit, and puts it under the orchestrator once it starts', async () => {
    const { orchestrator, started, queued, parents, store } = setup({ hold: () => ({ reason: 'at the focus limit', detail: 'It starts when a slot frees.' }) });
    const result = await orchestrator.run('orc', 'start_session', { title: 'Later', prompt: 'x' });
    expect(result.text).toContain('waits in the queue: It starts when a slot frees.');
    expect(started).toEqual([]);
    expect(queued).toHaveLength(1);
    expect(store.workersOf('orc')).toMatchObject([{ sessionId: null, itemId: 'item-1' }]);
    expect(await orchestrator.run('orc', 'list_sessions', {})).toMatchObject({ text: expect.stringContaining('Queued (1):\n- (no id yet) "Later"') });
    expect(orchestrator.itemStarted('item-1', 'worker-9')).toBe('Later');
    expect(parents.get('worker-9')).toBe('orc');
    expect(store.workersOf('orc')).toMatchObject([{ sessionId: 'worker-9', itemId: null }]);
    expect(orchestrator.itemStarted('someone-elses', 'x')).toBeNull();
  });

  it('refuses a start beyond the most that work at once, and bad arguments', async () => {
    const { orchestrator } = setup();
    for (let i = 0; i < ORCHESTRATOR_MAX_WORKING; i++) await orchestrator.run('orc', 'start_session', { title: `T${i}`, prompt: 'x' });
    expect(await orchestrator.run('orc', 'start_session', { title: 'One more', prompt: 'x' })).toMatchObject({ error: true, text: expect.stringContaining('work already') });
    expect(await orchestrator.run('orc', 'start_session', { title: '', prompt: 'x' })).toMatchObject({ error: true });
  });

  it('says why a start failed', async () => {
    const { orchestrator, store } = setup({ start: async () => Promise.reject(new Error('Folder not found')) });
    expect(await orchestrator.run('orc', 'start_session', { title: 'X', prompt: 'x' })).toEqual({ error: true, text: 'Could not start "X": Folder not found' });
    expect(store.workersOf('orc')).toEqual([]);
  });
});

describe('Orchestrator: its sessions', () => {
  it('lists them by state with the agents, reads one and messages one, only its own', async () => {
    const { orchestrator, status, sent } = setup();
    await orchestrator.run('orc', 'start_session', { title: 'Fix login', prompt: 'x' });
    await orchestrator.run('orc', 'start_session', { title: 'Docs', prompt: 'y' });
    status.set('worker-2', 'needsYou');
    const list = await orchestrator.run('orc', 'list_sessions', {});
    expect(list.text).toContain('Waiting on you (1):\n- worker-2 "Docs": Work, branch fix-login');
    expect(list.text).toContain('Working (1):\n- worker-1 "Fix login"');
    expect(list.text).toContain('Work, Copilot, Codex');
    expect(await orchestrator.run('orc', 'read_session', { session: 'worker-1' })).toEqual({ text: 'brief of Fix login (worker-1)' });
    expect(await orchestrator.run('orc', 'message_session', { session: 'worker-1', text: ' Use dev. ' })).toMatchObject({ text: expect.stringContaining('Sent to "Fix login"') });
    expect(sent).toEqual([{ sessionId: 'worker-1', text: 'Use dev.' }]);
    expect(await orchestrator.run('orc', 'read_session', { session: 'not-mine' })).toMatchObject({ error: true });
    expect(await orchestrator.run('orc', 'message_session', { session: 'not-mine', text: 'x' })).toMatchObject({ error: true });
    expect(await orchestrator.run('not-an-orchestrator', 'list_sessions', {})).toMatchObject({ error: true });
  });

  it('tells the orchestrator how a session’s turn ended, but not one you stopped or another session’s', async () => {
    const { orchestrator, sent } = setup();
    await orchestrator.run('orc', 'start_session', { title: 'Fix login', prompt: 'x' });
    orchestrator.turnEnded('worker-1', 'clean', card('finished', ['Changed 2 files']));
    orchestrator.turnEnded('worker-1', 'clean', card('waiting', [], 'Run the migration?'));
    orchestrator.turnEnded('worker-1', 'error', null);
    orchestrator.turnEnded('worker-1', 'stopped', null);
    orchestrator.turnEnded('orc', 'clean', null);
    orchestrator.turnEnded('stranger', 'clean', null);
    expect(sent.map((s) => s.sessionId)).toEqual(['orc', 'orc', 'orc']);
    expect(sent.every((s) => isSessionUpdate(s.text))).toBe(true);
    expect(sent[0]!.text).toContain('"Fix login" (worker-1) finished its turn');
    expect(sent[0]!.text).toContain('- Changed 2 files');
    expect(sent[1]!.text).toContain('waits for the user');
    expect(sent[1]!.text).toContain('It asks: Run the migration?');
    expect(sent[2]!.text).toContain('failed');
  });

  it('gives an orchestrator its role and a session it started the project’s instructions', async () => {
    const { orchestrator, setDefaults } = setup();
    await orchestrator.run('orc', 'start_session', { title: 'Fix login', prompt: 'x' });
    expect(orchestrator.systemTextFor('orc')).toBe(ORCHESTRATOR_PROMPT);
    // Without instructions of the project's own, it still gets the built-in judgment line.
    expect(orchestrator.systemTextFor('worker-1')).toContain(WORKER_JUDGMENT);
    expect(orchestrator.systemTextFor('worker-1')).not.toContain('Instructions for this project');
    setDefaults({ orchestratorInstructions: 'Run make test.' });
    expect(orchestrator.systemTextFor('orc')).toContain('Run make test.');
    expect(orchestrator.systemTextFor('worker-1')).toContain('Run make test.');
    expect(orchestrator.systemTextFor('worker-1')).not.toContain('You are the orchestrator');
    expect(orchestrator.systemTextFor('stranger')).toBeNull();
    expect(orchestrator.systemTextForNew(ROOT)).toContain('You are the orchestrator');
  });

  it('forgets a deleted session: an orchestrator stops being one, a started one leaves the list', async () => {
    const { orchestrator, store } = setup();
    await orchestrator.run('orc', 'start_session', { title: 'A', prompt: 'x' });
    await orchestrator.run('orc', 'start_session', { title: 'B', prompt: 'x' });
    orchestrator.sessionRemoved('worker-1');
    expect(store.workersOf('orc').map((w) => w.sessionId)).toEqual(['worker-2']);
    orchestrator.sessionRemoved('orc');
    expect(orchestrator.isOrchestrator('orc')).toBe(false);
    expect(store.orchestratorOf('worker-2')).toBeNull();
  });
});

describe('OrchestratorStore', () => {
  it('keeps orchestrators and what they started across a restart', () => {
    const { cache, store } = tempStore();
    store.add('orc', ROOT);
    store.addWorker('orc', { sessionId: 'w1', itemId: null, title: 'One' });
    store.addWorker('orc', { sessionId: null, itemId: 'i1', title: 'Two' });
    const again = new OrchestratorStore(cache.db);
    expect(again.get('orc')).toMatchObject({ projectRoot: ROOT });
    expect(again.workersOf('orc').map((w) => [w.sessionId, w.itemId, w.title])).toEqual([
      ['w1', null, 'One'],
      [null, 'i1', 'Two'],
    ]);
    expect(again.itemRemoved('i1')).toBe(true);
    expect(again.itemRemoved('i1')).toBe(false);
    expect(again.orchestratorOf('w1')).toBe('orc');
  });
});

describe('Orchestrator: a session that asks to start another', () => {
  it('asks on a card, then starts the session under the one that asked, without instructions or updates', async () => {
    const { orchestrator, started, parents, asks, store, sent } = setup({ session: (id) => ({ projectRoot: ROOT, profileId: id === 'plain' ? 'copilot-1' : 'default' }) });
    const result = await orchestrator.startChild('plain', { title: 'Fix lint', prompt: 'Fix the lint errors.' });
    expect(asks).toEqual([{ sessionId: 'plain', ask: { title: 'Fix lint', prompt: 'Fix the lint errors.', agent: 'Copilot', workspace: 'worktree' } }]);
    expect(result).toEqual({ text: expect.stringContaining('The user allowed it. Started "Fix lint" as session worker-1, in its own worktree, with Copilot') });
    expect(started[0]).toMatchObject({ title: 'Fix lint', instructions: null, draft: { cwd: ROOT, workspace: 'worktree', profileId: 'copilot-1', permissionMode: 'acceptEdits' } });
    expect(parents.get('worker-1')).toBe('plain');
    // Not an orchestrator's worker: its turns tell no one.
    expect(store.workersOf('plain')).toEqual([]);
    orchestrator.turnEnded('worker-1', 'clean', null);
    expect(sent).toEqual([]);
    expect(orchestrator.systemTextFor('worker-1')).toBeNull();
  });

  it('tells the windows about each session it starts, with its parent and title, until the session is deleted', async () => {
    const { orchestrator, changes } = setup();
    const before = changes();
    await Promise.all(['PR 1', 'PR 2'].map((title) => orchestrator.startChild('plain', { title, prompt: `Review ${title}.` })));
    // Sent at once, so a window nests them under the session while they start, before their transcripts exist.
    expect(orchestrator.startedChildren()).toEqual([
      { sessionId: 'worker-1', parentId: 'plain', title: 'PR 1' },
      { sessionId: 'worker-2', parentId: 'plain', title: 'PR 2' },
    ]);
    expect(changes() - before).toBe(2);
    // Not an orchestrator: nothing about it goes with the orchestrators.
    expect(orchestrator.infos().map((o) => o.sessionId)).toEqual(['orc']);
    orchestrator.sessionRemoved('worker-1');
    expect(orchestrator.startedChildren()).toEqual([{ sessionId: 'worker-2', parentId: 'plain', title: 'PR 2' }]);
    expect(changes() - before).toBe(3);
  });

  it('starts nothing when you deny it, or when the arguments are wrong', async () => {
    const { orchestrator, started, asks, answer } = setup();
    answer(false);
    expect(await orchestrator.startChild('plain', { title: 'Fix lint', prompt: 'Fix it.' })).toEqual({ text: expect.stringContaining('The user did not start "Fix lint"') });
    expect(await orchestrator.startChild('plain', { title: 'No prompt' })).toMatchObject({ error: true });
    expect(await orchestrator.startChild('plain', { title: 'A', prompt: 'a', agent: 'Gemini' })).toMatchObject({ error: true, text: expect.stringContaining('No agent called "Gemini"') });
    expect(asks).toHaveLength(1);
    expect(started).toEqual([]);
  });

  it('waits in the queue at a limit, and goes under the session once it starts', async () => {
    const { orchestrator, queued, parents } = setup({ hold: () => ({ reason: 'focus', detail: 'The focus limit is reached.' }) });
    expect(await orchestrator.startChild('plain', { title: 'Fix lint', prompt: 'Fix it.' })).toEqual({ text: expect.stringContaining('waits in the queue: The focus limit is reached.') });
    expect(queued).toHaveLength(1);
    expect(orchestrator.itemStarted('item-1', 'later-1')).toBe('Fix lint');
    expect(parents.get('later-1')).toBe('plain');
    expect(orchestrator.startedChildren()).toEqual([{ sessionId: 'later-1', parentId: 'plain', title: 'Fix lint' }]);
    expect(orchestrator.itemStarted('item-1', 'later-2')).toBeNull();
  });

  it('runs in the project’s folder where a worktree is not possible, and names no agent when there is one', async () => {
    const { orchestrator, asks, started } = setup({ inRepo: () => false, agents: () => AGENTS.slice(0, 1) });
    await orchestrator.startChild('plain', { title: 'Notes', prompt: 'Write notes.' });
    expect(asks[0]!.ask).toMatchObject({ agent: null, workspace: 'current' });
    expect(started[0]!.draft.workspace).toBe('current');
  });
});

describe('Orchestrator: a session that asks to start one on another computer', () => {
  const PROJECTS = { projects: [{ id: '0000000000000a01', name: 'site', repo: 'me/site' }, { id: '0000000000000a02', name: 'Work app', repo: 'me/app' }] };
  function remote(overrides: { connected?: boolean; projects?: unknown; created?: unknown; fail?: string; clonePlan?: unknown; cloned?: unknown } = {}) {
    const calls: Array<{ computerId: string; method: string; params: unknown }> = [];
    const computers = {
      list: () => [
        { id: 'c1', name: 'mystic', connected: overrides.connected ?? true, features: ['projects.clone'] },
        { id: 'c2', name: 'Windows box', connected: false },
      ],
      // The clone's last progress, as that computer sends it once the clone is done.
      next: async (_id: string, _name: string, match: (payload: unknown) => boolean) => {
        // The engine listens before it asks for the clone, so the progress can't come first.
        await new Promise((resolve) => setTimeout(resolve, 0));
        const jobId = (calls.find((c) => c.method === 'projects.clone')?.params as { jobId?: string } | undefined)?.jobId ?? 'none';
        const payload = { jobId, state: 'done', projectId: '0000000000000a09', brings: null, error: null, ...((overrides.cloned as object) ?? {}) };
        return match(payload) ? payload : null;
      },
      call: async (computerId: string, method: string, params: unknown) => {
        calls.push({ computerId, method, params });
        if (overrides.fail && method === overrides.fail) throw new Error('UNAVAILABLE');
        if (method === 'projects.list') return overrides.projects ?? PROJECTS;
        if (method === 'options.get') return { profiles: [{ id: 'prof-work', name: 'Work' }, { id: 'prof-cop', name: 'Copilot', provider: { id: 'copilot' } }] };
        if (method === 'session.create') return overrides.created ?? { sessionId: 'remote-1' };
        if (method === 'projects.clonePlan') return overrides.clonePlan ?? { state: 'free', repo: { owner: 'me', name: 'app' }, name: 'app', where: '~/Developer/app' };
        if (method === 'projects.clone') return {};
        throw new Error(`unexpected ${method}`);
      },
    };
    return { computers, calls, localProject: async () => ({ name: 'app', repos: ['me/app'] }) };
  }

  it('finds the project by its repository, asks on a card that names the computer, then starts it there', async () => {
    const { computers, calls, localProject } = remote();
    const { orchestrator, asks, started, parents } = setup({ computers, localProject });
    const result = await orchestrator.startChild('plain', { title: 'Windows smoke', prompt: 'Run the smoke.', computer: 'MYSTIC', agent: 'copilot', workspace: 'current', model: 'sonnet' });
    expect(asks).toEqual([{ sessionId: 'plain', ask: { title: 'Windows smoke', prompt: 'Run the smoke.', agent: 'Copilot', workspace: 'current', computer: 'mystic', project: 'Work app' } }]);
    expect(calls.at(-1)).toEqual({ computerId: 'c1', method: 'session.create', params: { projectId: '0000000000000a02', prompt: 'Run the smoke.', title: 'Windows smoke', profileId: 'prof-cop', model: 'sonnet', worktree: false } });
    expect(result).toEqual({ text: expect.stringContaining('Started "Windows smoke" on mystic as session remote-1, in its project "Work app".') });
    // Nothing starts here, and nothing nests: a parent works within one computer.
    expect(started).toEqual([]);
    expect(parents.size).toBe(0);
  });

  it('leaves the workspace and the agent to the project there when the call leaves them out', async () => {
    const { computers, calls, localProject } = remote();
    const { orchestrator, asks } = setup({ computers, localProject });
    await orchestrator.startChild('plain', { title: 'A', prompt: 'a', computer: 'mystic' });
    expect(asks[0]!.ask).toMatchObject({ agent: null, workspace: null });
    expect(calls.map((c) => c.method)).toEqual(['projects.list', 'session.create']);
    expect(calls[1]!.params).toEqual({ projectId: '0000000000000a02', prompt: 'a', title: 'A' });
  });

  it('refuses before the card: an unknown or offline computer, no such project there, an unknown agent', async () => {
    const { computers, localProject } = remote();
    const { orchestrator, asks } = setup({ computers, localProject });
    expect(await orchestrator.startChild('plain', { title: 'A', prompt: 'a', computer: 'nowhere' })).toMatchObject({ error: true, text: expect.stringContaining('Pick one of: mystic, Windows box') });
    expect(await orchestrator.startChild('plain', { title: 'A', prompt: 'a', computer: 'windows box' })).toMatchObject({ error: true, text: expect.stringContaining('Windows box is not connected now') });
    expect(await orchestrator.startChild('plain', { title: 'A', prompt: 'a', computer: 'mystic', agent: 'Gemini' })).toMatchObject({ error: true, text: expect.stringContaining('Pick one of: Work, Copilot') });
    const other = remote({ projects: { projects: [{ id: '0000000000000a03', name: 'app', repo: 'someone/app' }] }, clonePlan: { state: 'off', name: 'app', where: '' } });
    const second = setup({ computers: other.computers, localProject: other.localProject });
    expect(await second.orchestrator.startChild('plain', { title: 'A', prompt: 'a', computer: 'mystic' })).toMatchObject({ error: true, text: expect.stringContaining('Clone from GitHub is off there') });
    expect(asks).toEqual([]);
    expect(second.asks).toEqual([]);
    const none = setup({ localProject });
    expect(await none.orchestrator.startChild('plain', { title: 'A', prompt: 'a', computer: 'mystic' })).toMatchObject({ error: true, text: expect.stringContaining('No other computers are paired') });
  });

  it('starts nothing when you deny it, and says so when the start fails there', async () => {
    const { computers, calls, localProject } = remote({ fail: 'session.create' });
    const { orchestrator, answer } = setup({ computers, localProject });
    answer(false);
    expect(await orchestrator.startChild('plain', { title: 'A', prompt: 'a', computer: 'mystic' })).toEqual({ text: expect.stringContaining('The user did not start "A" on mystic') });
    expect(calls.map((c) => c.method)).toEqual(['projects.list']);
    answer(true);
    expect(await orchestrator.startChild('plain', { title: 'A', prompt: 'a', computer: 'mystic' })).toMatchObject({ error: true, text: expect.stringContaining('could not start on mystic: UNAVAILABLE') });
  });

  it('nests the new session under the asking one here, by its row id', async () => {
    const { computers, localProject } = remote();
    const { orchestrator } = setup({ computers, localProject });
    await orchestrator.startChild('plain', { title: 'Windows smoke', prompt: 'Run it.', computer: 'mystic' });
    expect(orchestrator.startedChildren()).toEqual([{ sessionId: 'remote:c1:remote-1', parentId: 'plain', title: 'Windows smoke' }]);
  });

  it('offers to clone the project there when it has none, on the same card, then starts in the clone', async () => {
    const { computers, calls, localProject } = remote({ projects: { projects: [] } });
    const { orchestrator, asks } = setup({ computers, localProject });
    const result = await orchestrator.startChild('plain', { title: 'A', prompt: 'a', computer: 'mystic' });
    expect(asks[0]!.ask).toMatchObject({ computer: 'mystic', project: 'app, cloned there first into ~/Developer/app' });
    expect(calls.map((c) => c.method)).toEqual(['projects.list', 'projects.clonePlan', 'projects.clone', 'session.create']);
    expect(calls[2]!.params).toMatchObject({ url: 'https://github.com/me/app', name: 'app' });
    expect(calls[3]!.params).toMatchObject({ projectId: '0000000000000a09' });
    expect(result.text).toContain('in its project "app"');
  });

  it('asks again when the clone brings hooks, and starts nothing when you say no', async () => {
    const brings = { hooks: [{ event: 'PreToolUse', command: './check.sh' }], mcpServers: [], allow: [], plugins: [], settings: [] };
    const { computers, calls, localProject } = remote({ projects: { projects: [] }, cloned: { brings } });
    const seen: unknown[] = [];
    const { orchestrator } = setup({ computers, localProject, askBrings: async (_id, _computer, _repo, lines) => (seen.push(lines), false) });
    expect(await orchestrator.startChild('plain', { title: 'A', prompt: 'a', computer: 'mystic' })).toMatchObject({ error: true, text: expect.stringContaining('did not start a session in it') });
    expect(seen).toEqual([[['Hook (PreToolUse)', './check.sh']]]);
    expect(calls.map((c) => c.method)).not.toContain('session.create');
  });

  it('lets an orchestrator start on another computer without a card, as one of its sessions', async () => {
    const { computers, calls, localProject } = remote();
    const { orchestrator, asks, store } = setup({ computers, localProject });
    const result = await orchestrator.run('orc', 'start_session', { title: 'Windows smoke', prompt: 'Run it.', computer: 'mystic' });
    expect(result.text).toContain('Started "Windows smoke" on mystic as session remote:c1:remote-1');
    expect(asks).toEqual([]);
    expect(calls.at(-1)!.method).toBe('session.create');
    expect(store.workersOf('orc')).toMatchObject([{ sessionId: 'remote:c1:remote-1', title: 'Windows smoke' }]);
  });

  it('lists the computers, and which have this project', async () => {
    const { computers, localProject } = remote();
    const { orchestrator } = setup({ computers, localProject });
    const { text } = await orchestrator.listComputers('plain');
    expect(text.split('\n').slice(0, 2)).toEqual(['- mystic: connected, has this project as "Work app"', '- Windows box: not connected now']);
    expect((await setup().orchestrator.listComputers('plain')).text).toContain('No other computers are paired');
  });
});

describe('OrchestratorBridge', () => {
  const BASE = { command: '/app/Seshboard', args: ['orchestrator-mcp.js'], env: { ELECTRON_RUN_AS_NODE: '1' } };
  const token = (server: { env: Record<string, string> }) => server.env.SESHBOARD_ORCHESTRATOR_TOKEN!;

  it('runs a tool for the orchestrator its token belongs to, and for no other session', async () => {
    const runs: unknown[] = [];
    const bridge = new OrchestratorBridge({ run: async (sessionId, tool, args) => (runs.push({ sessionId, tool, args }), { text: 'ok' }), tool: async (_id, tool) => ({ text: `tool ${tool}` }), isOrchestrator: (id) => id === 'orc', log: () => {} });
    cleanups.push(() => bridge.close());
    const server = await bridge.serverFor(BASE, () => 'orc');
    expect(server.env).toMatchObject({ ELECTRON_RUN_AS_NODE: '1', SESHBOARD_ORCHESTRATOR_SOCKET: expect.any(String) });
    await expect(bridge.handle({ id: 1, token: token(server), tool: 'list_sessions', args: {} })).resolves.toEqual({ text: 'ok' });
    expect(runs).toEqual([{ sessionId: 'orc', tool: 'list_sessions', args: {} }]);
    const other = await bridge.serverFor(BASE, () => 'plain-session');
    await expect(bridge.handle({ id: 2, token: token(other), tool: 'start_session', args: {} })).resolves.toMatchObject({ error: true, text: expect.stringContaining('not an orchestrator') });
    await expect(bridge.handle({ id: 3, token: 'made-up', tool: 'list_sessions', args: {} })).resolves.toMatchObject({ error: true });
    await expect(bridge.handle({ id: 4, token: token(server), tool: 'delete_everything', args: {} })).resolves.toMatchObject({ error: true });
    expect(runs).toHaveLength(1);
  });

  it('gives any other session the seshboard tools, and an orchestrator its own and run_pipeline', async () => {
    const children: unknown[] = [];
    const bridge = new OrchestratorBridge({
      run: async () => ({ text: 'orchestrator' }),
      tool: async (sessionId, tool, args) => (tool === 'start_session' ? (children.push({ sessionId, args }), { text: 'asked' }) : { text: `${tool} for ${sessionId}` }),
      isOrchestrator: () => false,
      log: () => {},
    });
    cleanups.push(() => bridge.close());
    const server = await bridge.serverFor(BASE, () => 'plain', 'session');
    expect(server.env.SESHBOARD_ORCHESTRATOR_ROLE).toBe('session');
    await expect(bridge.handle({ id: 1, token: token(server), tool: 'start_session', args: { title: 'A', prompt: 'a' } })).resolves.toEqual({ text: 'asked' });
    expect(children).toEqual([{ sessionId: 'plain', args: { title: 'A', prompt: 'a' } }]);
    await expect(bridge.handle({ id: 2, token: token(server), tool: 'message_session', args: {} })).resolves.toMatchObject({ error: true });
    await expect(bridge.handle({ id: 3, token: token(server), tool: 'list_computers', args: {} })).resolves.toEqual({ text: 'list_computers for plain' });
    await expect(bridge.handle({ id: 4, token: token(server), tool: 'save_pipeline', args: {} })).resolves.toEqual({ text: 'save_pipeline for plain' });
    expect(children).toHaveLength(1);
    // A project that gives its sessions only the start tools: the automation is refused, and its server says so.
    const few = await bridge.serverFor(BASE, () => 'plain', 'session', 'sessions');
    expect(few.env.SESHBOARD_SESSION_TOOLS).toBe('sessions');
    await expect(bridge.handle({ id: 5, token: token(few), tool: 'save_pipeline', args: {} })).resolves.toMatchObject({ error: true });
    await expect(bridge.handle({ id: 6, token: token(few), tool: 'usage', args: {} })).resolves.toEqual({ text: 'usage for plain' });
    // An orchestrator's token can't list computers, but runs a pipeline as a task.
    const orchestratorServer = await bridge.serverFor(BASE, () => 'orc');
    await expect(bridge.handle({ id: 7, token: token(orchestratorServer), tool: 'list_computers', args: {} })).resolves.toMatchObject({ error: true });
    expect((await bridge.serverFor(BASE, () => 'orc')).env.SESHBOARD_ORCHESTRATOR_ROLE).toBeUndefined();
  });
});
