import { describe, expect, it } from 'vitest';
import type { PermissionRequest, StreamDelta } from '@seshboard/protocol';
import type { RawSessionMessage } from '../../claude/transcript.ts';
import type { DriverEvents } from '../provider.ts';
import { copilotCandidates, parseCopilotVersion } from './copilotBinary.ts';
import { copilotDriver, SESHBOARD_CLIENT, type CopilotSdkClient, type CopilotSdkSession, type CopilotSessionOptions, type CreateCopilotClient } from './copilotDriver.ts';
import type { CopilotEvent } from './copilotEvents.ts';
import { commandList, commandOutcome, parseCommand } from './copilotCommands.ts';
import { toCopilotDecision, toPermissionRequest } from './copilotPermissions.ts';

/** A Copilot SDK that plays back events as the real one would, and records what it was asked. */
function fakeSdk(auth = { isAuthenticated: true, statusMessage: 'octocat (via gh)' }) {
  const calls: string[] = [];
  let handler: ((event: CopilotEvent) => void) | undefined;
  let options: CopilotSessionOptions | undefined;
  const session: CopilotSdkSession = {
    sessionId: 'c0ffee00-0000-4000-8000-000000000001',
    on: (h) => ((handler = h), () => (handler = undefined)),
    send: async ({ prompt, attachments }) => (calls.push(`send:${prompt}:${attachments?.length ?? 0}`), 'm1'),
    abort: async () => void calls.push('abort'),
    setModel: async (model) => void calls.push(`model:${model}`),
    disconnect: async () => void calls.push('disconnect'),
    rpc: {
      mode: { set: async ({ mode }) => void calls.push(`mode:${mode}`) },
      commands: {
        list: async () => ({ commands: [{ name: 'compact', description: 'Compact the conversation' }, { name: 'review', description: 'Review', input: { hint: '[path]' } }, { name: 'model', description: 'Pick a model' }] }),
        invoke: async ({ name, input }) => (calls.push(`invoke:${name}:${input ?? ''}`), name === 'review' ? { kind: 'agent-prompt', prompt: `Review ${input}`, displayPrompt: 'Review' } : { kind: 'completed', message: 'Compacted.' }),
      },
      mcp: {
        list: async () => ({ servers: [{ name: 'github', status: 'connected', source: 'user' }, { name: 'docs', status: 'stopped', error: 'Exited' }] }),
        enable: async ({ serverName }) => void calls.push(`mcp:enable:${serverName}`),
        disable: async ({ serverName }) => void calls.push(`mcp:disable:${serverName}`),
        restartServer: async ({ serverName }) => void calls.push(`mcp:restart:${serverName}`),
      },
      skills: { list: async () => ({ skills: [{ name: 'deploy', description: 'Ship it', source: 'project' }, { name: 'github-pr-media', source: 'builtin' }] }) },
      agent: { list: async () => ({ agents: [{ name: 'reviewer', description: 'Reviews code' }] }) },
    },
  };
  const client: CopilotSdkClient = {
    start: async () => void calls.push('start'),
    stop: async () => void calls.push('stop'),
    getAuthStatus: async () => auth,
    listModels: async () => [{ id: 'gpt-5-mini', name: 'GPT-5 mini', capabilities: { supports: { reasoningEffort: true } } }],
    createSession: async (o) => ((options = o), calls.push(`create:${o.workingDirectory}:${o.model ?? '-'}`), session),
    resumeSession: async (id, o) => ((options = o), calls.push(`resume:${id}`), session),
  };
  const created: Array<{ cliPath: string }> = [];
  const createClient: CreateCopilotClient = async (o) => (created.push(o), client);
  return { calls, created, createClient, emit: (event: CopilotEvent) => handler?.(event), options: () => options! };
}

function recorder() {
  const log = { stream: [] as Array<Omit<StreamDelta, 'sessionId'>>, messages: [] as RawSessionMessage[], states: [] as string[], permissions: [] as Array<Omit<PermissionRequest, 'sessionId'>>, done: [] as string[], usage: [] as unknown[], models: [] as string[] };
  const events: DriverEvents = {
    stream: (d) => log.stream.push(d),
    messages: (m) => log.messages.push(...m),
    state: (s, e) => log.states.push(e ? `${s}:${e}` : s),
    permission: (r) => log.permissions.push(r),
    permissionDone: (id) => log.done.push(id),
    usage: (u) => log.usage.push(u),
    model: (m) => log.models.push(m),
  };
  return { log, events };
}

