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

describe('OrchestratorBridge', () => {
  const BASE = { command: '/app/Seshboard', args: ['orchestrator-mcp.js'], env: { ELECTRON_RUN_AS_NODE: '1' } };
  const token = (server: { env: Record<string, string> }) => server.env.SESHBOARD_ORCHESTRATOR_TOKEN!;

  it('runs a tool for the orchestrator its token belongs to, and for no other session', async () => {
    const runs: unknown[] = [];
    const bridge = new OrchestratorBridge({ run: async (sessionId, tool, args) => (runs.push({ sessionId, tool, args }), { text: 'ok' }), startChild: async () => ({ text: 'child' }), isOrchestrator: (id) => id === 'orc', log: () => {} });
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

  it('gives any other session only start_session, which goes to startChild', async () => {
    const children: unknown[] = [];
    const bridge = new OrchestratorBridge({ run: async () => ({ text: 'orchestrator' }), startChild: async (sessionId, args) => (children.push({ sessionId, args }), { text: 'asked' }), isOrchestrator: () => false, log: () => {} });
    cleanups.push(() => bridge.close());
    const server = await bridge.serverFor(BASE, () => 'plain', 'session');
    expect(server.env.SESHBOARD_ORCHESTRATOR_ROLE).toBe('session');
    await expect(bridge.handle({ id: 1, token: token(server), tool: 'start_session', args: { title: 'A', prompt: 'a' } })).resolves.toEqual({ text: 'asked' });
    expect(children).toEqual([{ sessionId: 'plain', args: { title: 'A', prompt: 'a' } }]);
    await expect(bridge.handle({ id: 2, token: token(server), tool: 'message_session', args: {} })).resolves.toMatchObject({ error: true });
    expect((await bridge.serverFor(BASE, () => 'orc')).env.SESHBOARD_ORCHESTRATOR_ROLE).toBeUndefined();
  });
});
