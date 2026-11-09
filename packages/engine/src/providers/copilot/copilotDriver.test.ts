import { describe, expect, it } from 'vitest';
import type { BackgroundTask, PermissionRequest, StreamDelta } from '@seshboard/protocol';
import { vi } from 'vitest';
import type { RawSessionMessage } from '../../claude/transcript.ts';
import type { DriverEvents } from '../provider.ts';
import { copilotCandidates, npmCopilot, parseCopilotVersion } from './copilotBinary.ts';
import { copilotDriver, premiumQuota, SESHBOARD_CLIENT, type CopilotSdkClient, type CopilotSdkSession, type CopilotSessionOptions, type CreateCopilotClient } from './copilotDriver.ts';
import type { CopilotTask } from './copilotActions.ts';
import type { CopilotEvent } from './copilotEvents.ts';
import type { CopilotAutoTier } from './copilotFusion.ts';
import { commandList, commandOutcome, parseCommand } from './copilotCommands.ts';
import { toCopilotDecision, toPermissionRequest } from './copilotPermissions.ts';

/** A Copilot SDK that plays back events as the real one would, and records what it was asked. */
function fakeSdk(auth: { isAuthenticated: boolean; statusMessage?: string; login?: string } = { isAuthenticated: true, statusMessage: 'octocat (via gh)', login: 'octocat' }) {
  const calls: string[] = [];
  let handler: ((event: CopilotEvent) => void) | undefined;
  let options: CopilotSessionOptions | undefined;
  const session: CopilotSdkSession = {
    sessionId: 'c0ffee00-0000-4000-8000-000000000001',
    on: (h) => ((handler = h), () => (handler = undefined)),
    send: async ({ prompt, attachments }) => (calls.push(`send:${prompt}:${attachments?.length ?? 0}`), 'm1'),
    abort: async () => void calls.push('abort'),
    setModel: async (model, o) => void calls.push(`model:${model}${o?.reasoningEffort ? `:${o.reasoningEffort}` : ''}${o && 'autoTier' in o ? `:tier=${o.autoTier}` : ''}`),
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
      name: { set: async ({ name }) => void calls.push(`name:${name}`) },
      history: {
        listRewindPoints: async () => rewind.points,
        previewRewind: async ({ eventId }) => (calls.push(`preview:${eventId}`), { available: true, files: [{ path: '/work/demo/a.ts', linesAdded: 2, linesRemoved: 5 }] }),
        rewind: async ({ eventId, mode }) => (calls.push(`rewind:${eventId}:${mode}`), rewind.outcome),
      },
      tasks: {
        list: async () => ({ tasks: tasks.list }),
        cancel: async ({ id }) => (calls.push(`cancel:${id}`), { cancelled: true }),
      },
    },
  };
  const rewind: { points: { fileChangeTrackingEnabled: boolean; unavailableReason?: string; points: Array<{ eventId: string }> }; outcome: { outcome: string; restoredFiles: string[]; error?: string } } = {
    points: { fileChangeTrackingEnabled: true, points: [{ eventId: 'u1' }] },
    outcome: { outcome: 'success', restoredFiles: ['/work/demo/a.ts'] },
  };
  const tasks: { list: CopilotTask[] } = { list: [] };
  const pages: Array<{ events: CopilotEvent[]; cursor: string; hasMore: boolean; cursorStatus: string }> = [];
  const reads: Array<string | undefined> = [];
  /** Auto's routing preferences the runtime lists (none: a runtime without them). */
  const auto: { tiers?: CopilotAutoTier[] } = {};
  /** What `listModels` answers instead of the one model most tests want. */
  const priced: { models?: Awaited<ReturnType<CopilotSdkClient['listModels']>> } = {};
  const client: CopilotSdkClient = {
    start: async () => void calls.push('start'),
    stop: async () => void calls.push('stop'),
    getAuthStatus: async () => auth,
    listModels: async () => priced.models ?? [{ id: 'gpt-5-mini', name: 'GPT-5 mini', capabilities: { supports: { reasoningEffort: true } }, supportedReasoningEfforts: ['low', 'medium', 'high', 'turbo'], defaultReasoningEffort: 'medium' }],
    createSession: async (o) => ((options = o), calls.push(`create:${o.workingDirectory}:${o.model ?? '-'}`), session),
    resumeSession: async (id, o) => ((options = o), calls.push(`resume:${id}`), session),
    deleteSession: async (id) => void calls.push(`delete:${id}`),
    rpc: {
      models: { list: async () => (auto.tiers ? { auto: { tiers: auto.tiers } } : {}) },
      sessions: {
        fork: async ({ sessionId, toEventId }) => (calls.push(`fork:${sessionId}:${toEventId ?? '-'}`), { sessionId: 'f0' }),
        readPersistedEvents: async ({ cursor }) => (reads.push(cursor), pages.shift()!),
        checkInUse: async ({ sessionIds }) => ({ inUse: sessionIds.filter((id) => id.startsWith('busy')) }),
      },
    },
  };
  const created: Array<{ cliPath: string }> = [];
  const createClient: CreateCopilotClient = async (o) => (created.push(o), client);
  return { calls, created, createClient, emit: (event: CopilotEvent) => handler?.(event), options: () => options!, rewind, tasks, pages, reads, auto, priced };
}

