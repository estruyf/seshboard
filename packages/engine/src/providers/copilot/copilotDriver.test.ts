import { describe, expect, it } from 'vitest';
import type { PermissionRequest, StreamDelta } from '@seshboard/protocol';
import type { RawSessionMessage } from '../../claude/transcript.ts';
import type { DriverEvents } from '../provider.ts';
import { copilotCandidates, parseCopilotVersion } from './copilotBinary.ts';
import { copilotDriver, SESHBOARD_CLIENT, type CopilotSdkClient, type CopilotSdkSession, type CopilotSessionOptions, type CreateCopilotClient } from './copilotDriver.ts';
import type { CopilotEvent } from './copilotEvents.ts';
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
  const log = { stream: [] as Array<Omit<StreamDelta, 'sessionId'>>, messages: [] as RawSessionMessage[], states: [] as string[], permissions: [] as Array<Omit<PermissionRequest, 'sessionId'>>, done: [] as string[] };
  const events: DriverEvents = {
    stream: (d) => log.stream.push(d),
    messages: (m) => log.messages.push(...m),
    state: (s, e) => log.states.push(e ? `${s}:${e}` : s),
    permission: (r) => log.permissions.push(r),
    permissionDone: (id) => log.done.push(id),
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
    const session = await driver.start({ cwd: '/work/demo', model: 'gpt-5-mini' }, events);
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
    const session = await driver.start({ cwd: '/work/demo', model: null, resume: 'abc' }, events);
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
    await expect(missing.start({ cwd: '/w', model: null }, recorder().events)).rejects.toThrow(/Install/);

    const signedOut = copilotDriver({ binary, env, createClient: fakeSdk({ isAuthenticated: false, statusMessage: 'Not signed in' }).createClient });
    expect(await signedOut.status()).toMatchObject({ signedIn: false, problem: expect.stringMatching(/run `copilot` in a terminal and use \/login/) });

    const ok = copilotDriver({ binary, env, createClient: fakeSdk().createClient });
    expect(await ok.status()).toEqual({ binary: '/usr/local/bin/copilot', version: '1.0.90', signedIn: true, account: 'octocat (via gh)', problem: null });
    expect(await ok.models()).toEqual([{ value: 'gpt-5-mini', displayName: 'GPT-5 mini', description: '', supportsEffort: true }]);
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
