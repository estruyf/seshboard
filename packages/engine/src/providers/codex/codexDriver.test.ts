import { describe, expect, it, vi } from 'vitest';
import type { PermissionDecision, PermissionRequest } from '@seshboard/protocol';
import type { DriverEvents, DriverStatus } from '../provider.ts';
import { AppServerError } from './appServer.ts';
import { codexDriver, codexModelOption, type CodexDriverOptions } from './codexDriver.ts';
import { fakeAppServer, thread } from './codexFakes.ts';
import type { Model, ServerNotification, ServerRequest, Turn } from './protocol.ts';

const T = '019a0000-0000-7000-8000-00000000000a';
const OTHER = '019a0000-0000-7000-8000-00000000000b';
const CWD = '/work/app';

const turn = (id: string): Turn => ({ id, items: [], itemsView: 'notLoaded', status: 'inProgress', error: null, startedAt: null, completedAt: null, durationMs: null });
const model = (slug: string, extra: Partial<Model> = {}): Model => ({
  id: slug,
  model: slug,
  displayName: slug.toUpperCase(),
  description: `About ${slug}`,
  hidden: false,
  supportedReasoningEfforts: [{ reasoningEffort: 'minimal', description: '' }, { reasoningEffort: 'low', description: '' }, { reasoningEffort: 'high', description: '' }],
  defaultReasoningEffort: 'medium',
  inputModalities: ['text', 'image'],
  isDefault: false,
  ...extra,
});

function recorder() {
  const log: string[] = [];
  const permissions: Array<Omit<PermissionRequest, 'sessionId'>> = [];
  const events: DriverEvents = {
    stream: () => {},
    messages: () => {},
    state: (state, error) => void log.push(error ? `${state}: ${error}` : state),
    permission: (request) => void permissions.push(request),
    permissionDone: (requestId) => void log.push(`done ${requestId}`),
    usage: () => {},
    model: () => {},
  };
  return { events, log, permissions };
}

/** A driver over a fake app-server, with a live handler and permission cards that only record what they get. */
function setup(extra: { turnStart?: (params: Record<string, unknown>) => unknown; steer?: () => unknown; mcp?: () => unknown; options?: Partial<CodexDriverOptions> } = {}) {
  let turns = 0;
  const server = fakeAppServer({
    'thread/start': () => ({ thread: thread(T, { source: 'appServer' }), model: 'gpt-5.5', reasoningEffort: 'medium', approvalPolicy: 'on-request', sandbox: {} }),
    'thread/resume': ({ threadId }) => ({ thread: thread(threadId), model: 'gpt-5.5', reasoningEffort: null, approvalPolicy: 'on-request', sandbox: {} }),
    'turn/start': (params) => (extra.turnStart?.(params as never) as never) ?? { turn: turn(`turn-${++turns}`) },
    'turn/steer': () => (extra.steer?.() as never) ?? { turnId: 'turn-1' },
    'turn/interrupt': () => ({}),
    'thread/unsubscribe': () => ({}),
    'mcpServerStatus/list': () => (extra.mcp?.() as never) ?? { data: [], nextCursor: null },
    'model/list': () => ({ data: [model('gpt-5.5', { isDefault: true }), model('gpt-5-mini', { defaultReasoningEffort: 'low' }), model('secret', { hidden: true })], nextCursor: null }),
  });
  const handled: ServerNotification[] = [];
  const answers: Array<{ request: ServerRequest; decision: PermissionDecision }> = [];
  const status: DriverStatus = { binary: '/fake/codex', version: '0.167.0', signedIn: true, account: 'me@example.com', login: 'me@example.com', problem: null };
  const logged: string[] = [];
  const lives: string[] = [];
  const driver = codexDriver({
    server,
    status: async () => status,
    live: (threadId) => (lives.push(threadId), {
      handle: (n) => {
        if (n.method === 'boom') throw new Error('converter failed');
        handled.push({ method: `${threadId} ${n.method}`, params: n.params });
      },
    }),
    permissions: {
      request: (requestId, request) => (request.method === 'unknown/request' ? null : { requestId, toolName: 'Bash', input: { command: 'ls' }, toolUseId: 'x', createdAt: 1 } as never),
      answer: (request, decision) => (answers.push({ request, decision }), { decision: decision.behavior === 'allow' ? 'accept' : 'decline' }),
    },
    log: (_level, message) => void logged.push(message),
    messageIdMs: 30,
    ...extra.options,
  });
  const turnStarts = () => server.calls.filter((c) => c.method === 'turn/start').map((c) => c.params as Record<string, unknown>);
  return { server, driver, handled, answers, logged, turnStarts, lives };
}

