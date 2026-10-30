import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { createRpcClient, messagePortTransport, type Contract, type DomLikePort, type LogEntry, type AskEvent, type TranscriptUpdate } from '@seshboard/protocol';
import type { SessionSource } from './claude/sessionSource.ts';
import { createEngine, type EngineOptions } from './engine.ts';
import type { CopilotSdkClient, CopilotSdkSession, CopilotSessionOptions } from './providers/copilot/copilotDriver.ts';
import type { CopilotEvent } from './providers/copilot/copilotEvents.ts';
import type { SdkRuntime } from './host/hostManager.ts';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { git } from './git/gitChanges.ts';
import { userShell } from './system/shell.ts';
import { shellName } from './terminals/outputMessage.ts';

const SESSION_ID = '33333333-3333-4333-8333-333333333333';
/** The shell the engine's terminals run for the environment the tests give it: zsh here, PowerShell on Windows. */
const shell = userShell({ PATH: '', SHELL: '/bin/zsh' });
// Session folders in this platform's form, as the engine only takes absolute local paths.
const PARSER = resolve('/work/parser');
const OTHER = resolve('/work/other');
const BLOG = resolve('/work/blog');
const fakeSource: SessionSource = {
  list: async () => [{ sessionId: SESSION_ID, summary: 'Refactor parser', lastModified: 42, cwd: PARSER }],
  info: async () => undefined,
  messages: async () => [
    { type: 'user', uuid: 'u1', parent_tool_use_id: null, message: { content: 'Refactor the parser' } },
    { type: 'assistant', uuid: 'a1', parent_tool_use_id: null, message: { model: 'm', content: [{ type: 'text', text: 'Done.' }] } },
  ],
};

/** A Claude Code stand-in that only records how sessions were started; they never answer. */
function fakeSdk(created: Array<{ cwd?: string; model?: string; permissionMode?: string; worktree?: string | null }>): SdkRuntime {
  const quiet = () => ({
    async *[Symbol.asyncIterator]() {
      await new Promise(() => {});
    },
    interrupt: async () => {},
    close: () => {},
    setPermissionMode: async () => {},
    setModel: async () => {},
    supportedCommands: async () => [],
    supportedModels: async () => [],
  });
  /** A question about a session: one streamed answer from the fork, with its tokens. */
  const answer = (prompt: AsyncIterable<SDKUserMessage>) => ({
    async *[Symbol.asyncIterator]() {
      for await (const message of prompt) {
        const text = (message.message.content as Array<{ text?: string }>)[0]?.text ?? '';
        const reply = `It was --cleanStart (${text.split('\n').at(-1)})`;
        yield { type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: reply } } };
        yield { type: 'assistant', parent_tool_use_id: null, message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 2, output_tokens: 9, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 }, content: [{ type: 'text', text: reply }] } };
        yield { type: 'result', subtype: 'success', is_error: false, result: reply };
      }
    },
    close: () => {},
  });
  return {
    query: ({ prompt, options }) => {
      created.push({ cwd: options.cwd, model: options.model, permissionMode: options.permissionMode, worktree: options.extraArgs?.worktree });
      return (options.forkSession && options.persistSession === false ? answer(prompt) : quiet()) as never;
    },
    startup: async ({ options }) => ({ query: () => (created.push({ cwd: options.cwd, model: options.model, permissionMode: options.permissionMode }), quiet()), close: () => {} }) as never,
  };
}

// Node's MessagePort is a DOM-style EventTarget at runtime; its typings just use a generic Event.
const asDomPort = (port: MessagePort) => port as unknown as DomLikePort;

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