const binary = async () => ({ path: '/usr/local/bin/copilot', version: '1.0.90' });
const env = async () => ({ PATH: '/usr/bin' });

describe('copilotDriver', () => {
  it('runs a turn: streams, asks before a tool, and ends with complete messages', async () => {
    const sdk = fakeSdk();
    const driver = copilotDriver({ binary, env, createClient: sdk.createClient });
    const { log, events } = recorder();
    const session = await driver.start({ cwd: '/work/demo', model: 'gpt-5-mini', permissionMode: 'default' }, events);
    expect(sdk.created).toEqual([{ cliPath: '/usr/local/bin/copilot', env: { PATH: '/usr/bin' } }]);
    expect(sdk.options()).toMatchObject({ workingDirectory: '/work/demo', model: 'gpt-5-mini', streaming: true, clientName: SESHBOARD_CLIENT });
    // No token anywhere: copilot signs in on its own.
    expect(JSON.stringify(sdk.created)).not.toMatch(/token/i);

    await session.send('Add a test', []);
    sdk.emit({ type: 'assistant.turn_start', data: {} });
    sdk.emit({ type: 'assistant.message_delta', data: { deltaContent: 'Adding' } });
    sdk.emit({ type: 'assistant.message', id: 'a1', timestamp: '2026-10-30T10:00:00.000Z', data: { content: 'Adding it.', toolRequests: [{ toolCallId: 't1', name: 'bash', arguments: { command: 'npm test' } }] } });
    sdk.emit({ type: 'tool.execution_start', data: { toolCallId: 't1', toolName: 'bash' } });
    const answer = sdk.options().onPermissionRequest({ requestId: 'p1', kind: 'shell', fullCommandText: 'npm test', intention: 'Run the tests', canOfferSessionApproval: true }, { sessionId: session.sessionId });
    expect(log.permissions).toEqual([expect.objectContaining({ requestId: 'p1', toolName: 'Bash', input: { command: 'npm test', description: 'Run the tests' }, alwaysLabel: 'Allow for this session' })]);
    session.respond('p1', { behavior: 'allow', always: true });
    await expect(answer).resolves.toEqual({ kind: 'approve-for-session' });
    sdk.emit({ type: 'tool.execution_complete', id: 'r1', data: { toolCallId: 't1', success: true, result: { content: 'ok' } } });
    sdk.emit({ type: 'session.idle', data: {} });

    expect(sdk.calls).toContain('send:Add a test:0');
    expect(log.states).toEqual(['running', 'idle']);
    expect(log.stream).toEqual([{ kind: 'text', text: 'Adding' }, { kind: 'clear', text: '' }, { kind: 'tool', text: 'Bash' }, { kind: 'clear', text: '' }]);
    expect(log.messages.map((m) => m.type)).toEqual(['assistant', 'user']);
    expect(log.done).toEqual(['p1']);
  });

  it('stops a turn, answering what is still open, and resumes by id', async () => {
    const sdk = fakeSdk();
    const driver = copilotDriver({ binary, env, createClient: sdk.createClient });
    const { log, events } = recorder();
    const session = await driver.start({ cwd: '/work/demo', model: null, resume: 'abc', permissionMode: 'default' }, events);
    expect(sdk.calls).toContain('resume:abc');
    const answer = sdk.options().onPermissionRequest({ requestId: 'p2', kind: 'write', fileName: '/work/demo/a.ts', diff: '+x' }, { sessionId: 'abc' });
    await session.interrupt();
    await expect(answer).resolves.toEqual({ kind: 'user-not-available' });
    expect(log.done).toEqual(['p2']);
    expect(sdk.calls).toContain('abort');
    await session.setModel(null);
    expect(sdk.calls).toContain('model:auto');
    await session.close();
    await driver.dispose();
    expect(sdk.calls.slice(-2)).toEqual(['disconnect', 'stop']);
  });

  it('says how to install or sign in, and never asks for a credential', async () => {
    const missing = copilotDriver({ binary: async () => null, env, createClient: fakeSdk().createClient });
    expect(await missing.status()).toMatchObject({ binary: null, signedIn: false, problem: expect.stringMatching(/Install GitHub Copilot CLI/) });
    await expect(missing.start({ cwd: '/w', model: null, permissionMode: 'default' }, recorder().events)).rejects.toThrow(/Install/);

    const signedOut = copilotDriver({ binary, env, createClient: fakeSdk({ isAuthenticated: false, statusMessage: 'Not signed in' }).createClient });
    expect(await signedOut.status()).toMatchObject({ signedIn: false, problem: expect.stringMatching(/Sign in on this profile in Settings › Profiles, or run `copilot login`/) });

    const ok = copilotDriver({ binary, env, createClient: fakeSdk().createClient });
    expect(await ok.status()).toEqual({ binary: '/usr/local/bin/copilot', version: '1.0.90', signedIn: true, account: 'octocat (via gh)', problem: null });
    expect(await ok.models()).toEqual([{ value: 'gpt-5-mini', displayName: 'GPT-5 mini', description: '', supportsEffort: true }]);
  });

  it('runs in Copilot\'s agent modes, approves edits itself where the mode says so, and reports usage', async () => {
    const sdk = fakeSdk();
    const driver = copilotDriver({ binary, env, createClient: sdk.createClient });
    const { log, events } = recorder();
    const session = await driver.start({ cwd: '/w', model: null, permissionMode: 'plan' }, events);
    // Plan mode is set before the first message.
    expect(sdk.calls).toContain('mode:plan');
    await session.setMode('acceptEdits');
    expect(sdk.calls).toContain('mode:interactive');
    // Accept edits: a file write is approved without a card; a command still asks.
    await expect(sdk.options().onPermissionRequest({ kind: 'write', fileName: '/w/a.ts' }, { sessionId: 's' })).resolves.toEqual({ kind: 'approve-once' });
    void sdk.options().onPermissionRequest({ kind: 'shell', fullCommandText: 'rm -rf x' }, { sessionId: 's' });
    expect(log.permissions.map((p) => p.toolName)).toEqual(['Bash']);
    await session.setMode('auto');
    expect(sdk.calls).toContain('mode:autopilot');
    await session.send('Steer', [], true);
    expect(sdk.calls).toContain('send:Steer:0');

    sdk.emit({ type: 'session.usage_info', data: { currentTokens: 13_289, tokenLimit: 128_000 } });
    sdk.emit({ type: 'assistant.usage', data: { cost: 0.33 } });
    sdk.emit({ type: 'assistant.usage', data: { cost: 0.33 } });
    expect(log.usage).toEqual([{ contextTokens: 13_289, contextMax: 128_000 }, { spent: { amount: 0.33, unit: 'premium requests' } }, { spent: { amount: 0.66, unit: 'premium requests' } }]);
    expect(driver.modes.map((m) => m.value)).toEqual(['default', 'acceptEdits', 'plan', 'auto']);
  });
});