function recorder() {
  const log = { stream: [] as Array<Omit<StreamDelta, 'sessionId'>>, messages: [] as RawSessionMessage[], states: [] as string[], permissions: [] as Array<Omit<PermissionRequest, 'sessionId'>>, done: [] as string[], usage: [] as unknown[], models: [] as string[], tasks: [] as BackgroundTask[][] };
  const events: DriverEvents = {
    stream: (d) => log.stream.push(d),
    messages: (m) => log.messages.push(...m),
    state: (s, e) => log.states.push(e ? `${s}:${e}` : s),
    permission: (r) => log.permissions.push(r),
    permissionDone: (id) => log.done.push(id),
    usage: (u) => log.usage.push(u),
    model: (m) => log.models.push(m),
    tasks: (t) => log.tasks.push(t),
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
    expect(await ok.status()).toEqual({ binary: '/usr/local/bin/copilot', version: '1.0.90', signedIn: true, account: 'octocat (via gh)', login: 'octocat', problem: null });
    expect(await ok.models()).toEqual([{ value: 'gpt-5-mini', displayName: 'GPT-5 mini', description: '', supportsEffort: true, efforts: ['low', 'medium', 'high'] }]);
  });

  it("reads the account's premium requests from Copilot, unlimited as no entitlement", () => {
    expect(premiumQuota({ premium_interactions: { isUnlimitedEntitlement: false, entitlementRequests: 1500, usedRequests: 212, remainingPercentage: 85.87, resetDate: '2026-12-01' } })).toEqual({
      used: 212,
      entitlement: 1500,
      percentUsed: expect.closeTo(14.13, 2),
      resetsAt: '2026-12-01',
    });
    expect(premiumQuota({ premium_interactions: { isUnlimitedEntitlement: true, entitlementRequests: -1, usedRequests: 40, remainingPercentage: 100 } })).toEqual({ used: 40, entitlement: null, percentUsed: 0, resetsAt: null });
    expect(premiumQuota({ chat: { isUnlimitedEntitlement: true, entitlementRequests: -1, usedRequests: 0, remainingPercentage: 100 } })).toBeNull();
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
    const waiting = sdk.options().onPermissionRequest({ requestId: 'p3', kind: 'shell', fullCommandText: 'git status' }, { sessionId: 's' });
    expect(log.permissions.map((p) => p.toolName)).toEqual(['Bash']);
    // Auto mode is Copilot's autopilot with all permissions: the command already waiting runs, and so does the next one.
    await session.setMode('auto');
    expect(sdk.calls).toContain('mode:autopilot');
    await expect(waiting).resolves.toEqual({ kind: 'approve-once' });
    expect(log.done).toEqual(['p3']);
    await expect(sdk.options().onPermissionRequest({ kind: 'shell', fullCommandText: 'npm test' }, { sessionId: 's' })).resolves.toEqual({ kind: 'approve-once' });
    expect(log.permissions).toHaveLength(1);
    await session.send('Steer', [], true);
    expect(sdk.calls).toContain('send:Steer:0');

    sdk.emit({ type: 'session.usage_info', data: { currentTokens: 13_289, tokenLimit: 128_000 } });
    sdk.emit({ type: 'assistant.usage', data: { cost: 0.33 } });
    sdk.emit({ type: 'assistant.usage', data: { cost: 0.33 } });
    expect(log.usage).toEqual([{ contextTokens: 13_289, contextMax: 128_000 }, { spent: { amount: 0.33, unit: 'premium requests' } }, { spent: { amount: 0.66, unit: 'premium requests' } }]);
    expect(driver.modes.map((m) => m.value)).toEqual(['default', 'acceptEdits', 'plan', 'auto']);
  });

  it('offers Fusion tiers after Auto, starts and switches to them as Auto with the tier, and reports them back', async () => {
    const sdk = fakeSdk();
    const tier = (id: string, displayName: string, more: Partial<CopilotAutoTier> = {}): CopilotAutoTier => ({ id, displayName, description: `${displayName} routing`, type: 'fusion', status: { enabled: true }, ...more });
    sdk.auto.tiers = [tier('fusion-standard', 'Fusion Standard'), tier('fusion-max', 'Fusion Max'), tier('balance', 'Balance', { type: 'auto' }), tier('fusion-high', 'Fusion High', { status: { enabled: false } })];
    const driver = copilotDriver({ binary, env, createClient: sdk.createClient });
    expect((await driver.models()).map((m) => [m.value, m.displayName, m.supportsEffort])).toEqual([
      ['auto:fusion-standard', 'Fusion Standard', false],
      ['auto:fusion-max', 'Fusion Max', false],
      ['gpt-5-mini', 'GPT-5 mini', true],
    ]);

    const { log, events } = recorder();
    const session = await driver.start({ cwd: '/w', model: 'auto:fusion-max', effort: 'high', permissionMode: 'default' }, events);
    // Fusion picks its own effort: none goes with it.
    expect(sdk.options()).toMatchObject({ model: 'auto', autoTier: 'fusion-max' });
    expect(sdk.options().reasoningEffort).toBeUndefined();
    sdk.emit({ type: 'session.model_change', data: { newModel: 'auto', autoTier: 'fusion-max' } });
    expect(log.models).toEqual(['auto:fusion-max']);
    await expect(session.setEffort!('low')).rejects.toThrow(/Fusion picks its own effort/);

    await session.setModel('auto:fusion-standard');
    // Back to Copilot's default: Auto's own routing again.
    await session.setModel(null);
    await session.setModel('gpt-5-mini');
    expect(sdk.calls.filter((c) => c.startsWith('model:'))).toEqual(['model:auto:tier=fusion-standard', 'model:auto:tier=null', 'model:gpt-5-mini']);
  });

  it('leaves Auto alone on a runtime without Fusion', async () => {
    const sdk = fakeSdk();
    const driver = copilotDriver({ binary, env, createClient: sdk.createClient });
    expect((await driver.models()).map((m) => m.value)).toEqual(['gpt-5-mini']);
    const session = await driver.start({ cwd: '/w', model: 'gpt-5-mini', permissionMode: 'default' }, recorder().events);
    await session.setModel(null);
    expect(sdk.calls).toContain('model:auto');
  });

  it('approves only reads by itself in a read-only step, even in Auto mode', async () => {
    const sdk = fakeSdk();
    const driver = copilotDriver({ binary, env, createClient: sdk.createClient });
    const { log, events } = recorder();
    await driver.start({ cwd: '/w', model: null, permissionMode: 'auto', readOnly: true }, events);
    await expect(sdk.options().onPermissionRequest({ kind: 'read', path: '/w/a.ts' }, { sessionId: 's' })).resolves.toEqual({ kind: 'approve-once' });
    void sdk.options().onPermissionRequest({ kind: 'shell', fullCommandText: 'rm -rf x' }, { sessionId: 's' });
    void sdk.options().onPermissionRequest({ kind: 'write', fileName: '/w/a.ts' }, { sessionId: 's' });
    expect(log.permissions.map((p) => p.toolName)).toEqual(['Bash', 'Edit']);
  });
});