function connect(extra: { trashed?: string[][]; noTrash?: boolean; source?: SessionSource | ((dataDir: string) => SessionSource); sdk?: SdkRuntime; path?: string; onKeepAwake?: (on: boolean) => void; copilot?: EngineOptions['copilot'] } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'seshboard-engine-'));
  // A real transcript file, so the index knows where the session lives.
  const projectDir = join(dataDir, 'claude', 'projects', '-work-parser');
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, `${SESSION_ID}.jsonl`), '{"entrypoint":"cli"}\n');
  mkdirSync(join(projectDir, SESSION_ID, 'subagents'), { recursive: true });
  const engine = createEngine({
    ...(extra.noTrash ? {} : { trash: async (paths: string[]) => void extra.trashed?.push(paths) }),
    dataDir,
    claudeConfigDir: join(dataDir, 'claude'),
    // No login shell and an empty PATH, so the test never depends on the machine (a test that runs git with it passes its own).
    shellEnv: Promise.resolve({ shell: '/bin/zsh', env: { PATH: extra.path ?? '' }, resolved: false, durationMs: 0 }),
    claudeBinary: '/nonexistent/claude',
    // Never the machine's own ~/.copilot.
    providerFolders: { copilot: join(dataDir, 'copilot', 'session-state') },
    sessionSource: (typeof extra.source === 'function' ? extra.source(dataDir) : extra.source) ?? fakeSource,
    ...(extra.sdk ? { sdk: async () => extra.sdk! } : {}),
    ...(extra.onKeepAwake ? { onKeepAwake: extra.onKeepAwake } : {}),
    // Never the machine's own `copilot`: without a fake, Copilot CLI isn't installed.
    copilot: extra.copilot ?? { binary: async () => null },
  });
  const { port1, port2 } = new MessageChannel();
  const detach = engine.attach(messagePortTransport(asDomPort(port1)));
  const client = createRpcClient<Contract>(messagePortTransport(asDomPort(port2)));
  cleanups.push(() => {
    client.dispose();
    detach();
    engine.close();
    port1.close();
    port2.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return { engine, client, dataDir, projectDir };
}

describe('engine over a MessagePort', () => {
  it('answers ping', async () => {
    const { client } = connect();
    const sentAt = Date.now();
    const pong = await client.call('system.ping', { sentAt });
    expect(pong.sentAt).toBe(sentAt);
    expect(pong.engineTime).toBeGreaterThanOrEqual(sentAt);
  });

  it('reports system info', async () => {
    const { client, dataDir } = connect();
    const info = await client.call('system.info', {});
    expect(info.paths.database).toBe(join(dataDir, 'cache.sqlite'));
    expect(info.paths.home).toBe(homedir());
    expect(info.versions.sqlite).toMatch(/^\d+\.\d+/);
    expect(info.shell.resolved).toBe(false);
    expect(info.claude).toBeNull();
  });

  it('shows an allowed provider\'s sessions read-only', async () => {
    const { client, dataDir } = connect();
    const id = '44444444-4444-4444-8444-444444444444';
    const folder = join(dataDir, 'copilot', 'session-state', id);
    mkdirSync(folder, { recursive: true });
    const events = [
      { type: 'session.start', id: 'e1', timestamp: '2026-10-30T10:00:00.000Z', data: { context: { cwd: PARSER } } },
      { type: 'user.message', id: 'e2', timestamp: '2026-10-30T10:00:01.000Z', data: { content: 'Fix the parser' } },
      { type: 'assistant.message', id: 'e3', timestamp: '2026-10-30T10:00:02.000Z', data: { content: 'Done.' } },
    ];
    writeFileSync(join(folder, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');

    const before = await client.call('providers.list', {});
    expect(before.providers).toEqual([expect.objectContaining({ id: 'copilot', allowed: false, found: true })]);
    await client.call('sessions.refresh', {});
    expect((await client.call('sessions.list', {})).sessions.some((s) => s.id === id)).toBe(false);

    const after = await client.call('providers.setAllowed', { id: 'copilot', allowed: true });
    expect(after.providers[0]!.allowed).toBe(true);
    await client.call('sessions.refresh', {});
    const listed = (await client.call('sessions.list', {})).sessions.find((s) => s.id === id);
    expect(listed).toMatchObject({ provider: 'copilot', title: 'Fix the parser', cwd: PARSER });

    // Copilot can run sessions, but isn't installed here: sending says so.
    await expect(client.call('session.send', { sessionId: id, text: 'hi', attachments: [], fork: false })).rejects.toMatchObject({ code: 'PROVIDER_FAILED', message: expect.stringMatching(/Install GitHub Copilot CLI/) });
    await expect(client.call('session.forkAt', { sessionId: id, messageUuid: 'e3' })).rejects.toMatchObject({ code: 'READ_ONLY_SESSION' });
    await expect(client.call('session.delete', { sessionId: id })).rejects.toMatchObject({ code: 'READ_ONLY_SESSION' });
    expect(existsSync(join(folder, 'events.jsonl'))).toBe(true);
  });

  it('starts and steers a Copilot session through its driver, with Copilot\'s own login', async () => {
    const COPILOT_ID = '55555555-5555-4555-8555-555555555555';
    const calls: string[] = [];
    let emit: (event: CopilotEvent) => void = () => {};
    let options: CopilotSessionOptions | undefined;
    const session: CopilotSdkSession = {
      sessionId: COPILOT_ID,
      on: (handler) => ((emit = handler), () => {}),
      send: async ({ prompt }) => (calls.push(`send:${prompt}`), 'm1'),
      abort: async () => void calls.push('abort'),
      setModel: async (model) => void calls.push(`model:${model}`),
      disconnect: async () => void calls.push('disconnect'),
      rpc: { mode: { set: async ({ mode }) => void calls.push(`mode:${mode}`) }, commands: { list: async () => ({ commands: [] }), invoke: async () => ({ kind: 'completed' }) }, mcp: { list: async () => ({ servers: [] }), enable: async () => {}, disable: async () => {}, restartServer: async () => {} }, skills: { list: async () => ({ skills: [] }) }, agent: { list: async () => ({ agents: [] }) } },
    };
    const client: CopilotSdkClient = {
      start: async () => {},
      stop: async () => {},
      getAuthStatus: async () => ({ isAuthenticated: true, statusMessage: 'octocat (via gh)' }),
      listModels: async () => [{ id: 'gpt-5-mini', name: 'GPT-5 mini' }],
      createSession: async (o) => ((options = o), session),
      resumeSession: async (_id, o) => ((options = o), session),
    };
    const { client: rpc, dataDir } = connect({ copilot: { createClient: async () => client, binary: async () => ({ path: '/fake/copilot', version: '1.0.90' }) } });
    const hostStates: string[] = [];
    rpc.on('session.host', (info) => info.sessionId === COPILOT_ID && hostStates.push(info.state));

    await expect(rpc.call('session.create', { cwd: dataDir, prompt: 'Hi', provider: 'copilot' })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect((await rpc.call('providers.setAllowed', { id: 'copilot', allowed: true })).providers[0]!.canStart).toBe(true);
    expect(await rpc.call('providers.status', { id: 'copilot' })).toEqual({ binary: '/fake/copilot', version: '1.0.90', signedIn: true, account: 'octocat (via gh)', problem: null });
    expect((await rpc.call('providers.models', { id: 'copilot' })).models.map((m) => m.value)).toEqual(['gpt-5-mini']);

    const { sessionId } = await rpc.call('session.create', { cwd: dataDir, prompt: 'Add a test', provider: 'copilot', model: 'gpt-5-mini' });
    expect(sessionId).toBe(COPILOT_ID);
    expect(options).toMatchObject({ workingDirectory: dataDir, model: 'gpt-5-mini', clientName: 'seshboard' });
    expect(calls).toEqual(['send:Add a test']);

    emit({ type: 'assistant.turn_start', data: {} });
    const answer = options!.onPermissionRequest({ requestId: 'p1', kind: 'shell', fullCommandText: 'npm test' }, { sessionId: COPILOT_ID });
    const listed = await rpc.call('hosts.list', {});
    expect(listed.hosts.find((h) => h.sessionId === COPILOT_ID)?.state).toBe('needs-you');
    expect(listed.permissions).toEqual([expect.objectContaining({ requestId: 'p1', sessionId: COPILOT_ID, toolName: 'Bash' })]);
    await rpc.call('session.respond', { requestId: 'p1', decision: { behavior: 'allow' } });
    await expect(answer).resolves.toEqual({ kind: 'approve-once' });
    emit({ type: 'assistant.message', id: 'a1', data: { content: 'Done.' } });
    emit({ type: 'session.idle', data: {} });
    expect((await rpc.call('hosts.list', {})).hosts.find((h) => h.sessionId === COPILOT_ID)?.state).toBe('idle');

    await rpc.call('session.send', { sessionId: COPILOT_ID, text: 'And another', attachments: [], fork: false });
    await rpc.call('session.interrupt', { sessionId: COPILOT_ID });
    await rpc.call('session.setModel', { sessionId: COPILOT_ID, model: null });
    expect(calls).toEqual(['send:Add a test', 'send:And another', 'abort', 'model:auto']);
    // Claude Code's own features still refuse it.
    await expect(rpc.call('session.forkAt', { sessionId: COPILOT_ID, messageUuid: 'a1' })).rejects.toMatchObject({ code: 'READ_ONLY_SESSION' });
    expect(hostStates).toEqual(expect.arrayContaining(['running', 'needs-you', 'idle']));
  });

  it('persists app state', async () => {
    const { client } = connect();
    await client.call('appState.set', { key: 'ui.sidebarWidth', value: 280 });
    await expect(client.call('appState.get', { key: 'ui.sidebarWidth' })).resolves.toEqual({ value: 280 });
  });

  it('keeps the queue in order and tells every window when it changes', async () => {
    const { client } = connect();
    const changes: number[] = [];
    client.on('later.changed', ({ items }) => void changes.push(items.length));
    const { item } = await client.call('later.add', { draft: { cwd: PARSER, prompt: 'Speed up the tokenizer', model: 'opus' } });
    const { item: other } = await client.call('later.add', { draft: { cwd: OTHER, prompt: 'Something else' } });
    expect(item).toMatchObject({ position: 0, waitFor: { kind: 'project' } });
    expect(other.position).toBe(1);
    expect((await client.call('later.list', { cwd: PARSER })).items).toEqual([item]);
    expect((await client.call('later.list', {})).items).toHaveLength(2);
    await client.call('later.remove', { id: item.id });
    expect((await client.call('later.list', { cwd: PARSER })).items).toEqual([]);
    // Undo: back in its place, as it was.
    const { id, createdAt, position, waitFor, ...draft } = item;
    await client.call('later.add', { draft, id, createdAt, index: position, waitFor });
    expect((await client.call('later.list', {})).items.map((i) => i.id)).toEqual([item.id, other.id]);
    await client.call('later.reorder', { id: item.id, toIndex: 5 });
    expect((await client.call('later.list', {})).items.map((i) => i.id)).toEqual([other.id, item.id]);
    const { item: updated } = await client.call('later.update', { id: other.id, waitFor: { kind: 'none' } });
    expect(updated.waitFor).toEqual({ kind: 'none' });
    await expect(client.call('later.update', { id: 'gone', waitFor: { kind: 'none' } })).rejects.toThrow(/no longer in the queue/);
    await expect(client.call('later.reorder', { id: 'gone', toIndex: 0 })).rejects.toThrow(/no longer in the queue/);
    await expect(client.call('later.add', { draft: { cwd: PARSER, prompt: '' } })).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(changes).toEqual([1, 2, 1, 2, 2, 2]);
  });

  it('routes a queued prompt on Auto when it starts, keeps the pick, and counts the routing call in Usage', async () => {
    const created: Array<{ cwd?: string; model?: string; permissionMode?: string }> = [];
    const routed: unknown[] = [];
    const sessions = fakeSdk(created);
    // The routing call answers; the session itself never does.
    const sdk: SdkRuntime = {
      ...sessions,
      query: (args) => {
        if (args.options.model !== 'haiku' || !Array.isArray(args.options.tools)) return sessions.query(args);
        return {
          async *[Symbol.asyncIterator]() {
            for await (const message of args.prompt) routed.push(message.message.content);
            yield {
              type: 'result',
              subtype: 'success',
              is_error: false,
              result: '{"model":"sonnet","reason":"A small, local change."}',
              modelUsage: { 'claude-haiku-4-5': { inputTokens: 1_000, outputTokens: 40, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } },
            };
          },
          close: () => {},
        } as never;
      },
    };
    const { client, dataDir } = connect({ sdk });
    const { item } = await client.call('later.add', { draft: { cwd: dataDir, prompt: 'Make the update check a setting', model: 'auto' } });
    const { sessionId } = await client.call('later.start', { id: item.id });
    // The session opens before Auto has picked, then switches to what it picked.
    expect(created).toEqual([expect.objectContaining({ cwd: dataDir })]);
    expect(created[0]!.model).toBeUndefined();
    for (let tries = 0; !(await client.call('hosts.list', {})).hosts.some((h) => h.sessionId === sessionId && h.model === 'sonnet'); tries++) {
      if (tries > 100) throw new Error('Auto never switched the session to its pick');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    // Only the text went to Haiku.
    expect(routed).toEqual(['<request>\nMake the update check a setting\n</request>']);
    const { autoPick } = await client.call('session.autoPick', { sessionId });
    expect(autoPick).toMatchObject({ model: 'sonnet', reason: 'A small, local change.', tokens: 1_040, allowed: ['haiku', 'sonnet', 'opus'] });
    const usage = await client.call('usage.breakdown', { period: 'day', groupBy: 'model' });
    expect(usage.rows).toContainEqual(expect.objectContaining({ key: 'auto-routing', label: 'Auto routing', model: 'claude-haiku-4-5', autoRouting: { picks: 1 } }));
    expect(usage.totals.tokens.input).toBe(1_000);
  });

  it('keeps the computer awake while a flagged session works, and lets go when it stops', async () => {
    const awake: boolean[] = [];
    const { client, dataDir } = connect({ sdk: fakeSdk([]), onKeepAwake: (on) => awake.push(on) });
    await expect(client.call('session.keepAwake', { sessionId: SESSION_ID, on: true })).rejects.toThrow("isn't running here");
    const { item } = await client.call('later.add', { draft: { cwd: dataDir, prompt: 'Run the full test suite' } });
    const { sessionId } = await client.call('later.start', { id: item.id });
    await client.call('session.keepAwake', { sessionId, on: true });
    expect(awake).toEqual([true]);
    expect((await client.call('hosts.list', {})).hosts.find((h) => h.sessionId === sessionId)?.keepAwake).toBe(true);
    // Stopping the session ends its process: the flag goes with it.
    await client.call('session.close', { sessionId });
    for (let tries = 0; awake.length < 2; tries++) {
      if (tries > 100) throw new Error('Keep awake never let go');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(awake).toEqual([true, false]);
    expect((await client.call('hosts.list', {})).hosts.find((h) => h.sessionId === sessionId)?.keepAwake).toBeUndefined();
  });

  it('saves, lists, runs now, pauses, deletes and restores schedules, and tells every window', async () => {
    const created: Array<{ cwd?: string; model?: string; permissionMode?: string }> = [];
    const { client, dataDir } = connect({ sdk: fakeSdk(created) });
    const changes: number[] = [];
    const ran: string[] = [];
    client.on('schedules.changed', ({ schedules }) => changes.push(schedules.length));
    client.on('schedules.ran', ({ runs }) => ran.push(...runs.map((r) => `${r.result}:${r.title}`)));
    const draft = { cwd: dataDir, prompt: 'Review the open pull requests', model: 'opus', permissionMode: 'acceptEdits' as const };
    const { schedule } = await client.call('schedules.save', { schedule: { name: 'Review open pull requests', draft, rule: { kind: 'weekdays', time: '08:00' }, missed: 'run', paused: false } });
    expect(schedule).toMatchObject({ name: 'Review open pull requests', rule: { kind: 'weekdays', time: '08:00' }, paused: false, lastRun: null });
    await expect(client.call('schedules.save', { schedule: { name: 'No days', draft, rule: { kind: 'weekly', days: [], time: '08:00' }, missed: 'run', paused: false } })).rejects.toThrow();

    // Run now: one new session from the draft, as New session starts one.
    const { run } = await client.call('schedules.runNow', { id: schedule.id });
    expect(run).toMatchObject({ result: 'started', missed: false });
    expect(run.title).toMatch(/^Review open pull requests · \w{3} \d{1,2} \w{3}$/);
    expect(created).toEqual([expect.objectContaining({ cwd: dataDir, model: 'opus', permissionMode: 'acceptEdits' })]);
    const listed = await client.call('schedules.list', {});
    expect(listed.schedules[0]!.lastRun).toMatchObject({ result: 'started', sessionId: run.sessionId });
    expect(listed.sessions).toEqual([{ sessionId: run.sessionId, scheduleId: schedule.id }]);

    // While that session works, another run is skipped.
    const again = await client.call('schedules.runNow', { id: schedule.id });
    expect(again.run).toMatchObject({ result: 'skipped', reason: 'the last run was still working' });
    expect(created).toHaveLength(1);

    const { schedule: paused } = await client.call('schedules.setPaused', { id: schedule.id, paused: true });
    expect(paused.paused).toBe(true);
    const before = (await client.call('schedules.list', {})).schedules[0]!;
    await client.call('schedules.delete', { id: schedule.id });
    expect((await client.call('schedules.list', {})).schedules).toEqual([]);
    await client.call('schedules.restore', { schedule: before });
    expect((await client.call('schedules.list', {})).schedules).toEqual([before]);
    await expect(client.call('schedules.setPaused', { id: 'gone', paused: true })).rejects.toThrow(/deleted/);
    for (let tries = 0; ran.length < 2 || changes.length < 6; tries++) {
      if (tries > 100) throw new Error(`windows heard ${changes.length} changes and ${ran.length} runs`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(ran).toEqual([`started:${run.title}`, 'skipped:null']);
  });

  it('pauses the schedules of a project removed from Seshboard, and a run whose folder is gone', async () => {
    const { client, dataDir } = connect({ sdk: fakeSdk([]) });
    const folder = join(dataDir, 'web');
    mkdirSync(folder);
    await client.call('projects.add', { path: folder });
    const save = (cwd: string) => client.call('schedules.save', { schedule: { name: 'Standup summary', draft: { cwd, prompt: 'Write the standup summary' }, rule: { kind: 'daily', time: '09:00' }, missed: 'run', paused: false } });
    const { schedule } = await save(folder);
    await client.call('projects.remove', { root: folder });
    expect((await client.call('schedules.list', {})).schedules[0]).toMatchObject({ id: schedule.id, paused: true, pausedReason: 'Project removed' });

    const { schedule: gone } = await save(join(dataDir, 'missing'));
    const { run } = await client.call('schedules.runNow', { id: gone.id });
    expect(run).toMatchObject({ result: 'failed', reason: 'Folder not found' });
    expect((await client.call('schedules.list', {})).schedules.find((s) => s.id === gone.id)).toMatchObject({ paused: true, pausedReason: 'Folder not found' });
  });

  it('starts a queued item the way New session does, and takes it off the queue', async () => {
    const created: Array<{ cwd?: string; model?: string; permissionMode?: string }> = [];
    const { client, dataDir } = connect({ sdk: fakeSdk(created) });
    const { item } = await client.call('later.add', { draft: { cwd: dataDir, prompt: 'Add a yearly overview', model: 'opus', permissionMode: 'acceptEdits' } });
    const { item: next } = await client.call('later.add', { draft: { cwd: dataDir, prompt: 'Then the totals' }, waitFor: { kind: 'item', itemId: item.id } });
    const { sessionId } = await client.call('later.start', { id: item.id });
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(created).toEqual([expect.objectContaining({ cwd: dataDir, model: 'opus', permissionMode: 'acceptEdits' })]);
    const after = await client.call('later.list', {});
    expect(after.items.map((i) => i.id)).toEqual([next.id]);
    expect(after.items[0]!.position).toBe(0);
    // The item that waited on it now follows its session.
    expect(after.started).toEqual([{ itemId: item.id, sessionId }]);
    await expect(client.call('later.start', { id: item.id })).rejects.toThrow(/no longer in the queue/);
    // Started from New session after an edit: the item that waited on it follows that session too.
    const { item: edited } = await client.call('later.add', { draft: { cwd: dataDir, prompt: 'Edited first' } });
    const { item: follower } = await client.call('later.add', { draft: { cwd: dataDir, prompt: 'After the edit' }, waitFor: { kind: 'item', itemId: edited.id } });
    await client.call('later.remove', { id: edited.id, startedAs: 'session-from-new-session' });
    expect((await client.call('later.list', {})).started).toContainEqual({ itemId: edited.id, sessionId: 'session-from-new-session' });
    await client.call('later.remove', { id: follower.id });
    // A folder that is gone fails like New session, and the item stays queued.
    const { item: missing } = await client.call('later.add', { draft: { cwd: join(dataDir, 'gone'), prompt: 'Nowhere' } });
    await expect(client.call('later.start', { id: missing.id })).rejects.toThrow(/Folder not found/);
    expect((await client.call('later.list', {})).items.map((i) => i.id)).toEqual([next.id, missing.id]);
  });

  it('starts a queued worktree from a saved branch, and lets Claude Code make the others', async () => {
    const created: Array<{ cwd?: string; worktree?: string | null }> = [];
    const { client } = connect({ sdk: fakeSdk(created), path: process.env.PATH ?? '' });
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-base-')));
    cleanups.push(() => rmSync(repo, { recursive: true, force: true }));
    const run = (...args: string[]) => git(repo, args);
    await run('init', '-q', '-b', 'main');
    await run('config', 'user.email', 'test@example.com');
    await run('config', 'user.name', 'Test');
    writeFileSync(join(repo, 'a.txt'), 'one\n');
    await run('add', '.');
    await run('commit', '-qm', 'initial');
    await run('switch', '-qc', 'dev');
    await run('commit', '-q', '--allow-empty', '-m', 'on dev');
    await run('switch', '-q', 'main');

    // A queued item keeps the branch as a ref; starting it makes the worktree from that branch.
    const { item } = await client.call('later.add', { draft: { cwd: repo, prompt: 'hi', workspace: 'worktree', baseRef: 'refs/heads/dev' } });
    await client.call('later.start', { id: item.id });
    const made = created.at(-1)!;
    expect(made.worktree).toBeUndefined();
    expect(made.cwd).toMatch(/[\\/]\.claude[\\/]worktrees[\\/][^\\/]+$/);
    expect((await git(made.cwd!, ['rev-parse', 'HEAD^{commit}'])).trim()).toBe((await run('rev-parse', 'dev')).trim());
    expect((await git(made.cwd!, ['symbolic-ref', '--short', 'HEAD'])).trim()).toMatch(/^worktree-/);

    // Claude Code still makes the worktrees it can.
    const { item: fromHead } = await client.call('later.add', { draft: { cwd: repo, prompt: 'hi', workspace: 'worktree', baseRef: 'head' } });
    await client.call('later.start', { id: fromHead.id });
    expect(created.at(-1)).toMatchObject({ cwd: repo, worktree: expect.any(String) });

    await expect(client.call('later.add', { draft: { cwd: repo, prompt: 'hi', workspace: 'worktree', baseRef: 'dev' as never } })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    expect((await client.call('git.branches', { cwd: repo })).remoteBranches).toEqual([]);
  });

  it('takes a file as neither a project folder nor a session folder', async () => {
    const created: Array<{ cwd?: string }> = [];
    const { client, dataDir } = connect({ sdk: fakeSdk(created) });
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-file-')));
    cleanups.push(() => rmSync(repo, { recursive: true, force: true }));
    await git(repo, ['init', '-q', '-b', 'main']);
    const file = join(repo, 'package.json');
    writeFileSync(file, '{}\n');
    expect(await client.call('projects.inspect', { path: file })).toMatchObject({ path: file, exists: false, isFile: true, isGitRepo: false });
    expect(await client.call('projects.inspect', { path: repo })).toMatchObject({ exists: true, isGitRepo: true });
    expect(await client.call('projects.inspect', { path: repo })).not.toHaveProperty('isFile');
    // A path under a file (ENOTDIR) is just missing.
    expect(await client.call('projects.inspect', { path: join(file, 'src') })).toMatchObject({ exists: false, isGitRepo: false });
    await expect(client.call('session.create', { cwd: file, prompt: 'hi' })).rejects.toMatchObject({ code: 'NOT_A_FOLDER', message: `That is a file, not a folder: ${file}` });
    await expect(client.call('session.create', { cwd: join(file, 'src'), prompt: 'hi' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(client.call('session.create', { cwd: join(dataDir, 'gone'), prompt: 'hi' })).rejects.toThrow(/Folder not found/);
    expect(created).toEqual([]);
  });

  it('pushes log events to attached clients', async () => {
    const { client, engine } = connect();
    const seen: LogEntry[] = [];
    client.on('engine.log', (entry) => seen.push(entry));
    engine.log('info', 'hello');
    await client.call('system.ping', { sentAt: 0 });
    expect(seen.filter((e) => e.level === 'info').map((e) => e.message)).toEqual(['hello']);
  });

  it('lists sessions once the first scan completes', async () => {
    const { client } = connect();
    const changed = new Promise((resolve) => client.on('sessions.changed', resolve));
    await changed;
    const snapshot = await client.call('sessions.list', {});
    expect(snapshot.complete).toBe(true);
    expect(snapshot.sessions).toMatchObject([{ id: SESSION_ID, title: 'Refactor parser', projectRoot: PARSER }]);
    expect(snapshot.live).toEqual([]);
  });

  it('lists your projects and offers folders that only have sessions', async () => {
    const { client, dataDir } = connect();
    await new Promise((resolve) => client.on('sessions.changed', resolve));
    expect((await client.call('projects.list', {})).projects).toMatchObject([{ root: PARSER, added: false, sessionCount: 1, order: null }]);
    await client.call('projects.add', { path: dataDir });
    await client.call('projects.setDefaults', { root: dataDir, defaults: { model: 'haiku', effort: null, permissionMode: 'plan', workspace: null, baseRef: null, branch: null } });
    expect((await client.call('projects.list', {})).projects).toMatchObject([
      { root: dataDir, added: true, order: 0, defaults: { model: 'haiku', permissionMode: 'plan' } },
      { root: PARSER, added: false },
    ]);
    await expect(client.call('projects.setDefaults', { root: PARSER, defaults: {} })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await client.call('projects.remove', { root: dataDir });
    expect((await client.call('projects.list', {})).projects.map((p) => p.root)).toEqual([PARSER]);
  });

  it('streams a watched transcript to the caller', async () => {
    const { client } = connect();
    const update = new Promise<TranscriptUpdate>((resolve) => client.on('transcript.updated', resolve));
    await client.call('transcript.watch', { sessionId: SESSION_ID });
    const first = await update;
    expect(first.mode).toBe('replace');
    expect(first.messages.map((m) => m.blocks[0])).toEqual([
      { type: 'text', text: 'Refactor the parser' },
      { type: 'text', text: 'Done.' },
    ]);
    await client.call('transcript.unwatch', { sessionId: SESSION_ID });
  });

  it('answers a question about the session and keeps it in a thread, with nothing added to the transcript or the session file', async () => {
    const created: Array<{ cwd?: string }> = [];
    const { client, projectDir } = connect({ sdk: fakeSdk(created) });
    await new Promise((resolve) => client.on('sessions.changed', resolve));
    const file = join(projectDir, `${SESSION_ID}.jsonl`);
    const before = readFileSync(file, 'utf8');
    const events: AskEvent[] = [];
    client.on('session.ask', (event) => events.push(event));
    const tokens: string[][] = [];
    client.on('usage.tokens', (event) => tokens.push(event.profileIds));

    const { threadId, id } = await client.call('session.ask', { sessionId: SESSION_ID, question: 'Which flag?' });
    await expect.poll(() => events.some((e) => e.id === id && e.done)).toBe(true);
    expect(events).toEqual([
      { sessionId: SESSION_ID, threadId, id, delta: 'It was --cleanStart (Which flag?)' },
      { sessionId: SESSION_ID, threadId, id, done: true, answer: 'It was --cleanStart (Which flag?)' },
    ]);
    // Answered by a short-lived fork in the session's folder; the session itself wasn't started.
    expect(created).toEqual([{ cwd: PARSER, model: undefined, permissionMode: 'default' }]);
    expect((await client.call('hosts.list', {})).hosts).toEqual([]);
    const { threads } = await client.call('session.askThreads', { sessionId: SESSION_ID });
    expect(threads).toMatchObject([{ id: threadId, title: 'Which flag?', items: [{ id, question: 'Which flag?', answer: 'It was --cleanStart (Which flag?)' }] }]);
    // Its tokens count in Usage.
    expect(tokens.length).toBeGreaterThan(0);

    const { messages } = await client.call('transcript.get', { sessionId: SESSION_ID });
    expect(messages.map((m) => m.uuid)).toEqual(['u1', 'a1']);
    expect(readFileSync(file, 'utf8')).toBe(before);
    await expect(client.call('session.ask', { sessionId: SESSION_ID, question: '   ' })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('renames a session through Claude Code and sends the new title at once', async () => {
    let customTitle: string | undefined;
    const renamed: string[] = [];
    const current = () => ({ sessionId: SESSION_ID, summary: 'Refactor parser', lastModified: 42, cwd: PARSER, ...(customTitle ? { customTitle } : {}) });
    const source: SessionSource = {
      ...fakeSource,
      list: async () => [current()],
      info: async (id) => (id === SESSION_ID ? current() : undefined),
      rename: async (_id, title) => {
        renamed.push(title);
        customTitle = title;
      },
    };
    const { client } = connect({ source });
    await new Promise((resolve) => client.on('sessions.changed', resolve));
    const titles: string[] = [];
    client.on('sessions.changed', ({ upserted }) => upserted.forEach((s) => titles.push(s.title)));
    await client.call('session.rename', { sessionId: SESSION_ID, title: '  Parser\n  cleanup ' });
    // Kept on one line, like the titles Claude Code makes.
    expect(renamed).toEqual(['Parser cleanup']);
    await client.call('system.ping', { sentAt: 0 });
    expect(titles).toContain('Parser cleanup');
    expect((await client.call('sessions.list', {})).sessions[0]).toMatchObject({ title: 'Parser cleanup', customTitle: 'Parser cleanup' });
    await expect(client.call('session.rename', { sessionId: SESSION_ID, title: '   ' })).rejects.toThrow();
    await expect(client.call('session.rename', { sessionId: '44444444-4444-4444-8444-444444444444', title: 'Nope' })).rejects.toThrow(/No transcript/);
    expect(renamed).toHaveLength(1);
  });

  it('moves a deleted session and its subagent folder to the Trash and forgets it', async () => {
    const trashed: string[][] = [];
    const { client, projectDir } = connect({ trashed });
    await new Promise((resolve) => client.on('sessions.changed', resolve));
    await client.call('sessions.setFlags', { sessionId: SESSION_ID, pinned: true });
    await client.call('session.delete', { sessionId: SESSION_ID });
    expect(trashed).toEqual([[join(projectDir, `${SESSION_ID}.jsonl`), join(projectDir, SESSION_ID)]]);
    expect((await client.call('sessions.list', {})).sessions).toEqual([]);
    await expect(client.call('session.delete', { sessionId: SESSION_ID })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses to delete a session another Claude Code window has open', async () => {
    const trashed: string[][] = [];
    const { client, dataDir } = connect({ trashed });
    await new Promise((resolve) => client.on('sessions.changed', resolve));
    const registry = join(dataDir, 'claude', 'sessions');
    mkdirSync(registry, { recursive: true });
    writeFileSync(join(registry, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: SESSION_ID, status: 'idle' }));
    await client.call('sessions.refresh', {});
    await expect(client.call('session.delete', { sessionId: SESSION_ID })).rejects.toMatchObject({ code: 'SESSION_BUSY_ELSEWHERE' });
    expect(trashed).toEqual([]);
  });

  it('refuses to delete sessions when nothing can move them to the Trash', async () => {
    const { client, projectDir } = connect({ noTrash: true });
    await new Promise((resolve) => client.on('sessions.changed', resolve));
    await expect(client.call('session.delete', { sessionId: SESSION_ID })).rejects.toMatchObject({ code: 'NO_TRASH' });
    await expect(client.call('sessions.deleteMany', { sessionIds: [SESSION_ID] })).rejects.toMatchObject({ code: 'NO_TRASH' });
    expect(existsSync(join(projectDir, `${SESSION_ID}.jsonl`))).toBe(true);
    expect((await client.call('sessions.list', {})).sessions.map((s) => s.id)).toEqual([SESSION_ID]);
  });

  describe('deleting many sessions', () => {
    const OTHER_ID = '44444444-4444-4444-8444-444444444444';
    const PINNED_ID = '55555555-5555-4555-8555-555555555555';
    const DRAFT_ID = '66666666-6666-4666-8666-666666666666';
    const QUEUED_ID = '77777777-7777-4777-8777-777777777777';
    const ids = [SESSION_ID, OTHER_ID, PINNED_ID, DRAFT_ID, QUEUED_ID];
    // Five old sessions, each with a transcript on disk.
    const source = (dataDir: string): SessionSource => {
      const dir = join(dataDir, 'claude', 'projects', '-work-parser');
      mkdirSync(dir, { recursive: true });
      for (const id of ids) writeFileSync(join(dir, `${id}.jsonl`), '{"entrypoint":"cli"}\n');
      return { ...fakeSource, list: async () => ids.map((sessionId) => ({ sessionId, summary: sessionId.slice(0, 4), lastModified: 42, cwd: PARSER })) };
    };
    const ready = async (client: ReturnType<typeof connect>['client']) => {
      await new Promise((resolve) => client.on('sessions.changed', resolve));
      await client.call('sessions.setFlags', { sessionId: PINNED_ID, pinned: true });
      await client.call('appState.set', { key: 'ui.drafts', value: { version: 1, drafts: { [DRAFT_ID]: { text: 'not sent yet', updatedAt: 1, images: 0 }, 'new:/work/parser': { text: 'a new one', updatedAt: 1, images: 0 } } } });
      await client.call('later.add', { draft: { cwd: PARSER, prompt: 'After that one' }, waitFor: { kind: 'session', sessionId: QUEUED_ID } });
    };

    it('moves the free ones to the Trash and says why the others stay', async () => {
      const trashed: string[][] = [];
      const { client } = connect({ trashed, source });
      await ready(client);
      const result = await client.call('sessions.deleteMany', { sessionIds: [...ids, 'gone-already'] });
      expect(result.deleted.map((d) => d.id).sort()).toEqual([OTHER_ID, SESSION_ID].sort());
      expect(Object.fromEntries(result.skipped.map((s) => [s.id, s.reason]))).toEqual({ [PINNED_ID]: 'pinned', [DRAFT_ID]: 'draft', [QUEUED_ID]: 'queued', 'gone-already': 'not-found' });
      expect(trashed.flat().filter((p) => p.endsWith('.jsonl'))).toHaveLength(2);
      expect((await client.call('sessions.list', {})).sessions.map((s) => s.id).sort()).toEqual([PINNED_ID, DRAFT_ID, QUEUED_ID].sort());
    });

    it('keeps a session another Claude Code window has open', async () => {
      const trashed: string[][] = [];
      const { client, dataDir } = connect({ trashed, source });
      await ready(client);
      const registry = join(dataDir, 'claude', 'sessions');
      mkdirSync(registry, { recursive: true });
      writeFileSync(join(registry, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: OTHER_ID, status: 'idle' }));
      await client.call('sessions.refresh', {});
      const result = await client.call('sessions.deleteMany', { sessionIds: [OTHER_ID] });
      expect(result).toEqual({ deleted: [], skipped: [{ id: OTHER_ID, reason: 'open-elsewhere', error: null }] });
      expect(trashed).toEqual([]);
    });

    it('does nothing in the daily run while deleting is off', async () => {
      const trashed: string[][] = [];
      const { engine, client } = connect({ trashed, source });
      await ready(client);
      engine.setRetention({ archiveAfterDays: 3, deleteArchived: { enabled: false, afterDays: 1 } });
      await expect(engine.deleteArchivedNow()).resolves.toBeNull();
      expect(trashed).toEqual([]);
      expect((await client.call('sessions.list', {})).sessions).toHaveLength(ids.length);
    });

    it('deletes archived sessions as soon as it is on, with the same sessions kept, and logs it', async () => {
      const trashed: string[][] = [];
      const logs: string[] = [];
      const { engine, client } = connect({ trashed, source });
      client.on('engine.log', (entry) => void logs.push(entry.message));
      await ready(client);
      // The first settings after the scan start the launch run; a run asked for now waits for it.
      engine.setRetention({ archiveAfterDays: 3, deleteArchived: { enabled: true, afterDays: 30 } });
      await expect(engine.deleteArchivedNow()).resolves.toMatchObject({ deleted: 0, failed: 0 });
      expect((await client.call('sessions.list', {})).sessions.map((s) => s.id).sort()).toEqual([PINNED_ID, DRAFT_ID, QUEUED_ID].sort());
      expect(trashed.flat().filter((p) => p.endsWith('.jsonl'))).toHaveLength(2);
      await new Promise((resolve) => setTimeout(resolve, 20));
      // Pinned isn't archived at all; the draft and the queued prompt keep theirs.
      expect(logs.find((line) => line.startsWith('Deleting archived sessions'))).toMatch(/moved 2 to the Trash \(.+\); kept 2 \(has an unsent message, has a queued prompt\)|moved 2 to the Trash \(.+\); kept 2 \(has a queued prompt, has an unsent message\)/);
    });
  });

  it('runs shell actions in a terminal tab and refuses unapproved shared ones', async () => {
    const spawned: Array<{ file: string; args: string[]; cwd: string }> = [];
    const dataDir = mkdtempSync(join(tmpdir(), 'seshboard-engine-'));
    const project = mkdtempSync(join(tmpdir(), 'seshboard-project-'));
    writeFileSync(join(project, '.seshboard.json'), JSON.stringify({ actions: [{ id: 'shared', name: 'Shared', command: 'make it' }] }));
    const engine = createEngine({
      dataDir,
      claudeConfigDir: join(dataDir, 'claude'),
      shellEnv: Promise.resolve({ shell: '/bin/zsh', env: { PATH: '', SHELL: '/bin/zsh' }, resolved: false, durationMs: 0 }),
      claudeBinary: '/nonexistent/claude',
      sessionSource: fakeSource,
      spawnPty: async () => (file, args, options) => {
        spawned.push({ file, args, cwd: options.cwd });
        return { pid: 1, onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} };
      },
    });
    const { port1, port2 } = new MessageChannel();
    const detach = engine.attach(messagePortTransport(asDomPort(port1)));
    const client = createRpcClient<Contract>(messagePortTransport(asDomPort(port2)));
    cleanups.push(() => {
      client.dispose();
      detach();
      engine.close();
      port1.close();
      port2.close();
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    });

    await client.call('actions.save', { projectRoot: project, action: { id: 'greet', name: 'Greet', command: 'echo ${sessionId}' } });
    const result = await client.call('actions.run', { sessionId: SESSION_ID, projectRoot: project, cwd: project, id: 'greet' });
    expect(result.kind).toBe('terminal');
    expect(spawned[0]).toEqual({ file: shell.file, args: shell.run(`echo ${shell.quote(SESSION_ID)}`), cwd: project });
    const { terminals } = await client.call('terminal.list', {});
    expect(terminals[0]).toMatchObject({ kind: 'action', title: 'Greet', sessionId: SESSION_ID });

    await expect(client.call('actions.run', { sessionId: SESSION_ID, projectRoot: project, cwd: project, id: 'shared' })).rejects.toMatchObject({ code: 'UNTRUSTED' });
    // Only what the dialog showed: a command that changed meanwhile is not approved.
    await expect(client.call('actions.trust', { projectRoot: project, id: 'shared', seen: { type: 'shell', command: 'make it nicely', runOnWorktreeCreate: false } })).rejects.toMatchObject({ code: 'CHANGED' });
    await client.call('actions.trust', { projectRoot: project, id: 'shared', seen: { type: 'shell', command: 'make it', runOnWorktreeCreate: false } });
    await expect(client.call('actions.run', { sessionId: SESSION_ID, projectRoot: project, cwd: project, id: 'shared' })).resolves.toMatchObject({ kind: 'terminal' });

    // One you share yourself goes in the file, is approved for you, and says the project's actions changed.
    const changed: Array<string | null> = [];
    client.on('actions.changed', ({ root }) => void changed.push(root));
    await client.call('actions.save', { projectRoot: project, shared: true, action: { id: 'lint', name: 'Lint', command: 'npm run lint' } });
    expect(JSON.parse(readFileSync(join(project, '.seshboard.json'), 'utf8')).actions.map((a: { id: string }) => a.id)).toEqual(['shared', 'lint']);
    await expect(client.call('actions.run', { sessionId: SESSION_ID, projectRoot: project, cwd: project, id: 'lint' })).resolves.toMatchObject({ kind: 'terminal' });
    await client.call('actions.delete', { projectRoot: project, shared: true, id: 'lint' });
    expect((await client.call('actions.list', { projectRoot: project })).actions.map((a) => a.id)).toEqual(['shared', 'greet']);
    await expect(client.call('actions.save', { projectRoot: null, shared: true, action: { id: 'x', name: 'X', command: 'x' } })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    expect(changed).toContain(project);
  });

  it('sends what a command printed, and how it ended, to the session when a run that reports back ends', async () => {
    const ptys: Array<{ emit: (data: string) => void; exit: (event: { exitCode: number }) => void }> = [];
    const prompts: string[] = [];
    const project = mkdtempSync(join(tmpdir(), 'seshboard-project-'));
    // A Claude Code that takes in what it is sent and never answers.
    const sdk: SdkRuntime = {
      query: ({ prompt }) =>
        ({
          async *[Symbol.asyncIterator]() {
            for await (const message of prompt as AsyncIterable<SDKUserMessage>) prompts.push((message.message.content as Array<{ text?: string }>).map((c) => c.text ?? '').join(''));
          },
          interrupt: async () => {},
          close: () => {},
          setPermissionMode: async () => {},
          setModel: async () => {},
          supportedCommands: async () => [],
          supportedModels: async () => [],
        }) as never,
      startup: async () => ({ query: () => ({}) as never, close: () => {} }) as never,
    };
    const dataDir = mkdtempSync(join(tmpdir(), 'seshboard-engine-'));
    const projectDir = join(dataDir, 'claude', 'projects', '-work-parser');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, `${SESSION_ID}.jsonl`), '{"entrypoint":"cli"}\n');
    const engine = createEngine({
      dataDir,
      claudeConfigDir: join(dataDir, 'claude'),
      shellEnv: Promise.resolve({ shell: '/bin/zsh', env: { PATH: '', SHELL: '/bin/zsh' }, resolved: false, durationMs: 0 }),
      claudeBinary: '/nonexistent/claude',
      sessionSource: fakeSource,
      sdk: async () => sdk,
      spawnPty: async () => () => {
        const entry: (typeof ptys)[number] = { emit: () => {}, exit: () => {} };
        ptys.push(entry);
        return { pid: 999_998_000 + ptys.length, onData: (l) => ((entry.emit = l), { dispose() {} }), onExit: (l) => ((entry.exit = l), { dispose() {} }), write() {}, resize() {}, kill() {} };
      },
    });
    const { port1, port2 } = new MessageChannel();
    const detach = engine.attach(messagePortTransport(asDomPort(port1)));
    const client = createRpcClient<Contract>(messagePortTransport(asDomPort(port2)));
    cleanups.push(() => {
      client.dispose();
      detach();
      engine.close();
      port1.close();
      port2.close();
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    });
    await new Promise((resolve) => client.on('sessions.changed', resolve));
    const reached = async (text: string) => {
      for (let i = 0; i < 200; i++) {
        const queued = (await client.call('upNext.list', {})).queues.flatMap((q) => q.queue.map((m) => m.text));
        if ([...prompts, ...queued].some((p) => p.includes(text))) return true;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return false;
    };

    // A plain run tells nobody.
    const plain = await client.call('terminal.run', { sessionId: SESSION_ID, cwd: project, command: 'echo quiet' });
    expect(plain).toMatchObject({ kind: 'action', title: 'echo quiet', sessionId: SESSION_ID });
    ptys[0]!.emit('quiet\r\n');
    ptys[0]!.exit({ exitCode: 0 });

    await client.call('terminal.run', { sessionId: SESSION_ID, cwd: project, command: 'npm test', sendOutput: true });
    ptys[1]!.emit('\u001b[31m1 failed\u001b[0m\r\n');
    ptys[1]!.exit({ exitCode: 1 });
    expect(await reached(`I ran \`npm test\` in the terminal (${shellName(shell)}). It failed with exit code 1.\n\nThe output:\n\`\`\`text\n1 failed\n\`\`\``)).toBe(true);
    expect(await reached('echo quiet')).toBe(false);
  });

  it('stops an action terminal and restarts it in the same tab, checking the action again', async () => {
    const spawned: Array<{ args: string[]; exit: (event: { exitCode: number; signal?: number }) => void; written: string[] }> = [];
    const dataDir = mkdtempSync(join(tmpdir(), 'seshboard-engine-'));
    const project = mkdtempSync(join(tmpdir(), 'seshboard-project-'));
    const sharedFile = join(project, '.seshboard.json');
    writeFileSync(sharedFile, JSON.stringify({ actions: [{ id: 'dev', name: 'Dev', command: 'npm run dev' }] }));
    const engine = createEngine({
      dataDir,
      claudeConfigDir: join(dataDir, 'claude'),
      shellEnv: Promise.resolve({ shell: '/bin/zsh', env: { PATH: '', SHELL: '/bin/zsh' }, resolved: false, durationMs: 0 }),
      claudeBinary: '/nonexistent/claude',
      sessionSource: fakeSource,
      spawnPty: async () => (_file, args) => {
        const entry: (typeof spawned)[number] = { args, exit: () => {}, written: [] };
        spawned.push(entry);
        return {
          pid: 999_999_000 + spawned.length,
          onData: () => ({ dispose() {} }),
          onExit: (listener) => ((entry.exit = listener), { dispose() {} }),
          write: (data) => void entry.written.push(data),
          resize() {},
          kill() {},
        };
      },
    });
    const { port1, port2 } = new MessageChannel();
    const detach = engine.attach(messagePortTransport(asDomPort(port1)));
    const client = createRpcClient<Contract>(messagePortTransport(asDomPort(port2)));
    cleanups.push(() => {
      client.dispose();
      detach();
      engine.close();
      port1.close();
      port2.close();
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    });
    const exitCode = async () => (await client.call('terminal.list', {})).terminals[0]!.exitCode;

    await client.call('actions.trust', { projectRoot: project, id: 'dev', seen: { type: 'shell', command: 'npm run dev', runOnWorktreeCreate: false } });
    const run = await client.call('actions.run', { sessionId: SESSION_ID, projectRoot: project, cwd: project, id: 'dev' });
    if (run.kind !== 'terminal') throw new Error('expected a terminal');
    await expect(client.call('terminal.restart', { id: run.terminalId })).rejects.toMatchObject({ code: 'TERMINAL_FAILED' });

    // Stop sends Ctrl+C; a process that dies of SIGINT reports 130, not 0.
    await client.call('terminal.stop', { id: run.terminalId });
    expect(spawned[0]!.written).toEqual(['\x03']);
    spawned[0]!.exit({ exitCode: 0, signal: 2 });
    expect(await exitCode()).toBe(130);

    const restarted = await client.call('terminal.restart', { id: run.terminalId });
    expect(restarted).toMatchObject({ id: run.terminalId, kind: 'action', title: 'Dev', exitCode: null });
    expect(spawned.map((s) => s.args)).toEqual([shell.run('npm run dev'), shell.run('npm run dev')]);
    expect((await client.call('terminal.list', {})).terminals).toHaveLength(1);
    // The first process exiting late doesn't touch the restarted one.
    spawned[0]!.exit({ exitCode: 1 });
    expect(await exitCode()).toBeNull();

    // An edited shared command needs approval again before it reruns.
    spawned[1]!.exit({ exitCode: 0 });
    writeFileSync(sharedFile, JSON.stringify({ actions: [{ id: 'dev', name: 'Dev', command: 'npm run dev -- --open' }] }));
    await expect(client.call('terminal.restart', { id: run.terminalId })).rejects.toMatchObject({ code: 'UNTRUSTED' });
    expect(spawned).toHaveLength(2);
    await client.call('actions.trust', { projectRoot: project, id: 'dev', seen: { type: 'shell', command: 'npm run dev -- --open', runOnWorktreeCreate: false } });
    await client.call('terminal.restart', { id: run.terminalId });
    expect(spawned[2]!.args).toEqual(shell.run('npm run dev -- --open'));
  });
});

describe('quick questions', () => {
  /** A session in /work/parser and one in the questions folder (known once the engine has a data folder). */
  function connectWithQuestion(sdk?: SdkRuntime) {
    const source = (dataDir: string): SessionSource => ({
      ...fakeSource,
      list: async () => [
        { sessionId: SESSION_ID, summary: 'Refactor parser', lastModified: 42, cwd: PARSER },
        { sessionId: '44444444-4444-4444-8444-444444444444', summary: 'What is a monad?', lastModified: 43, cwd: join(dataDir, 'questions') },
      ],
    });
    const connected = connect({ source, ...(sdk ? { sdk } : {}) });
    return { ...connected, questions: join(connected.dataDir, 'questions') };
  }

  it('runs every question in one folder in the data folder, made when it is needed', async () => {
    const created: Array<{ cwd?: string; model?: string; permissionMode?: string }> = [];
    const { client, questions } = connectWithQuestion(fakeSdk(created));
    expect(existsSync(questions)).toBe(false);
    await expect(client.call('questions.folder', {})).resolves.toEqual({ path: questions });
    expect(existsSync(questions)).toBe(true);
    // Deleted while the app runs: the next question makes it again.
    rmSync(questions, { recursive: true });
    await client.call('session.create', { cwd: questions, prompt: 'What is a monad?' });
    expect(existsSync(questions)).toBe(true);
    expect(created).toEqual([expect.objectContaining({ cwd: questions, permissionMode: 'default' })]);
    // No checkout to branch from or switch.
    await expect(client.call('session.create', { cwd: questions, prompt: 'hi', worktree: { name: 'x', baseRef: 'fresh' } })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(client.call('session.create', { cwd: questions, prompt: 'hi', checkoutBranch: 'main' })).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('never lists the folder as a project or lets it become one', async () => {
    const { client, questions } = connectWithQuestion();
    const scanned = new Promise((resolve) => client.on('sessions.changed', resolve));
    await client.call('questions.folder', {});
    await scanned;
    const { sessions } = await client.call('sessions.list', {});
    // The session is listed like any other, in the questions folder.
    expect(sessions.map((s) => s.projectRoot).sort()).toEqual([PARSER, questions].sort());
    expect((await client.call('projects.list', {})).projects.map((p) => p.root)).toEqual([PARSER]);
    await expect(client.call('projects.add', { path: questions })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(client.call('projects.rename', { root: questions, name: 'Questions' })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(client.call('projects.setIcon', { root: questions, icon: { kind: 'emoji', value: '❓' } })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(client.call('projects.setProfile', { root: questions, profileId: null })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(client.call('projects.setDefaults', { root: questions, defaults: {} })).rejects.toMatchObject({ code: 'INVALID' });
    expect((await client.call('projects.list', {})).projects.map((p) => p.root)).toEqual([PARSER]);
  });
});

describe('Claude profiles', () => {
  /** A minimal Claude Code transcript, read back through the real SDK. */
  const transcript = (configDir: string, sessionId: string, cwd: string, prompt: string) => {
    const dir = join(configDir, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
    mkdirSync(dir, { recursive: true });
    const at = new Date(Date.now() - 60_000).toISOString();
    const common = { sessionId, cwd, timestamp: at, entrypoint: 'cli', version: '2.1.0', isSidechain: false, userType: 'external' };
    writeFileSync(
      join(dir, `${sessionId}.jsonl`),
      [
        { ...common, type: 'user', uuid: `${sessionId.slice(0, 8)}-u`, parentUuid: null, message: { role: 'user', content: prompt } },
        { ...common, type: 'assistant', uuid: `${sessionId.slice(0, 8)}-a`, parentUuid: `${sessionId.slice(0, 8)}-u`, message: { role: 'assistant', model: 'm', content: [{ type: 'text', text: 'On it.' }] } },
      ]
        .map((line) => JSON.stringify(line))
        .join('\n') + '\n',
    );
  };
  const until = async (check: () => Promise<boolean>, timeoutMs = 8_000) => {
    const deadline = Date.now() + timeoutMs;
    while (!(await check())) {
      if (Date.now() > deadline) throw new Error('timed out');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  it('lists, searches and runs sessions from two config folders, each with its own login', async () => {
    const previous = process.env.CLAUDE_CONFIG_DIR;
    const dataDir = mkdtempSync(join(tmpdir(), 'seshboard-engine-'));
    const personal = join(dataDir, 'claude');
    const work = join(dataDir, 'claude-work');
    const project = mkdtempSync(join(tmpdir(), 'seshboard-project-'));
    const PERSONAL_ID = '44444444-4444-4444-8444-444444444444';
    const WORK_ID = '55555555-5555-4555-8555-555555555555';
    transcript(personal, PERSONAL_ID, BLOG, 'Write the personal blog post');
    transcript(work, WORK_ID, project, 'Fix the quarterly report');
    writeFileSync(join(work, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'me@work.example', organizationName: 'Work Inc' } }));
    // A stand-in for Claude Code that records the environment each helper process gets.
    const envs: Array<Record<string, string | undefined>> = [];
    const sdk = async () =>
      ({
        query: ({ options }: { options: { env?: Record<string, string | undefined> } }) => {
          envs.push(options.env ?? {});
          return { supportedCommands: async () => [], close() {}, [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) };
        },
        startup: async () => ({ query: () => undefined, close() {} }),
      }) as never;
    // And the config folder each terminal gets.
    const terminalEnvs: Array<{ configDir: string | undefined }> = [];
    const engine = createEngine({
      dataDir,
      claudeConfigDir: personal,
      shellEnv: Promise.resolve({ shell: '/bin/zsh', env: { PATH: '' }, resolved: false, durationMs: 0 }),
      claudeBinary: '/nonexistent/claude',
      sdk,
      spawnPty: async () => (_file, _args, options) => {
        terminalEnvs.push({ configDir: options.env.CLAUDE_CONFIG_DIR });
        return { pid: 1, onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), write() {}, resize() {}, kill() {} };
      },
    });
    const { port1, port2 } = new MessageChannel();
    const detach = engine.attach(messagePortTransport(asDomPort(port1)));
    const client = createRpcClient<Contract>(messagePortTransport(asDomPort(port2)));
    cleanups.push(() => {
      client.dispose();
      detach();
      engine.close();
      port1.close();
      port2.close();
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
      if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previous;
    });
    const profileOf = async (id: string) => (await client.call('sessions.list', {})).sessions.find((s) => s.id === id)?.profileId;

    // One profile to start with: Claude Code's own folder.
    await until(async () => (await profileOf(PERSONAL_ID)) === 'default');
    expect((await client.call('profiles.list', {})).profiles).toMatchObject([{ id: 'default', builtin: true, isDefault: true, configDir: personal }]);
    expect(await profileOf(WORK_ID)).toBeUndefined();

    const { id: workId } = await client.call('profiles.add', { name: 'Work', color: 'blue', configDir: work });
    await expect(client.call('profiles.add', { name: 'Again', color: 'red', configDir: work })).rejects.toMatchObject({ code: 'DUPLICATE' });
    await until(async () => (await profileOf(WORK_ID)) === workId);
    expect(await profileOf(PERSONAL_ID)).toBe('default');
    expect((await client.call('profiles.list', {})).profiles.find((p) => p.id === workId)).toMatchObject({
      name: 'Work',
      builtin: false,
      isDefault: false,
      account: { email: 'me@work.example', organization: 'Work Inc' },
    });

    // Transcripts and search read each session from its own folder.
    const { messages } = await client.call('transcript.get', { sessionId: WORK_ID });
    expect(messages[0]?.blocks[0]).toEqual({ type: 'text', text: 'Fix the quarterly report' });
    await until(async () => (await client.call('search.query', { query: 'quarterly', limit: 10 })).hits.some((h) => h.sessionId === WORK_ID), 10_000);

    // New processes in a project get the profile it is linked to, else the default.
    await client.call('session.commands', { cwd: resolve('/tmp') });
    expect(envs.at(-1)?.CLAUDE_CONFIG_DIR).toBe(personal);
    await client.call('projects.add', { path: project });
    await client.call('projects.setProfile', { root: project, profileId: workId });
    expect((await client.call('projects.list', {})).projects.find((p) => p.root === project)).toMatchObject({ profileId: workId });
    await client.call('session.commands', { cwd: project });
    expect(envs.at(-1)?.CLAUDE_CONFIG_DIR).toBe(work);
    await client.call('profiles.setDefault', { id: workId });
    expect((await client.call('profiles.list', {})).defaultId).toBe(workId);
    await client.call('session.commands', { cwd: resolve('/var') });
    expect(envs.at(-1)?.CLAUDE_CONFIG_DIR).toBe(work);

    // A terminal can be opened with a profile of its own (Settings signs a new profile in that way), whatever its folder's is.
    await client.call('terminal.open', { sessionId: null, kind: 'shell', cols: 80, rows: 24, profileId: 'default' });
    expect(terminalEnvs.at(-1)?.configDir).toBe(personal);
    await client.call('terminal.open', { sessionId: null, cwd: tmpdir(), kind: 'shell', cols: 80, rows: 24 });
    expect(terminalEnvs.at(-1)?.configDir).toBe(work);
    await expect(client.call('terminal.open', { sessionId: null, kind: 'claude', cols: 80, rows: 24, profileId: 'gone' })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // Removing the profile forgets its sessions and links; the folder stays.
    await expect(client.call('profiles.remove', { id: 'default' })).rejects.toMatchObject({ code: 'BUILTIN' });
    await client.call('profiles.remove', { id: workId });
    await until(async () => (await profileOf(WORK_ID)) === undefined);
    const after = await client.call('profiles.list', {});
    expect(after).toMatchObject({ defaultId: 'default', profiles: [{ id: 'default' }] });
    expect((await client.call('projects.list', {})).projects.find((p) => p.root === project)).toMatchObject({ profileId: null });
    expect(existsSync(join(work, '.claude.json'))).toBe(true);
  }, 30_000);

  it("starts fresh worktrees from a project's own default branch, and compares against it", async () => {
    const created: Array<{ cwd?: string; worktree?: string | null }> = [];
    const { client } = connect({ sdk: fakeSdk(created), path: process.env.PATH ?? '' });
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-default-branch-')));
    cleanups.push(() => rmSync(repo, { recursive: true, force: true }));
    const run = (...args: string[]) => git(repo, args);
    await run('init', '-q', '-b', 'main');
    await run('config', 'user.email', 'test@example.com');
    await run('config', 'user.name', 'Test');
    writeFileSync(join(repo, 'a.txt'), 'one\n');
    await run('add', '.');
    await run('commit', '-qm', 'initial');
    await run('switch', '-qc', 'dev');
    writeFileSync(join(repo, 'a.txt'), 'on dev\n');
    await run('commit', '-qam', 'dev');
    await run('switch', '-q', 'main');
    const dev = (await run('rev-parse', 'dev')).trim();

    await client.call('projects.add', { path: repo });
    expect((await client.call('worktree.status', { cwd: repo })).baseBranch).toBe('main');
    await client.call('projects.setDefaults', { root: repo, defaults: { model: null, effort: null, permissionMode: null, workspace: null, baseRef: null, branch: null, defaultBranch: 'dev' } });
    expect((await client.call('worktree.status', { cwd: repo })).baseBranch).toBe('dev');

    // Seshboard makes the worktree itself, from dev, instead of asking Claude Code for one from origin's HEAD.
    await client.call('session.create', { cwd: repo, prompt: 'hi', worktree: { name: 'from-dev', baseRef: 'fresh' } });
    await until(async () => created.length === 1);
    expect(created[0]!.worktree).toBeUndefined();
    expect(created[0]!.cwd).toBe(join(repo, '.claude', 'worktrees', 'from-dev'));
    expect((await git(created[0]!.cwd!, ['rev-parse', 'HEAD'])).trim()).toBe(dev);
  });

  it('switches the branch of a checkout, keeps uncommitted work and refuses while Claude works there', async () => {
    const { client, dataDir } = connect();
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-switch-')));
    cleanups.push(() => rmSync(repo, { recursive: true, force: true }));
    const run = (...args: string[]) => git(repo, args);
    await run('init', '-q', '-b', 'main');
    await run('config', 'user.email', 'test@example.com');
    await run('config', 'user.name', 'Test');
    // Windows runners default to autocrlf, which makes the rewritten a.txt look modified to git.
    await run('config', 'core.autocrlf', 'false');
    writeFileSync(join(repo, 'a.txt'), 'one\n');
    await run('add', '.');
    await run('commit', '-qm', 'initial');
    await run('branch', 'feature');
    await run('switch', '-qc', 'other');
    writeFileSync(join(repo, 'a.txt'), 'committed on other\n');
    await run('commit', '-qam', 'other');
    await run('switch', '-q', 'main');

    // Another branch, with an uncommitted new file coming along.
    writeFileSync(join(repo, 'scratch.txt'), 'mine\n');
    await expect(client.call('git.switch', { cwd: repo, branch: 'feature' })).resolves.toEqual({ current: 'feature' });
    expect(readFileSync(join(repo, 'scratch.txt'), 'utf8')).toBe('mine\n');
    // The branch already checked out: nothing to do.
    await expect(client.call('git.switch', { cwd: repo, branch: 'feature' })).resolves.toEqual({ current: 'feature' });

    // A change git would overwrite: refused, and the working tree is unchanged.
    writeFileSync(join(repo, 'a.txt'), 'uncommitted\n');
    await expect(client.call('git.switch', { cwd: repo, branch: 'other' })).rejects.toMatchObject({ code: 'GIT_FAILED' });
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('uncommitted\n');
    expect((await client.call('git.branches', { cwd: repo })).current).toBe('feature');
    await expect(client.call('git.switch', { cwd: repo, branch: '--orphan' })).rejects.toMatchObject({ code: 'GIT_FAILED' });

    // A Claude Code session working in this checkout (a subfolder counts): refused until it is idle.
    writeFileSync(join(repo, 'a.txt'), 'one\n');
    mkdirSync(join(repo, 'src'));
    const registry = join(dataDir, 'claude', 'sessions');
    mkdirSync(registry, { recursive: true });
    const entry = (status: string) => JSON.stringify({ pid: process.pid, sessionId: '66666666-6666-4666-8666-666666666666', cwd: join(repo, 'src'), status, entrypoint: 'cli' });
    writeFileSync(join(registry, `${process.pid}.json`), entry('busy'));
    await expect(client.call('git.switch', { cwd: repo, branch: 'main' })).rejects.toMatchObject({ code: 'SESSION_BUSY' });
    expect((await client.call('git.branches', { cwd: repo })).current).toBe('feature');
    writeFileSync(join(registry, `${process.pid}.json`), entry('idle'));
    await expect(client.call('git.switch', { cwd: repo, branch: 'main' })).resolves.toEqual({ current: 'main' });

    // A branch only on a remote (the Branches tab's rows): git makes a local branch that tracks it.
    await run('remote', 'add', 'origin', join(repo, 'nowhere.git'));
    await run('update-ref', 'refs/remotes/origin/remote-only', 'other');
    await expect(client.call('git.switch', { cwd: repo, branch: 'remote-only' })).resolves.toEqual({ current: 'remote-only' });
    expect((await run('rev-parse', '--abbrev-ref', 'remote-only@{upstream}')).trim()).toBe('origin/remote-only');
  });

  it('refuses to switch, merge into or remove a checkout while another session works there', async () => {
    const { client, dataDir } = connect();
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-busy-')));
    cleanups.push(() => rmSync(repo, { recursive: true, force: true }));
    const run = (...args: string[]) => git(repo, args);
    await run('init', '-q', '-b', 'main');
    await run('config', 'user.email', 'test@example.com');
    await run('config', 'user.name', 'Test');
    writeFileSync(join(repo, 'a.txt'), 'one\n');
    await run('add', '.');
    await run('commit', '-qm', 'initial');
    await run('branch', 'feature');
    const tree = join(repo, '.worktrees', 'wt');
    await run('worktree', 'add', '-q', '-b', 'wt-branch', tree);
    await git(tree, ['commit', '-q', '--allow-empty', '-m', 'work']);

    const registry = join(dataDir, 'claude', 'sessions');
    mkdirSync(registry, { recursive: true });
    const busyIn = (cwd: string) =>
      writeFileSync(join(registry, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: '77777777-7777-4777-8777-777777777777', cwd, status: 'busy', entrypoint: 'cli' }));

    busyIn(repo);
    await expect(client.call('session.create', { cwd: repo, prompt: 'hi', checkoutBranch: 'feature' })).rejects.toMatchObject({ code: 'SESSION_BUSY' });
    expect((await client.call('git.branches', { cwd: repo })).current).toBe('main');
    await expect(client.call('worktree.finish', { sessionId: SESSION_ID, cwd: tree, action: 'merge' })).rejects.toMatchObject({ code: 'SESSION_BUSY' });

    busyIn(tree);
    await expect(client.call('worktree.finish', { sessionId: SESSION_ID, cwd: tree, action: 'remove' })).rejects.toMatchObject({ code: 'SESSION_BUSY' });
    expect(existsSync(tree)).toBe(true);
  });
});