describe('Copilot slash commands', () => {
  it('lists its commands without the ones Seshboard has, and runs a message that starts with one', async () => {
    const sdk = fakeSdk();
    const driver = copilotDriver({ binary, env, createClient: sdk.createClient });
    const { log, events } = recorder();
    const session = await driver.start({ cwd: '/w', model: null, permissionMode: 'default' }, events);
    expect(await session.commands()).toEqual([
      { name: 'compact', description: 'Compact the conversation', argumentHint: '' },
      { name: 'review', description: 'Review', argumentHint: '[path]' },
    ]);
    // Words back, no turn: shown in the conversation, and the session is ready again.
    await session.send('/compact', []);
    expect(sdk.calls).toContain('invoke:compact:');
    expect(log.messages.map((m) => [(m.message as { content: Array<{ text: string }> }).content[0]!.text, m.type])).toEqual([['/compact', 'user'], ['Compacted.', 'assistant']]);
    expect(log.states).toEqual(['idle']);
    // A prompt the command makes goes as a turn.
    await session.send('/review src', []);
    expect(sdk.calls.slice(-2)).toEqual(['invoke:review:src', 'send:Review src:0']);
    // Seshboard's own control (the model chip), and text that only looks like a command, go as messages.
    await session.send('/model gpt-5', []);
    await session.send('/etc/hosts is odd', []);
    expect(sdk.calls.slice(-2)).toEqual(['send:/model gpt-5:0', 'send:/etc/hosts is odd:0']);
    sdk.emit({ type: 'session.model_change', data: { newModel: 'gpt-5-mini' } });
    expect(log.models).toEqual(['gpt-5-mini']);
  });

  it('shows its MCP servers, agents and own skills in Tools, and turns servers on and off', async () => {
    const sdk = fakeSdk();
    const session = await copilotDriver({ binary, env, createClient: sdk.createClient }).start({ cwd: '/w', model: null, permissionMode: 'default' }, recorder().events);
    expect(await session.capabilities()).toEqual({
      live: true,
      mcp: [
        { name: 'github', status: 'connected', scope: 'user', tools: [], error: null, version: null },
        { name: 'docs', status: 'disabled', scope: null, tools: [], error: 'Exited', version: null },
      ],
      agents: [{ name: 'reviewer', description: 'Reviews code', model: null }],
      // Copilot's built-in skills are left out, as Claude Code's built-in commands are.
      commands: [{ name: 'deploy', description: 'Ship it', argumentHint: '' }],
      plugins: [],
    });
    await session.mcp('docs', 'enable');
    await session.mcp('github', 'reconnect');
    expect(sdk.calls.slice(-2)).toEqual(['mcp:enable:docs', 'mcp:restart:github']);
  });

  it('turns each kind of result into a prompt, words or a model', () => {
    expect(commandOutcome('x', { kind: 'set-model', model: 'gpt-5' })).toEqual({ prompt: null, note: null, model: 'gpt-5' });
    expect(commandOutcome('env', { kind: 'select-subcommand', title: 'Pick', options: [{ name: 'show' }, { name: 'set' }] }).note).toBe('/env takes one of: `show`, `set`.');
    expect(commandOutcome('model', { kind: 'show-dialog' }).note).toMatch(/model chip/);
    expect(commandOutcome('x', { kind: 'add-timeline-entry', entry: { type: 'info', text: 'Done' } }).note).toBe('Done');
    expect(parseCommand('/YOLO', [{ name: 'allow-all', aliases: ['yolo'] }])).toBeNull();
    expect(parseCommand('/compact  keep the plan ', [{ name: 'compact' }])).toEqual({ name: 'compact', input: 'keep the plan' });
    expect(commandList([{ name: 'plan' }, { name: 'usage', description: 'Usage' }])).toEqual([{ name: 'usage', description: 'Usage', argumentHint: '' }]);
  });
});

