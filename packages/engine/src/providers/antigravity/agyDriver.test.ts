import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PermissionRequest } from '@seshboard/protocol';
import type { RawSessionMessage } from '../../claude/transcript.ts';
import { fakeAcpConnection } from '../acp/acpFakes.ts';
import type { DriverEvents } from '../provider.ts';
import { AGY_SIGN_IN, agyDriver, askContext } from './agyDriver.ts';
import { AcpError } from '../acp/acpConnection.ts';
import { AGY_DEMO_CONFIG } from './agyDemo.ts';

const ID = '7a1c0e52-4b3d-4e8f-9a10-00000000aaaa';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function recorder() {
  const states: string[] = [];
  const messages: RawSessionMessage[] = [];
  const cards: Array<Omit<PermissionRequest, 'sessionId'>> = [];
  const done: string[] = [];
  const events: DriverEvents = {
    stream: () => {},
    messages: (m) => messages.push(...m),
    state: (s, e) => states.push(e ? `${s}: ${e}` : s),
    permission: (r) => cards.push(r),
    permissionDone: (id) => done.push(id),
    usage: () => {},
    model: () => {},
  };
  return { events, states, messages, cards, done };
}

/** An `agy acp` that starts sessions and answers prompts when the test says. */
function fakeAgy(extra: Record<string, unknown> = {}) {
  const prompts: Array<{ resolve: (value: unknown) => void; reject: (error: Error) => void; params: Record<string, unknown> }> = [];
  const fake = fakeAcpConnection({
    'session/new': { sessionId: ID, configOptions: AGY_DEMO_CONFIG, _meta: { antigravity: { tier: { name: 'Google AI Pro' } } } },
    'session/set_mode': {},
    'session/set_config_option': (params: Record<string, unknown>) => ({ configOptions: AGY_DEMO_CONFIG.map((o) => (o.id === params.configId ? { ...o, currentValue: params.value } : o)) }),
    'session/close': {},
    'session/prompt': (params: Record<string, unknown>) => new Promise((resolve, reject) => prompts.push({ resolve, reject, params })),
    ...extra,
  });
  const geminiDir = mkdtempSync(join(tmpdir(), 'seshboard-agy-driver-'));
  const driver = agyDriver({ connection: fake.connection, geminiDir, binary: async () => ({ path: '/bin/agy', version: '1.5.12' }), has: async (id) => id === ID });
  return { fake, driver, prompts, geminiDir };
}

