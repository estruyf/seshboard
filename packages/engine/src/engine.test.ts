import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { createRpcClient, messagePortTransport, type Contract, type DomLikePort, type LogEntry, type TranscriptUpdate } from '@switchboard/protocol';
import type { SessionSource } from './claude/sessionSource.ts';
import { createEngine } from './engine.ts';
import type { SdkRuntime } from './host/hostManager.ts';
import { git } from './git/gitChanges.ts';
import { userShell } from './system/shell.ts';

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
function fakeSdk(created: Array<{ cwd?: string; model?: string; permissionMode?: string }>): SdkRuntime {
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
  return {
    query: ({ options }) => {
      created.push({ cwd: options.cwd, model: options.model, permissionMode: options.permissionMode });
      return quiet() as never;
    },
    startup: async ({ options }) => ({ query: () => (created.push({ cwd: options.cwd, model: options.model, permissionMode: options.permissionMode }), quiet()), close: () => {} }) as never,
  };
}

// Node's MessagePort is a DOM-style EventTarget at runtime; its typings just use a generic Event.
const asDomPort = (port: MessagePort) => port as unknown as DomLikePort;

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

function connect(extra: { trashed?: string[][]; source?: SessionSource | ((dataDir: string) => SessionSource); sdk?: SdkRuntime } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'switchboard-engine-'));
  // A real transcript file, so the index knows where the session lives.
  const projectDir = join(dataDir, 'claude', 'projects', '-work-parser');
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, `${SESSION_ID}.jsonl`), '{"entrypoint":"cli"}\n');
  mkdirSync(join(projectDir, SESSION_ID, 'subagents'), { recursive: true });
  const engine = createEngine({
    trash: async (paths) => void extra.trashed?.push(paths),
    dataDir,
    claudeConfigDir: join(dataDir, 'claude'),
    // No login shell and an empty PATH, so the test never depends on the machine.
    shellEnv: Promise.resolve({ shell: '/bin/zsh', env: { PATH: '' }, resolved: false, durationMs: 0 }),
    claudeBinary: '/nonexistent/claude',
    sessionSource: (typeof extra.source === 'function' ? extra.source(dataDir) : extra.source) ?? fakeSource,
    ...(extra.sdk ? { sdk: async () => extra.sdk! } : {}),
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
    expect(info.versions.sqlite).toMatch(/^\d+\.\d+/);
    expect(info.shell.resolved).toBe(false);
    expect(info.claude).toBeNull();
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

  it('runs shell actions in a terminal tab and refuses unapproved shared ones', async () => {
    const spawned: Array<{ file: string; args: string[]; cwd: string }> = [];
    const dataDir = mkdtempSync(join(tmpdir(), 'switchboard-engine-'));
    const project = mkdtempSync(join(tmpdir(), 'switchboard-project-'));
    writeFileSync(join(project, '.switchboard.json'), JSON.stringify({ actions: [{ id: 'shared', name: 'Shared', command: 'make it' }] }));
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
    await client.call('actions.trust', { projectRoot: project, id: 'shared' });
    await expect(client.call('actions.run', { sessionId: SESSION_ID, projectRoot: project, cwd: project, id: 'shared' })).resolves.toMatchObject({ kind: 'terminal' });
  });

  it('stops an action terminal and restarts it in the same tab, checking the action again', async () => {
    const spawned: Array<{ args: string[]; exit: (event: { exitCode: number; signal?: number }) => void; written: string[] }> = [];
    const dataDir = mkdtempSync(join(tmpdir(), 'switchboard-engine-'));
    const project = mkdtempSync(join(tmpdir(), 'switchboard-project-'));
    const sharedFile = join(project, '.switchboard.json');
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

    await client.call('actions.trust', { projectRoot: project, id: 'dev' });
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
    await client.call('actions.trust', { projectRoot: project, id: 'dev' });
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
    const dataDir = mkdtempSync(join(tmpdir(), 'switchboard-engine-'));
    const personal = join(dataDir, 'claude');
    const work = join(dataDir, 'claude-work');
    const project = mkdtempSync(join(tmpdir(), 'switchboard-project-'));
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
    const engine = createEngine({
      dataDir,
      claudeConfigDir: personal,
      shellEnv: Promise.resolve({ shell: '/bin/zsh', env: { PATH: '' }, resolved: false, durationMs: 0 }),
      claudeBinary: '/nonexistent/claude',
      sdk,
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

    // Removing the profile forgets its sessions and links; the folder stays.
    await expect(client.call('profiles.remove', { id: 'default' })).rejects.toMatchObject({ code: 'BUILTIN' });
    await client.call('profiles.remove', { id: workId });
    await until(async () => (await profileOf(WORK_ID)) === undefined);
    const after = await client.call('profiles.list', {});
    expect(after).toMatchObject({ defaultId: 'default', profiles: [{ id: 'default' }] });
    expect((await client.call('projects.list', {})).projects.find((p) => p.root === project)).toMatchObject({ profileId: null });
    expect(existsSync(join(work, '.claude.json'))).toBe(true);
  }, 30_000);

  it('switches the branch of a checkout, keeps uncommitted work and refuses while Claude works there', async () => {
    const { client, dataDir } = connect();
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-switch-')));
    cleanups.push(() => rmSync(repo, { recursive: true, force: true }));
    const run = (...args: string[]) => git(repo, args);
    await run('init', '-q', '-b', 'main');
    await run('config', 'user.email', 'test@example.com');
    await run('config', 'user.name', 'Test');
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
  });

  it('refuses to switch, merge into or remove a checkout while another session works there', async () => {
    const { client, dataDir } = connect();
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-busy-')));
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