describe('copilot permissions', () => {
  it('maps requests onto the permission card and answers back', () => {
    expect(toPermissionRequest('p', { kind: 'write', fileName: '/a.ts', diff: '-a\n+b', intention: 'Edit a.ts' }, 5)).toMatchObject({ toolName: 'Edit', input: { file_path: '/a.ts', diff: '-a\n+b' }, title: 'Edit a.ts', alwaysLabel: null, createdAt: 5 });
    expect(toPermissionRequest('p', { kind: 'mcp', serverName: 'github', toolName: 'get_issue', args: { n: 1 } }).toolName).toBe('mcp__github__get_issue');
    expect(toCopilotDecision({ behavior: 'allow', always: false })).toEqual({ kind: 'approve-once' });
    expect(toCopilotDecision({ behavior: 'deny', message: 'No' })).toEqual({ kind: 'reject', feedback: 'No' });
  });
});

describe('copilotBinary', () => {
  it('looks on PATH, then where installers put it', () => {
    expect(copilotCandidates({ PATH: '/opt/bin:/usr/bin' }, '/home/me', 'darwin')).toEqual(['/opt/bin/copilot', '/usr/bin/copilot', '/home/me/.local/bin/copilot', '/opt/homebrew/bin/copilot', '/usr/local/bin/copilot']);
    expect(copilotCandidates({ PATH: 'C:\\tools', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, 'C:\\Users\\me', 'win32')).toEqual([
      'C:\\tools\\copilot.exe',
      'C:\\Users\\me\\.local\\bin\\copilot.exe',
      'C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Links\\copilot.exe',
    ]);
    expect(parseCopilotVersion('GitHub Copilot CLI 1.0.90-0.\nRun copilot update')).toBe('1.0.90-0');
  });
});