describe('agyDriver', () => {
  it('says it is signed in, on which plan, with its models and commands, from a session it closes at once', async () => {
    const { fake, driver } = fakeAgy();
    const status = driver.status();
    await tick();
    fake.update(ID, { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'compact', description: 'Compact' }] });
    expect(await status).toMatchObject({ signedIn: true, account: 'Google AI Pro', version: '1.5.12', problem: null });
    expect(fake.requests.map((r) => r.method)).toEqual(['session/new', 'session/close']);
    expect((await driver.models()).map((m) => [m.value, m.supportsEffort, m.efforts])).toEqual([
      ['gemini-4-neon', true, ['low', 'medium', 'high', 'xhigh']],
      ['gemini-3.8-flash', true, ['low', 'medium', 'high', 'xhigh']],
      ['claude-sonnet-5-5', true, ['low', 'medium', 'high', 'xhigh']],
    ]);
    expect(await driver.commands()).toEqual([{ name: 'compact', description: 'Compact', argumentHint: '' }]);
  });

  it('says how to sign in when Antigravity needs a login', async () => {
    const { driver } = fakeAgy({
      'session/new': () => {
        throw new AcpError('Authentication required', 'rpc', -32000);
      },
    });
    expect(await driver.status()).toMatchObject({ signedIn: false, problem: AGY_SIGN_IN });
  });

  it('starts a session in its mode, model and thinking level, sends prompts and steers a second into the turn', async () => {
    const { fake, driver, prompts } = fakeAgy();
    const r = recorder();
    const session = await driver.start({ cwd: '/w', model: 'gemini-3.8-flash', effort: 'max', permissionMode: 'acceptEdits' }, r.events);
    expect(fake.requests.slice(1, 4).map((q) => [q.method, q.params.modeId ?? q.params.value])).toEqual([
      ['session/set_mode', 'accept-edits'],
      ['session/set_config_option', 'gemini-3.8-flash'],
      ['session/set_config_option', 'xhigh'],
    ]);
    expect(await session.send('Hello', [])).toBe(`${ID}~u1`);
    expect(r.messages.map((m) => m.uuid)).toEqual([`${ID}~u1`]);
    // Sent while the turn runs: Antigravity answers the first prompt at once and goes on with the second.
    expect(await session.send('Also this', [], true)).toBe(`${ID}~u2`);
    fake.update(ID, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Done' } });
    prompts[0]!.resolve({ stopReason: 'end_turn' });
    await tick();
    expect(r.states).toEqual(['running', 'running']);
    prompts[1]!.resolve({ stopReason: 'end_turn' });
    await tick();
    expect(r.states.at(-1)).toBe('idle');
    expect(r.messages.map((m) => m.uuid)).toEqual([`${ID}~u1`, `${ID}~u2`, `${ID}~u2~1`]);
    await session.close();
    expect(fake.requests.at(-1)!.method).toBe('session/close');
    expect(fake.holds()).toBe(0);
  });

  it('loads a session it has, counting the prompts so far, and refuses one it does not', async () => {
    const { fake, driver } = fakeAgy({
      'session/load': () => {
        fake.update(ID, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'One' } });
        fake.update(ID, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hi' } });
        fake.update(ID, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Two' } });
        return { sessionId: ID, configOptions: AGY_DEMO_CONFIG };
      },
    });
    const r = recorder();
    const session = await driver.start({ cwd: '/w', resume: ID, model: null, permissionMode: 'default' }, r.events);
    // The replay isn't shown again.
    expect(r.messages).toEqual([]);
    expect(await session.send('Three', [])).toBe(`${ID}~u3`);
    await expect(driver.start({ cwd: '/w', resume: '7a1c0e52-4b3d-4e8f-9a10-00000000ffff', model: null, permissionMode: 'default' }, recorder().events)).rejects.toThrow(/doesn't have this session/);
  });

  it('shows permission requests as cards, answers them, and drops them when stopped', async () => {
    const { fake, driver } = fakeAgy();
    const r = recorder();
    const session = await driver.start({ cwd: '/w', model: null, permissionMode: 'default' }, r.events);
    const options = [
      { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
      { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
    ];
    const toolCall = { toolCallId: 'c1', name: 'run_command', kind: 'execute', title: 'ls', args: { CommandLine: 'ls -la' } };
    const asked = fake.ask('session/request_permission', { sessionId: ID, toolCall, options });
    await tick();
    expect(r.cards[0]).toMatchObject({ toolName: 'Bash', input: { command: 'ls -la' }, alwaysLabel: null });
    session.respond(r.cards[0]!.requestId, { behavior: 'allow' });
    expect(await asked).toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } });
    const second = fake.ask('session/request_permission', { sessionId: ID, toolCall, options });
    await tick();
    await session.interrupt();
    expect(await second).toEqual({ outcome: { outcome: 'cancelled' } });
    expect(r.done).toEqual([r.cards[0]!.requestId, r.cards[1]!.requestId]);
  });

  it('lets a read-only session read, and declines anything else without a card', async () => {
    const { fake, driver } = fakeAgy();
    const r = recorder();
    await driver.start({ cwd: '/w', model: null, permissionMode: 'auto', readOnly: true }, r.events);
    expect(fake.requests[1]!.params.modeId).toBe('default');
    const options = [
      { optionId: 'allow', kind: 'allow_once' },
      { optionId: 'deny', kind: 'reject_once' },
    ];
    expect(await fake.ask('session/request_permission', { sessionId: ID, toolCall: { toolCallId: 'a', name: 'run_command', args: { CommandLine: 'git status' } }, options })).toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } });
    expect(await fake.ask('session/request_permission', { sessionId: ID, toolCall: { toolCallId: 'b', name: 'write_file', args: { Path: '/w/a', Content: 'x' } }, options })).toEqual({ outcome: { outcome: 'selected', optionId: 'deny' } });
    expect(r.cards).toEqual([]);
  });

  it("allows Seshboard's own MCP tools without a card, in every mode", async () => {
    const { fake, driver } = fakeAgy();
    const r = recorder();
    await driver.start({ cwd: '/w', model: null, permissionMode: 'auto', mcpServers: { 'seshboard-browser': { command: '/bin/node', args: [], env: {} } } }, r.events);
    const options = [
      { optionId: 'allow', kind: 'allow_once' },
      { optionId: 'deny', kind: 'reject_once' },
    ];
    expect(await fake.ask('session/request_permission', { sessionId: ID, toolCall: { toolCallId: 'a', name: 'mcp_seshboard-browser_open', args: { url: 'http://localhost:3000' } }, options })).toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } });
    expect(r.cards).toEqual([]);
    void fake.ask('session/request_permission', { sessionId: ID, toolCall: { toolCallId: 'b', name: 'mcp_github_create_issue', args: {} }, options });
    await tick();
    expect(r.cards.map((c) => c.toolName)).toEqual(['mcp_github_create_issue']);
  });

  it('reports a crash on the session and resumes it with the next message', async () => {
    const { fake, driver } = fakeAgy({ 'session/resume': { sessionId: ID } });
    const r = recorder();
    const session = await driver.start({ cwd: '/w', model: null, permissionMode: 'default' }, r.events);
    fake.exit();
    expect(r.states.at(-1)).toMatch(/^error: Antigravity stopped/);
    await session.send('Again', []);
    expect(fake.requests.map((q) => q.method)).toContain('session/resume');
  });

  it('answers Ask about this session in a session of its own, read only, that goes to the Trash after', async () => {
    const discarded: string[] = [];
    const fake = fakeAcpConnection({
      'session/new': { sessionId: ID },
      'session/set_mode': {},
      'session/close': {},
      'session/prompt': async () => {
        fake.update(ID, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'It ' } });
        fake.update(ID, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'works.' } });
        return { stopReason: 'end_turn' };
      },
    });
    const transcript: RawSessionMessage[] = [{ type: 'user', uuid: 'u', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'text', text: 'Fix the cart' }] } }];
    const dir = mkdtempSync(join(tmpdir(), 'seshboard-agy-ask-'));
    const driver = agyDriver({ connection: fake.connection, geminiDir: dir, binary: async () => null, has: async () => true, transcript: async () => transcript, discard: async (id) => void discarded.push(id) });
    const forks: string[] = [];
    const texts: string[] = [];
    const result = await driver.ask({ sessionId: 'other', cwd: '/w', model: null, prompt: 'Did it work?', onFork: (id) => forks.push(id), onText: (t) => 'delta' in t && texts.push(t.delta) });
    expect(result).toEqual({ answer: 'It works.', spent: 0 });
    expect(forks).toEqual([ID]);
    expect(texts.join('')).toBe('It works.');
    expect(String((fake.requests.find((q) => q.method === 'session/prompt')!.params.prompt as Array<{ text: string }>)[0]!.text)).toContain('User: Fix the cart');
    expect(discarded).toEqual([ID]);
    expect(askContext(transcript)).toBe('User: Fix the cart');
  });

  it('lists the MCP servers of its config for Tools, and leaves turning them on or off to Antigravity', async () => {
    const { driver, geminiDir } = fakeAgy();
    mkdirSync(join(geminiDir, 'config'), { recursive: true });
    writeFileSync(join(geminiDir, 'config', 'mcp_config.json'), JSON.stringify({ mcpServers: { web: { serverUrl: 'https://x', disabled: true }, fs: { command: 'npx' } } }));
    const tools = await driver.capabilities!('/w');
    expect(tools.mcp.map((s) => [s.name, s.status])).toEqual([
      ['fs', 'pending'],
      ['web', 'disabled'],
    ]);
    expect(tools.mcpToggle).toBe(false);
  });
});
