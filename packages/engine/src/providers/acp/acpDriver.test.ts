import { describe, expect, it } from 'vitest';
import type { PermissionRequest, StreamDelta } from '@seshboard/protocol';
import type { RawSessionMessage } from '../../claude/transcript.ts';
import type { DriverEvents } from '../provider.ts';
import { AcpError } from './acpConnection.ts';
import { acpDriver, type AcpDriverOptions } from './acpDriver.ts';
import { fakeAcpConnection } from './acpFakes.ts';

const SESSION = 'sess-1';

function recorder() {
  const seen = { stream: [] as Array<Omit<StreamDelta, 'sessionId'>>, states: [] as string[], permissions: [] as Array<Omit<PermissionRequest, 'sessionId'>>, done: [] as string[], usage: [] as unknown[], models: [] as string[], messages: [] as Array<{ messages: RawSessionMessage[]; keep: boolean }> };
  const events: DriverEvents = {
    stream: (delta) => seen.stream.push(delta),
    messages: (messages, options) => seen.messages.push({ messages, keep: !!options?.keep }),
    state: (state, error) => seen.states.push(error ? `${state}: ${error}` : state),
    permission: (request) => seen.permissions.push(request),
    permissionDone: (id) => seen.done.push(id),
    usage: (usage) => seen.usage.push(usage),
    model: (model) => seen.models.push(model),
  };
  return { seen, events };
}

/** A turn the test ends itself. */
function promptGate() {
  let end: (value: unknown) => void = () => {};
  let fail: (error: unknown) => void = () => {};
  const answer = () => new Promise((resolve, reject) => ((end = resolve), (fail = reject)));
  return { answer, end: (stopReason = 'end_turn') => end({ stopReason }), fail: (error: unknown) => fail(error) };
}