describe('codexDriver', () => {
  it('starts a thread in the folder with the mode, holds the server while it runs, and lets go when closed', async () => {
    const { server, driver } = setup();
    const { events } = recorder();
    const session = await driver.start({ cwd: CWD, model: 'gpt-5-mini', permissionMode: 'acceptEdits' }, events);
    expect(session.sessionId).toBe(T);
    expect(server.calls[0]).toEqual({ method: 'thread/start', params: { cwd: CWD, approvalPolicy: 'on-request', sandbox: 'workspace-write', model: 'gpt-5-mini' } });
    expect(server.holds).toBe(1);
    expect(server.handling()).toBe(true);
    await session.close();
    expect(server.calls.at(-1)).toEqual({ method: 'thread/unsubscribe', params: { threadId: T } });
    expect(server.holds).toBe(0);
    expect(server.handling()).toBe(false);
  });

  it("resumes a thread without its turns (Seshboard reads them itself)", async () => {
    const { server, driver } = setup();
    const session = await driver.start({ cwd: CWD, model: null, permissionMode: 'default', resume: OTHER }, recorder().events);
    expect(session.sessionId).toBe(OTHER);
    expect(server.calls[0]).toEqual({ method: 'thread/resume', params: { threadId: OTHER, cwd: CWD, approvalPolicy: 'on-request', sandbox: 'read-only', excludeTurns: true } });
  });

  it("sends each message with the mode's sandbox and approval policy, the model and the effort", async () => {
    const { driver, turnStarts } = setup();
    const session = await driver.start({ cwd: CWD, model: 'gpt-5-mini', effort: 'high', permissionMode: 'default' }, recorder().events);
    await session.send('hello', []);
    expect(turnStarts()[0]).toMatchObject({ threadId: T, input: [{ type: 'text', text: 'hello', text_elements: [] }], approvalPolicy: 'on-request', sandboxPolicy: { type: 'readOnly', networkAccess: false }, model: 'gpt-5-mini', effort: 'high' });
    expect(turnStarts()[0]).not.toHaveProperty('collaborationMode');
    await session.setMode('acceptEdits');
    await session.send('edit it', []);
    expect(turnStarts()[1]).toMatchObject({ approvalPolicy: 'on-request', sandboxPolicy: { type: 'workspaceWrite' } });
    await session.setMode('auto');
    await session.send('go on', []);
    expect(turnStarts()[2]).toMatchObject({ approvalPolicy: 'never', sandboxPolicy: { type: 'workspaceWrite' } });
    // Plan mode: Codex's own, with the model it needs; leaving it says so once.
    await session.setMode('plan');
    await session.send('plan it', []);
    expect(turnStarts()[3]).toMatchObject({ approvalPolicy: 'on-request', sandboxPolicy: { type: 'readOnly' }, collaborationMode: { mode: 'plan', settings: { model: 'gpt-5-mini', reasoning_effort: 'high', developer_instructions: null } } });
    await session.setMode('default');
    await session.send('do it', []);
    expect(turnStarts()[4]).toMatchObject({ collaborationMode: { mode: 'default' } });
    await session.send('again', []);
    expect(turnStarts()[5]).not.toHaveProperty('collaborationMode');
  });

  it("names Plan mode's model from the thread when Seshboard picked none", async () => {
    const { driver, turnStarts } = setup();
    const session = await driver.start({ cwd: CWD, model: null, permissionMode: 'plan' }, recorder().events);
    await session.send('plan', []);
    expect(turnStarts()[0]).toMatchObject({ collaborationMode: { mode: 'plan', settings: { model: 'gpt-5.5', reasoning_effort: null } } });
    expect(turnStarts()[0]).not.toHaveProperty('model');
  });

  it('runs a read-only session in the read-only sandbox, never asking, whatever its mode', async () => {
    const { server, driver, turnStarts } = setup();
    const session = await driver.start({ cwd: CWD, model: null, permissionMode: 'auto', readOnly: true }, recorder().events);
    expect(server.calls[1]!.params).toMatchObject({ sandbox: 'read-only', approvalPolicy: 'never', config: { features: { apps: false } } });
    await session.send('look', []);
    expect(turnStarts()[0]).toMatchObject({ approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly' } });
  });

  it('falls back to the read-only sandbox alone when Codex refuses Plan mode, and remembers', async () => {
    const { driver, turnStarts, logged } = setup({
      turnStart: (params) => {
        // What codex-cli 0.167 answers without the experimental API.
        if (params.collaborationMode) throw new AppServerError('turn/start.collaborationMode requires experimentalApi capability', 'rpc', -32600);
        return undefined;
      },
    });
    const session = await driver.start({ cwd: CWD, model: 'gpt-5-mini', permissionMode: 'plan' }, recorder().events);
    await session.send('plan', []);
    expect(turnStarts().map((p) => 'collaborationMode' in p)).toEqual([true, false]);
    expect(turnStarts()[1]).toMatchObject({ sandboxPolicy: { type: 'readOnly' } });
    expect(logged).toEqual([expect.stringMatching(/refused Plan mode/)]);
    await session.send('plan again', []);
    expect(turnStarts()).toHaveLength(3);
    expect(turnStarts()[2]).not.toHaveProperty('collaborationMode');
    // A failure that isn't Codex refusing the request is the turn's own.
    const broken = setup({
      turnStart: () => {
        throw new AppServerError('Codex app-server stopped.', 'exited');
      },
    });
    const other = await broken.driver.start({ cwd: CWD, model: 'gpt-5-mini', permissionMode: 'plan' }, recorder().events);
    await expect(other.send('plan', [])).rejects.toThrow('stopped');
    expect(broken.turnStarts()).toHaveLength(1);
  });

  it("keeps Plan mode on for an error that isn't Codex refusing it, or a retry that fails too, and asks a new process again", async () => {
    let failing: AppServerError | null = new AppServerError('failed to submit turn input: EmptyInput', 'rpc', -32603);
    let refuse = false;
    const { server, driver, turnStarts } = setup({
      turnStart: (params) => {
        if (failing) throw failing;
        if (refuse && params.collaborationMode) throw new AppServerError('turn/start.collaborationMode requires experimentalApi capability', 'rpc', -32600);
        return undefined;
      },
    });
    const session = await driver.start({ cwd: CWD, model: 'gpt-5-mini', permissionMode: 'plan' }, recorder().events);
    await expect(session.send('plan', [])).rejects.toThrow('EmptyInput');
    expect(turnStarts()).toHaveLength(1);
    // Refused, but the retry fails as well: no proof it was Plan mode.
    failing = new AppServerError('turn/start.collaborationMode requires experimentalApi capability', 'rpc', -32600);
    await expect(session.send('plan', [])).rejects.toThrow();
    expect(turnStarts().map((p) => 'collaborationMode' in p)).toEqual([true, true, false]);
    failing = null;
    await session.send('plan', []);
    expect(turnStarts().at(-1)).toHaveProperty('collaborationMode');
    // Refused for real in this process: off while it runs, asked again in the next one.
    refuse = true;
    await session.send('plan', []);
    await session.send('plan', []);
    expect(turnStarts().slice(-3).map((p) => 'collaborationMode' in p)).toEqual([true, false, false]);
    (server as { pid: () => number }).pid = () => 5151;
    refuse = false;
    await session.send('plan', []);
    expect(turnStarts().at(-1)).toHaveProperty('collaborationMode');
  });

  it('stops a turn that was sent a moment ago, as soon as Codex names it', async () => {
    let answer: (value: unknown) => void = () => {};
    const { server, driver } = setup({ turnStart: () => new Promise((resolve) => (answer = resolve)) });
    const session = await driver.start({ cwd: CWD, model: null, permissionMode: 'default' }, recorder().events);
    const sent = session.send('go', []);
    await vi.waitFor(() => expect(server.calls.at(-1)!.method).toBe('turn/start'), { interval: 5 });
    await session.interrupt();
    expect(server.calls.some((c) => c.method === 'turn/interrupt')).toBe(false);
    answer({ turn: turn('turn-9') });
    await sent;
    await vi.waitFor(() => expect(server.calls.at(-1)).toEqual({ method: 'turn/interrupt', params: { threadId: T, turnId: 'turn-9' } }), { interval: 5 });
    expect(server.calls.filter((c) => c.method === 'turn/interrupt')).toHaveLength(1);
  });

  it('stops the turn under way before letting go of the thread', async () => {
    const { server, driver } = setup();
    const session = await driver.start({ cwd: CWD, model: null, permissionMode: 'default' }, recorder().events);
    await session.send('go', []);
    await session.close();
    expect(server.calls.slice(-2)).toEqual([
      { method: 'turn/interrupt', params: { threadId: T, turnId: 'turn-1' } },
      { method: 'thread/unsubscribe', params: { threadId: T } },
    ]);
  });

  it('starts a read-only thread without MCP servers: by plugin, the apps feature, or their own setting', async () => {
    let refusedOnce = false;
    const server = fakeAppServer({
      'mcpServerStatus/list': ({ cursor }) =>
        cursor ? { data: [{ name: 'node_repl', pluginId: null }], nextCursor: null } : { data: [{ name: 'github', pluginId: null }, { name: 'codex_apps', pluginId: null }, { name: 'cua_repl', pluginId: 'computer-use@bundled' }, { name: 'builtin', pluginId: null }], nextCursor: 'p2' },
      'thread/start': (params) => {
        // A server Codex lists without a config entry: its `enabled` is no setting (codex-cli 0.167 says so).
        if (!refusedOnce && (params.config as { mcp_servers?: Record<string, unknown> }).mcp_servers?.builtin) {
          refusedOnce = true;
          throw new AppServerError('failed to load configuration: invalid transport\nin `mcp_servers.builtin`\n', 'rpc', -32600);
        }
        return { thread: thread(T), model: 'gpt-5.5', reasoningEffort: null, approvalPolicy: 'never', sandbox: {} };
      },
    });
    const driver = codexDriver({ server, status: async () => ({}) as DriverStatus, live: () => ({ handle: () => {} }) });
    await driver.start({ cwd: CWD, model: null, permissionMode: 'auto', readOnly: true }, recorder().events);
    const starts = server.calls.filter((c) => c.method === 'thread/start').map((c) => c.params as { config: unknown });
    expect(starts).toHaveLength(2);
    expect(starts[1]!.config).toEqual({ features: { apps: false }, plugins: { 'computer-use@bundled': { enabled: false } }, mcp_servers: { github: { enabled: false }, node_repl: { enabled: false } } });
    // A session that may write keeps its MCP servers (it asks before they run).
    const plain = setup();
    await plain.driver.start({ cwd: CWD, model: null, permissionMode: 'default' }, recorder().events);
    expect(plain.server.calls[0]!.params).not.toHaveProperty('config');
  });

  it("won't start a read-only thread when Codex doesn't list its MCP servers", async () => {
    const { driver } = setup({
      mcp: () => {
        throw new AppServerError('timed out', 'timeout');
      },
    });
    await expect(driver.start({ cwd: CWD, model: null, permissionMode: 'default', readOnly: true }, recorder().events)).rejects.toThrow(/read-only session can't start/);
  });

  it('returns the id the transcript gives the message, or its own when Codex says nothing in time', async () => {
    const { server, driver, turnStarts } = setup({ options: { messageIdMs: 400 } });
    const session = await driver.start({ cwd: CWD, model: null, permissionMode: 'default' }, recorder().events);
    const sent = session.send('hello', []);
    await vi.waitFor(() => expect(turnStarts()).toHaveLength(1), { interval: 5 });
    const clientId = turnStarts()[0]!.clientUserMessageId as string;
    server.notify('item/started', { threadId: T, turnId: 'turn-1', item: { type: 'userMessage', id: 'item-0', clientId, content: [] }, startedAtMs: 1 });
    // As the transcript names it: no `:`, which the window cuts ids at.
    expect(await sent).toBe('turn-1~item-0');
    const quiet = await session.send('nobody names this', []);
    expect(quiet).toBe(turnStarts()[1]!.clientUserMessageId);
  });

  it('steers the turn under way, and starts a new one when it ended meanwhile', async () => {
    let steerFails = false;
    const { server, driver, turnStarts } = setup({
      steer: () => {
        if (steerFails) throw new AppServerError('no active turn', 'rpc', -32600);
        return undefined;
      },
    });
    const session = await driver.start({ cwd: CWD, model: null, permissionMode: 'default' }, recorder().events);
    await session.send('start', []);
    await session.send('also this', [], true);
    expect(server.calls.at(-1)).toMatchObject({ method: 'turn/steer', params: { threadId: T, expectedTurnId: 'turn-1', input: [{ type: 'text', text: 'also this' }] } });
    steerFails = true;
    await session.send('late', [], true);
    expect(turnStarts()).toHaveLength(2);
    // Once the turn completed, a steer is a new turn.
    server.notify('turn/completed', { threadId: T, turn: turn('turn-2') });
    await session.send('after', [], true);
    expect(server.calls.at(-1)!.method).toBe('turn/start');
  });

  it('stops the turn under way, and declines what it asked', async () => {
    const { server, driver, answers } = setup();
    const { events, log } = recorder();
    const session = await driver.start({ cwd: CWD, model: null, permissionMode: 'default' }, events);
    await session.send('start', []);
    const asked = server.ask('item/commandExecution/requestApproval', { threadId: T, turnId: 'turn-1', itemId: 'c1', command: 'rm -rf build' });
    await vi.waitFor(() => expect(answers).toHaveLength(0));
    await session.interrupt();
    expect(server.calls.at(-1)).toEqual({ method: 'turn/interrupt', params: { threadId: T, turnId: 'turn-1' } });
    expect(await asked).toEqual({ decision: 'decline' });
    // The card's id is Codex's own request id.
    expect(log).toContain(`done ${T}~1`);
  });

  it("shows Codex's requests as cards and sends the answer back; refuses what it can't show or what isn't its", async () => {
    const { server, driver, answers } = setup();
    const { events, permissions, log } = recorder();
    const session = await driver.start({ cwd: CWD, model: null, permissionMode: 'default' }, events);
    const asked = server.ask('item/commandExecution/requestApproval', { threadId: T, turnId: 'turn-1', itemId: 'c1', command: 'npm test' });
    await vi.waitFor(() => expect(permissions).toHaveLength(1));
    const requestId = permissions[0]!.requestId;
    session.respond(requestId, { behavior: 'allow' });
    expect(await asked).toEqual({ decision: 'accept' });
    expect(answers[0]!.request).toMatchObject({ method: 'item/commandExecution/requestApproval', params: { command: 'npm test' } });
    expect(log).toContain(`done ${requestId}`);
    // Answered already: a second answer does nothing.
    session.respond(requestId, { behavior: 'deny' });
    expect(answers).toHaveLength(1);
    await expect(server.ask('unknown/request', { threadId: T })).rejects.toThrow(/can't answer unknown\/request/);
    await expect(server.ask('item/commandExecution/requestApproval', { threadId: OTHER, turnId: 't', itemId: 'i' })).rejects.toThrow(/No session in Seshboard/);
  });

  it('lets go of a request Codex resolved some other way, and shows its card with the item as it is now', async () => {
    const seen: unknown[] = [];
    const { server, driver, answers } = setup({
      options: {
        live: () => ({ handle: () => {}, item: (id) => ({ type: 'fileChange', id, changes: [], status: 'inProgress' }) }),
        permissions: { request: (requestId, _request, item) => (seen.push(item), { requestId, toolName: 'Edit', input: {}, toolUseId: 'f1', createdAt: 1 } as never), answer: (r, d) => (answers.push({ request: r, decision: d }), { decision: 'accept' }) },
      },
    });
    const { events, permissions } = recorder();
    const session = await driver.start({ cwd: CWD, model: null, permissionMode: 'default' }, events);
    const asked = server.ask('item/fileChange/requestApproval', { threadId: T, turnId: 'turn-1', itemId: 'f1' });
    await vi.waitFor(() => expect(permissions).toHaveLength(1));
    expect(permissions[0]!.requestId).toBe(`${T}~1`);
    expect(seen).toEqual([{ type: 'fileChange', id: 'f1', changes: [], status: 'inProgress' }]);
    // The turn ended: Codex wants no answer any more (CodexLive takes the card away), and a late one goes nowhere.
    server.notify('serverRequest/resolved', { threadId: T, requestId: 1 });
    expect(await asked).toBeNull();
    session.respond(`${T}~1`, { behavior: 'allow' });
    expect(answers).toEqual([]);
  });

  it("refuses a request whose answer Codex can't take", async () => {
    const { server, driver } = setup({ options: { permissions: { request: (requestId) => ({ requestId, toolName: 'AskUserQuestion', input: {}, toolUseId: 'q', createdAt: 1 }) as never, answer: () => null } } });
    const { events, permissions } = recorder();
    const session = await driver.start({ cwd: CWD, model: null, permissionMode: 'default' }, events);
    const asked = server.ask('item/tool/requestUserInput', { threadId: T, turnId: 'turn-1', itemId: 'q' });
    await vi.waitFor(() => expect(permissions).toHaveLength(1));
    session.respond(`${T}~1`, { behavior: 'allow' });
    await expect(asked).rejects.toThrow(/can't answer/);
  });

  it("hands each thread's notifications to its own live handler, and survives one that fails", async () => {
    const { server, driver, handled, logged } = setup();
    await driver.start({ cwd: CWD, model: null, permissionMode: 'default' }, recorder().events);
    server.notify('item/agentMessage/delta', { threadId: T, delta: 'Hi' });
    server.notify('item/agentMessage/delta', { threadId: OTHER, delta: 'not ours' });
    server.notify('boom', { threadId: T });
    expect(handled.map((n) => n.method)).toEqual([`${T} item/agentMessage/delta`]);
    expect(logged).toEqual([expect.stringMatching(/converter failed/)]);
  });

  it('reports a crash on each session, and resumes the thread with the next message', async () => {
    const { server, driver, turnStarts, lives } = setup();
    await driver.models();
    const { events, log } = recorder();
    const session = await driver.start({ cwd: CWD, model: null, permissionMode: 'default' }, events);
    await session.send('start', []);
    server.exit();
    expect(log).toContain('error: Codex stopped. Send a message to continue the session.');
    expect(server.holds).toBe(0);
    // Nothing to stop in a process that is gone.
    await session.interrupt();
    expect(server.calls.some((c) => c.method === 'turn/interrupt')).toBe(false);
    await session.send('go on', []);
    expect(server.calls.slice(-2).map((c) => c.method)).toEqual(['thread/resume', 'turn/start']);
    expect(server.calls.at(-2)!.params).toMatchObject({ threadId: T, excludeTurns: true });
    expect(turnStarts()).toHaveLength(2);
    expect(server.holds).toBe(1);
    // A new reader for the new process (the old one's running items are gone), and the models are read again.
    expect(lives).toEqual([T, T]);
    await driver.models();
    expect(server.calls.filter((c) => c.method === 'model/list')).toHaveLength(2);
  });

  it('sends a model or effort change with the next turn, and Codex\'s default when set back', async () => {
    const { driver, turnStarts } = setup();
    const session = await driver.start({ cwd: CWD, model: 'gpt-5-mini', effort: 'high', permissionMode: 'default' }, recorder().events);
    await session.setEffort!(null);
    await session.send('a', []);
    // Back to the model's own level, which Codex doesn't go back to by itself.
    expect(turnStarts()[0]).toMatchObject({ model: 'gpt-5-mini', effort: 'low' });
    await session.setModel(null);
    await session.send('b', []);
    expect(turnStarts()[1]).toMatchObject({ model: 'gpt-5.5', effort: 'medium' });
    await session.send('c', []);
    expect(turnStarts()[2]).not.toHaveProperty('model');
    expect(turnStarts()[2]).not.toHaveProperty('effort');
  });

  it("lists Codex's visible models, with the effort levels Seshboard names", async () => {
    const { driver } = setup();
    expect(await driver.models()).toEqual([
      { value: 'gpt-5.5', displayName: 'GPT-5.5', description: 'About gpt-5.5', supportsEffort: true, efforts: ['low', 'high'] },
      { value: 'gpt-5-mini', displayName: 'GPT-5-MINI', description: 'About gpt-5-mini', supportsEffort: true, efforts: ['low', 'high'] },
    ]);
    expect(codexModelOption(model('plain', { supportedReasoningEfforts: [] }))).toEqual({ value: 'plain', displayName: 'PLAIN', description: 'About plain', supportsEffort: false });
    expect(await driver.commands()).toEqual([]);
    expect(await driver.status()).toMatchObject({ signedIn: true, login: 'me@example.com' });
  });

  it('lets go of every session quietly when disposed', async () => {
    const { server, driver } = setup();
    const { events, log } = recorder();
    await driver.start({ cwd: CWD, model: null, permissionMode: 'default' }, events);
    await driver.dispose();
    expect(server.holds).toBe(0);
    expect(server.handling()).toBe(false);
    expect(log).toEqual([]);
  });
});