describe('Copilot session actions', () => {
  it("gives the session Seshboard's own MCP servers, whose tools never ask", async () => {
    const sdk = fakeSdk();
    const driver = copilotDriver({ binary, env, createClient: sdk.createClient });
    const visualize = { command: '/Apps/Seshboard', args: ['/Apps/visualize.js'], env: { ELECTRON_RUN_AS_NODE: '1' } };
    const session = await driver.start({ cwd: '/w', model: null, permissionMode: 'default', mcpServers: { visualize } }, recorder().events);
    expect(sdk.options()).toMatchObject({ mcpServers: { visualize: { type: 'local', ...visualize, tools: ['*'] } } });
    await expect(sdk.options().onPermissionRequest({ kind: 'mcp', serverName: 'visualize', toolName: 'show_widget' }, { sessionId: session.sessionId })).resolves.toEqual({ kind: 'approve-once' });
    // Another server's tool still asks.
    const other = sdk.options().onPermissionRequest({ requestId: 'm1', kind: 'mcp', serverName: 'github', toolName: 'create_issue' }, { sessionId: session.sessionId });
    expect(await Promise.race([other.then(() => 'answered'), new Promise((resolve) => setTimeout(() => resolve('waiting'), 20))])).toBe('waiting');
  });

  it('starts with file-change tracking and the effort, and sets effort on the model it runs', async () => {
    const sdk = fakeSdk();
    const driver = copilotDriver({ binary, env, createClient: sdk.createClient });
    // The levels Seshboard knows, of the ones the model says.
    expect(await driver.models()).toEqual([{ value: 'gpt-5-mini', displayName: 'GPT-5 mini', description: '', supportsEffort: true, efforts: ['low', 'medium', 'high'] }]);
    const session = await driver.start({ cwd: '/w', model: 'gpt-5-mini', effort: 'high', permissionMode: 'default' }, recorder().events);
    expect(sdk.options()).toMatchObject({ model: 'gpt-5-mini', reasoningEffort: 'high', enableFileChangeTracking: true });
    await session.setEffort!('low');
    // Back to the default: the model's own level, which Copilot doesn't go back to by itself.
    await session.setEffort!(null);
    expect(sdk.calls.filter((c) => c.startsWith('model:'))).toEqual(['model:gpt-5-mini:low', 'model:gpt-5-mini:medium']);
  });

  it('applies effort to the model Auto picked, and refuses it before one is picked', async () => {
    const sdk = fakeSdk();
    const session = await copilotDriver({ binary, env, createClient: sdk.createClient }).start({ cwd: '/w', model: null, effort: 'high', permissionMode: 'default' }, recorder().events);
    // No effort without a model: Copilot's Auto has none.
    expect(sdk.options().reasoningEffort).toBeUndefined();
    await expect(session.setEffort!('high')).rejects.toThrow(/Auto model has no effort/);
    sdk.emit({ type: 'session.model_change', data: { newModel: 'gpt-5-mini' } });
    await session.setEffort!('high');
    expect(sdk.calls).toContain('model:gpt-5-mini:high');
  });

  it('renames a running session, and one that is not running by resuming it just for that', async () => {
    const sdk = fakeSdk();
    const driver = copilotDriver({ binary, env, createClient: sdk.createClient });
    const session = await driver.start({ cwd: '/w', model: null, permissionMode: 'default' }, recorder().events);
    await session.rename!('  Fix the parser  ');
    await driver.renameSession('abc', '/work/other', 'x'.repeat(120));
    expect(sdk.calls).toEqual(expect.arrayContaining(['name:Fix the parser', 'resume:abc', `name:${'x'.repeat(100)}`]));
    // Let go again once renamed.
    expect(sdk.calls.at(-1)).toBe('disconnect');
    expect(sdk.options()).toMatchObject({ workingDirectory: '/work/other', clientName: SESHBOARD_CLIENT });
  });

  it('rewinds to one of your messages with its files, and says why when it cannot', async () => {
    const sdk = fakeSdk();
    const session = await copilotDriver({ binary, env, createClient: sdk.createClient }).start({ cwd: '/w', model: null, permissionMode: 'default' }, recorder().events);
    expect(await session.rewind!('u1', true)).toEqual({ canRewind: true, error: null, files: ['/work/demo/a.ts'], insertions: 2, deletions: 5 });
    expect(await session.rewind!('u1', false)).toEqual({ canRewind: true, error: null, files: ['/work/demo/a.ts'], insertions: 0, deletions: 0 });
    expect(sdk.calls).toEqual(expect.arrayContaining(['preview:u1', 'rewind:u1:conversation-and-files']));
    // Not one of Copilot's rewind points (a steering message).
    expect(await session.rewind!('a1', true)).toMatchObject({ canRewind: false, error: "Copilot can't rewind to this message." });
    sdk.rewind.outcome = { outcome: 'files-rolled-back', restoredFiles: [], error: 'EACCES' };
    expect(await session.rewind!('u1', false)).toMatchObject({ canRewind: false, error: "Couldn't restore the files, so nothing changed." });
    sdk.rewind.points = { fileChangeTrackingEnabled: false, unavailableReason: 'file-change-tracking-disabled', points: [] };
    expect(await session.rewind!('u1', true)).toMatchObject({ canRewind: false, error: expect.stringMatching(/didn't keep this session's file changes/) });
  });

  it('reports background tasks when Copilot says they changed, and stops one', async () => {
    const sdk = fakeSdk();
    const { log, events } = recorder();
    const session = await copilotDriver({ binary, env, createClient: sdk.createClient }).start({ cwd: '/w', model: null, permissionMode: 'default' }, events);
    sdk.tasks.list = [
      { type: 'shell', id: 's1', description: '', command: 'npm run dev', status: 'running', startedAt: '2026-10-30T10:00:00.000Z', attachmentMode: 'detached' },
      // One the turn waits for, and one that finished: not background work.
      { type: 'shell', id: 's2', description: 'npm test', status: 'running', startedAt: '2026-10-30T10:00:00.000Z', attachmentMode: 'attached' },
      { type: 'agent', id: 'g1', description: 'Review', status: 'completed', startedAt: '2026-10-30T10:00:00.000Z', executionMode: 'background' },
      { type: 'agent', id: 'g2', description: 'Explore the repo', status: 'running', startedAt: '2026-10-30T10:01:00.000Z', executionMode: 'background' },
    ];
    sdk.emit({ type: 'session.background_tasks_changed', data: {} });
    await vi.waitFor(() =>
      expect(log.tasks.at(-1)).toEqual([
        { taskId: 's1', type: 'local_bash', description: 'npm run dev', startedAt: Date.parse('2026-10-30T10:00:00.000Z') },
        { taskId: 'g2', type: 'local_agent', description: 'Explore the repo', startedAt: Date.parse('2026-10-30T10:01:00.000Z') },
      ]),
    );
    sdk.tasks.list = [];
    await session.stopTask!('s1');
    expect(sdk.calls).toContain('cancel:s1');
    await vi.waitFor(() => expect(log.tasks.at(-1)).toEqual([]));
  });

  it('asks a throwaway fork, with tools that only read, streams its answer and deletes the fork', async () => {
    const sdk = fakeSdk();
    const driver = copilotDriver({ binary, env, createClient: sdk.createClient });
    const texts: unknown[] = [];
    const forks: string[] = [];
    const asked = driver.ask({ sessionId: 'abc', cwd: '/w', model: 'gpt-5-mini', prompt: 'What changed?', onText: (t) => texts.push(t), onFork: (id) => forks.push(id) });
    await vi.waitFor(() => expect(sdk.calls).toContain('send:What changed?:0'));
    expect(sdk.calls.slice(0, 3)).toEqual(['start', 'fork:abc:-', 'resume:f0']);
    expect(forks).toEqual(['f0']);
    expect(sdk.options()).toMatchObject({ workingDirectory: '/w', model: 'gpt-5-mini' });
    await expect(sdk.options().onPermissionRequest({ kind: 'read', path: '/w/a.ts' }, { sessionId: 'f0' })).resolves.toEqual({ kind: 'approve-once' });
    await expect(sdk.options().onPermissionRequest({ kind: 'write', fileName: '/w/a.ts', diff: '+x' }, { sessionId: 'f0' })).resolves.toMatchObject({ kind: expect.stringMatching(/reject|denied/) });
    sdk.emit({ type: 'assistant.turn_start', data: {} });
    sdk.emit({ type: 'assistant.message_delta', data: { deltaContent: 'Two files.' } });
    sdk.emit({ type: 'assistant.message', id: 'a1', data: { content: 'Two files changed.' } });
    sdk.emit({ type: 'assistant.usage', data: { model: 'gpt-5-mini', cost: 0.33 } });
    sdk.emit({ type: 'session.idle', data: {} });
    expect(await asked).toEqual({ answer: 'Two files changed.', spent: 0.33 });
    expect(texts).toEqual([{ delta: 'Two files.' }]);
    // Let go, and gone: the fork was only for this question.
    expect(sdk.calls.slice(-2)).toEqual(['disconnect', 'delete:f0']);
  });

  it('asks the cheapest model with no tools and no context, and leaves nothing behind', async () => {
    const sdk = fakeSdk();
    sdk.priced.models = [
      { id: 'big', name: 'Big', policy: { state: 'enabled' }, billing: { tokenPrices: { inputPrice: 200, outputPrice: 1000 } } },
      { id: 'small', name: 'Small', policy: { state: 'enabled' }, billing: { tokenPrices: { inputPrice: 10, outputPrice: 50 } }, supportedReasoningEfforts: ['low', 'high'] },
    ];
    const driver = copilotDriver({ binary, env, createClient: sdk.createClient });
    expect(await driver.cheapModel()).toEqual({ id: 'small', name: 'Small' });
    const named: string[] = [];
    const asked = driver.askCheap({ system: 'Pick.', prompt: 'The reply', onSession: (id) => named.push(id) });
    await vi.waitFor(() => expect(sdk.calls).toContain('send:The reply:0'));
    expect(sdk.options()).toMatchObject({ model: 'small', reasoningEffort: 'low', availableTools: [], enableConfigDiscovery: false, enableFileHooks: false, systemMessage: { mode: 'replace', content: 'Pick.' } });
    expect(sdk.options().sessionId).toBe(named[0]);
    sdk.emit({ type: 'assistant.usage', data: { inputTokens: 400, outputTokens: 20, cacheReadTokens: 3, cost: 1 } });
    sdk.emit({ type: 'assistant.message', id: 'a1', data: { content: '{"keep":[1]}' } });
    sdk.emit({ type: 'session.idle', data: {} });
    expect(await asked).toEqual({ answer: '{"keep":[1]}', model: 'small', tokens: { input: 400, output: 20, cacheRead: 3, cacheWrite: 0 } });
    expect(sdk.calls.slice(-2)).toEqual(['disconnect', `delete:${named[0]}`]);
  });

  it('makes no call when no model is cheap enough', async () => {
    const sdk = fakeSdk();
    sdk.priced.models = [{ id: 'big', name: 'Big', billing: { multiplier: 1 } }];
    const driver = copilotDriver({ binary, env, createClient: sdk.createClient });
    expect(await driver.cheapModel()).toBeNull();
    const named: string[] = [];
    expect(await driver.askCheap({ system: 'Pick.', prompt: 'The reply', onSession: (id) => named.push(id) })).toMatchObject({ answer: null, model: null });
    expect(named).toEqual([]);
    expect(sdk.calls.some((call) => call.startsWith('create:'))).toBe(false);
  });

  it('reads events and open sessions through the runtime only once it runs, and forks', async () => {
    const sdk = fakeSdk();
    const driver = copilotDriver({ binary, env, createClient: sdk.createClient });
    // Not started just to read: the caller reads the file instead.
    expect(await driver.readEvents('abc')).toBeNull();
    expect(await driver.inUse(['abc'])).toBeNull();
    // Forking starts it.
    expect(await driver.fork('abc', 'u2')).toBe('f0');
    await driver.fork('abc', null);
    expect(sdk.calls).toEqual(expect.arrayContaining(['fork:abc:u2', 'fork:abc:-']));

    sdk.pages.push({ events: [{ type: 'user.message', id: 'u1' }], cursor: 'c1', hasMore: true, cursorStatus: 'ok' }, { events: [{ type: 'assistant.message', id: 'a1' }], cursor: 'c2', hasMore: false, cursorStatus: 'ok' });
    expect((await driver.readEvents('abc'))?.map((e) => e.id)).toEqual(['u1', 'a1']);
    expect(sdk.reads).toEqual([undefined, 'c1']);
    // A read that couldn't finish is an error, not half a session.
    sdk.pages.push({ events: [], cursor: 'c3', hasMore: false, cursorStatus: 'expired' });
    await expect(driver.readEvents('abc')).rejects.toThrow(/expired/);
    expect(await driver.inUse(['abc', 'busy-1'])).toEqual(new Set(['busy-1']));
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

describe('npm\'s Copilot on Windows', () => {
  const PATH = 'C:\\Program Files\\nodejs;C:\\Users\\me\\AppData\\Roaming\\npm';
  const npm = 'C:\\Users\\me\\AppData\\Roaming\\npm';
  const files = (present: string[]) => ({
    exists: (path: string) => present.includes(path),
    readJson: (path: string) => (path === `${npm}\\node_modules\\@github\\copilot\\package.json` ? { bin: { copilot: 'npm-loader.js' } } : null),
  });
  const all = ['C:\\Program Files\\nodejs\\node.exe', `${npm}\\copilot.cmd`, `${npm}\\node_modules\\@github\\copilot\\npm-loader.js`];

  it('runs the package\'s script with the user\'s own node, as its copilot.cmd would', () => {
    expect(npmCopilot({ PATH }, 'win32', files(all))).toEqual({ path: 'C:\\Program Files\\nodejs\\node.exe', args: [`${npm}\\node_modules\\@github\\copilot\\npm-loader.js`] });
  });

  it('starts the SDK on node with the script first', async () => {
    const sdk = fakeSdk();
    const driver = copilotDriver({ binary: async () => ({ path: 'C:\\node.exe', args: ['C:\\npm\\loader.js'], version: '1.0.90' }), env, createClient: sdk.createClient });
    await driver.status();
    expect(sdk.created).toEqual([{ cliPath: 'C:\\node.exe', cliArgs: ['C:\\npm\\loader.js'], env: { PATH: '/usr/bin' } }]);
  });

  it('needs node, the .cmd and the script, and only on Windows', () => {
    expect(npmCopilot({ PATH }, 'win32', files(all.slice(1)))).toBeNull();
    expect(npmCopilot({ PATH }, 'win32', files([all[0]!, all[2]!]))).toBeNull();
    expect(npmCopilot({ PATH }, 'win32', files(all.slice(0, 2)))).toBeNull();
    expect(npmCopilot({ PATH: '/usr/bin' }, 'linux', files(all))).toBeNull();
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