function driverWith(answers: Record<string, unknown>, extra: Partial<AcpDriverOptions> = {}) {
  const agent = fakeAcpConnection({ 'session/new': { sessionId: SESSION, models: { availableModels: [{ modelId: 'auto', name: 'Auto' }, { modelId: 'fast', name: 'Fast' }], currentModelId: 'auto' } }, 'session/set_mode': {}, 'session/set_model': {}, ...answers });
  const driver = acpDriver({
    agentName: 'Agent CLI',
    connection: agent.connection,
    modes: [{ value: 'default', label: 'Ask', description: '' }],
    modeId: (mode, readOnly) => (readOnly ? 'ro' : mode),
    status: async () => ({ binary: '/a', version: '1', signedIn: true, account: null, login: null, problem: null }),
    signInMessage: 'Sign in first.',
    defaultModels: [{ value: 'auto', displayName: 'Auto', description: '', supportsEffort: false }],
    messageIdMs: 50,
    replayMs: 300,
    ...extra,
  });
  return { agent, driver };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('acpDriver', () => {
  it('starts a session in the mode and on the model asked for, and streams its turn', async () => {
    const turn = promptGate();
    const { agent, driver } = driverWith({ 'session/prompt': turn.answer }, { messageIdOf: async (_id, text) => (text === 'hi' ? 'file-id' : null) });
    const { seen, events } = recorder();
    const session = await driver.start({ cwd: '/repo', model: 'fast', permissionMode: 'default' }, events);
    expect(session.sessionId).toBe(SESSION);
    expect(agent.requests.map((r) => [r.method, r.params])).toEqual([
      ['session/new', { cwd: '/repo', mcpServers: [] }],
      ['session/set_mode', { sessionId: SESSION, modeId: 'default' }],
      ['session/set_model', { sessionId: SESSION, modelId: 'fast' }],
    ]);
    expect(seen.models).toEqual(['fast']);
    expect(await driver.models()).toEqual([expect.objectContaining({ value: 'auto' }), expect.objectContaining({ value: 'fast', displayName: 'Fast' })]);

    // The transcript's id for the message, from the agent's own file.
    expect(await session.send('hi', [])).toBe('file-id');
    expect(seen.states).toEqual(['running']);
    agent.update(SESSION, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '**Plan**' } });
    agent.update(SESSION, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Looking' } });
    agent.update(SESSION, { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'npm test', kind: 'execute', status: 'pending' });
    agent.update(SESSION, { sessionUpdate: 'usage_update', used: 1200, size: 100_000 });
    turn.end();
    await tick();
    expect(seen.stream).toEqual([{ kind: 'thinking', text: '**Plan**' }, { kind: 'text', text: 'Looking' }, { kind: 'clear', text: '' }, { kind: 'tool', text: 'Bash' }, { kind: 'clear', text: '' }]);
    expect(seen.usage).toEqual([{ contextTokens: 1200, contextMax: 100_000 }]);
    expect(seen.states).toEqual(['running', 'idle']);
  });

  it('shows a permission request as a card and answers with the option the agent offered', async () => {
    const turn = promptGate();
    const { agent, driver } = driverWith({ 'session/prompt': turn.answer });
    const { seen, events } = recorder();
    const session = await driver.start({ cwd: '/repo', model: null, permissionMode: 'default' }, events);
    await session.send('edit it', []);
    const options = [
      { optionId: 'proceed_always', name: 'Allow for this session', kind: 'allow_always' },
      { optionId: 'proceed_once', name: 'Allow', kind: 'allow_once' },
      { optionId: 'cancel', name: 'Reject', kind: 'reject_once' },
    ];
    const toolCall = { toolCallId: 'replace-1', title: 'cart.ts: a => b', kind: 'edit', status: 'pending', content: [{ type: 'diff', path: '/repo/cart.ts', oldText: 'a', newText: 'b' }] };
    const answered = agent.ask('session/request_permission', { sessionId: SESSION, toolCall, options });
    await tick();
    expect(seen.permissions).toEqual([expect.objectContaining({ toolName: 'Edit', toolUseId: 'replace-1', input: { file_path: '/repo/cart.ts', old_string: 'a', new_string: 'b' }, title: 'cart.ts: a => b', alwaysLabel: 'Allow for this session' })]);
    session.respond(seen.permissions[0]!.requestId, { behavior: 'allow', always: true });
    expect(await answered).toEqual({ outcome: { outcome: 'selected', optionId: 'proceed_always' } });
    expect(seen.done).toEqual([seen.permissions[0]!.requestId]);

    // Stop answers what is still open as cancelled, and asks the agent to stop the turn.
    const second = agent.ask('session/request_permission', { sessionId: SESSION, toolCall: { toolCallId: 'x', kind: 'execute', title: 'rm -rf build' }, options });
    await tick();
    await session.interrupt();
    expect(await second).toEqual({ outcome: { outcome: 'cancelled' } });
    expect(agent.notified).toEqual([{ method: 'session/cancel', params: { sessionId: SESSION } }]);
    turn.end('cancelled');
    await tick();
    expect(seen.states.at(-1)).toBe('idle');
  });

  it('loads a session and leaves out the history the agent sends again', async () => {
    const turn = promptGate();
    const { agent, driver } = driverWith({ 'session/load': {}, 'session/prompt': turn.answer });
    const { seen, events } = recorder();
    const session = await driver.start({ cwd: '/repo', resume: SESSION, model: null, permissionMode: 'default' }, events);
    expect(agent.requests[0]).toEqual({ method: 'session/load', params: { sessionId: SESSION, cwd: '/repo', mcpServers: [] } });
    // The replay, right after the answer.
    agent.update(SESSION, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'old prompt' } });
    agent.update(SESSION, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'old reply' } });
    const sending = session.send('new', []);
    // The prompt waits until the replay went quiet.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(agent.requests.some((r) => r.method === 'session/prompt')).toBe(false);
    await sending;
    expect(agent.requests.at(-1)!.method).toBe('session/prompt');
    agent.update(SESSION, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'new reply' } });
    turn.end();
    await tick();
    expect(seen.stream.filter((d) => d.kind === 'text')).toEqual([{ kind: 'text', text: 'new reply' }]);
  });

  it('sends a message steered into a turn when its prompt ends, in the same turn, and refuses one that is not', async () => {
    const first = promptGate();
    const second = promptGate();
    const answers = [first, second];
    const { agent, driver } = driverWith({ 'session/prompt': () => answers.shift()!.answer() });
    const { seen, events } = recorder();
    const session = await driver.start({ cwd: '/repo', model: null, permissionMode: 'default' }, events);
    await session.send('one', []);
    await expect(session.send('two', [])).rejects.toThrow('Agent CLI is still working on the last message');
    // It answers at once: the message waits in the driver.
    expect(await session.send('three', [], true)).toMatch(/^acp-/);
    expect(agent.requests.filter((r) => r.method === 'session/prompt')).toHaveLength(1);
    first.end();
    await tick();
    await tick();
    expect(agent.requests.filter((r) => r.method === 'session/prompt').map((r) => (r.params.prompt as Array<{ text: string }>)[0]!.text)).toEqual(['one', 'three']);
    // No idle between the two prompts: one turn.
    expect(seen.states).toEqual(['running', 'running']);
    second.end();
    await tick();
    expect(seen.states.at(-1)).toBe('idle');
  });

  it('drops what was steered into a turn that is stopped or closed, and says nothing after close', async () => {
    const turns = [promptGate(), promptGate()];
    const gates = [...turns];
    const { agent, driver } = driverWith({ 'session/prompt': () => gates.shift()!.answer() });
    const { seen, events } = recorder();
    const session = await driver.start({ cwd: '/repo', model: null, permissionMode: 'default' }, events);
    await session.send('one', []);
    await session.send('steered', [], true);
    await session.interrupt();
    turns[0]!.end('cancelled');
    await tick();
    expect(agent.requests.filter((r) => r.method === 'session/prompt')).toHaveLength(1);
    expect(seen.states.at(-1)).toBe('idle');

    await session.send('two', []);
    await session.send('steered again', [], true);
    const before = seen.states.length;
    await session.close();
    expect(agent.holds()).toBe(0);
    turns[1]!.end('cancelled');
    await tick();
    expect(agent.requests.filter((r) => r.method === 'session/prompt')).toHaveLength(2);
    expect(seen.states.slice(before)).toEqual([]);
  });

  it('waits for the history from the answer to session/load on, however long loading takes', async () => {
    const turn = promptGate();
    let answer: (value: unknown) => void = () => {};
    const { agent, driver } = driverWith({ 'session/load': () => new Promise((resolve) => (answer = resolve)), 'session/prompt': turn.answer });
    const { seen, events } = recorder();
    const starting = driver.start({ cwd: '/repo', resume: SESSION, model: null, permissionMode: 'default' }, events);
    // Loading takes longer than the quiet the replay waits for.
    await new Promise((resolve) => setTimeout(resolve, 400));
    answer({});
    const session = await starting;
    const sending = session.send('new', []);
    await new Promise((resolve) => setTimeout(resolve, 100));
    agent.update(SESSION, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'OLD HISTORY' } });
    await sending;
    turn.end();
    await tick();
    expect(seen.stream.filter((d) => d.kind === 'text')).toEqual([]);
  });

  it('does not send a prompt that Stop came before, while the session loaded again', async () => {
    let answer: (value: unknown) => void = () => {};
    const { agent, driver } = driverWith({ 'session/load': () => new Promise((resolve) => (answer = resolve)), 'session/prompt': { stopReason: 'end_turn' } }, { replayMs: 0 });
    const { seen, events } = recorder();
    const session = await driver.start({ cwd: '/repo', model: null, permissionMode: 'default' }, events);
    agent.exit();
    const sending = session.send('again', []);
    await tick();
    await session.interrupt();
    answer({});
    await sending;
    expect(agent.requests.some((r) => r.method === 'session/prompt')).toBe(false);
    expect(seen.states.at(-1)).toBe('idle');
  });

  it("keeps a slash command's answer, which the agent doesn't write down", async () => {
    const turn = promptGate();
    const { agent, driver } = driverWith({ 'session/prompt': turn.answer });
    const { seen, events } = recorder();
    const session = await driver.start({ cwd: '/repo', model: null, permissionMode: 'default' }, events);
    agent.update(SESSION, { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'about', description: 'Version info' }] });
    expect(await session.commands()).toEqual([{ name: 'about', description: 'Version info', argumentHint: '' }]);
    expect(await driver.commands()).toEqual([{ name: 'about', description: 'Version info', argumentHint: '' }]);
    await session.send('/about', []);
    agent.update(SESSION, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Agent CLI 1.0' } });
    turn.end();
    await tick();
    expect(seen.stream).toEqual([{ kind: 'clear', text: '' }]);
    expect(seen.messages).toHaveLength(1);
    expect(seen.messages[0]!.keep).toBe(true);
    expect(seen.messages[0]!.messages.map((m) => [m.type, (m.message as { content: Array<{ text: string }> }).content[0]!.text])).toEqual([
      ['user', '/about'],
      ['assistant', 'Agent CLI 1.0'],
    ]);
  });

  it('says to sign in when the agent needs a login, and reports a turn that failed', async () => {
    const { driver } = driverWith({ 'session/new': () => Promise.reject(new AcpError('Authentication required.', 'rpc', -32000)) });
    await expect(driver.start({ cwd: '/repo', model: null, permissionMode: 'default' }, recorder().events)).rejects.toThrow('Sign in first.');

    const turn = promptGate();
    const { driver: other } = driverWith({ 'session/prompt': turn.answer });
    const { seen, events } = recorder();
    const session = await other.start({ cwd: '/repo', model: null, permissionMode: 'default' }, events);
    await session.send('go', []);
    turn.fail(new AcpError('Rate limit exceeded. Try again later.', 'rpc', 429));
    await tick();
    expect(seen.states.at(-1)).toBe('error: Rate limit exceeded. Try again later.');
  });

  it('loads the session again after the process ended', async () => {
    const turn = promptGate();
    const { agent, driver } = driverWith({ 'session/load': {}, 'session/prompt': () => turn.answer() }, { replayMs: 0 });
    const { events } = recorder();
    const session = await driver.start({ cwd: '/repo', model: null, permissionMode: 'default' }, events);
    agent.exit();
    await session.send('again', []);
    expect(agent.requests.map((r) => r.method)).toEqual(['session/new', 'session/set_mode', 'session/load', 'session/set_mode', 'session/prompt']);
    turn.end();
  });

  it('lets go of the process when a session closes, and answers a card for a session not running here as cancelled', async () => {
    const { agent, driver } = driverWith({});
    const session = await driver.start({ cwd: '/repo', model: null, permissionMode: 'default' }, recorder().events);
    expect(agent.holds()).toBe(1);
    await session.close();
    expect(agent.holds()).toBe(0);
    expect(await agent.ask('session/request_permission', { sessionId: SESSION, toolCall: { toolCallId: 'x' }, options: [] })).toEqual({ outcome: { outcome: 'cancelled' } });
    await expect(agent.ask('fs/read_text_file', {})).rejects.toThrow('Seshboard does not handle fs/read_text_file');
  });

  it('starts a read-only session in the mode that asks before anything that writes', async () => {
    const { agent, driver } = driverWith({});
    await driver.start({ cwd: '/repo', model: null, permissionMode: 'auto', readOnly: true }, recorder().events);
    expect(agent.requests[1]).toEqual({ method: 'session/set_mode', params: { sessionId: SESSION, modeId: 'ro' } });
  });
});
