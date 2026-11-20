import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DriverEvents } from '../provider.ts';
import { codexDriver } from './codexDriver.ts';
import { fakeAppServer, thread } from './codexFakes.ts';
import { lockFile, LOCK_DIR } from './codexInUse.ts';
import { codexProvider } from './codexProvider.ts';
import { codexCapabilities, codexMcpServer, COMPACT_NO_INSTRUCTIONS, COMPACT_NOT_STEERED, configuredMcp, isCompact, isCompactWithMore, MCP_RECONNECT_BUSY, MCP_RECONNECT_NOT_LOADED, MCP_TOGGLE_REFUSED } from './codexTools.ts';
import type { HookMetadata, McpServerStatus, SkillMetadata } from './protocol.ts';

const T = '019a0000-0000-7000-8000-00000000000a';
const OTHER = '019a0000-0000-7000-8000-00000000000b';
const CWD = '/work/app';

const server = (name: string, extra: Partial<McpServerStatus> = {}): McpServerStatus => ({ name, runtimeStatus: null, pluginId: null, serverInfo: null, tools: {}, toolsError: null, ...extra });
const skill = (name: string, extra: Partial<SkillMetadata> = {}): SkillMetadata => ({ name, description: `About ${name}`, path: `/s/${name}/SKILL.md`, scope: 'user', enabled: true, pluginId: null, ...extra });
const hook = (extra: Partial<HookMetadata>): HookMetadata => ({ key: 'k', eventName: 'preToolUse', matcher: null, statusMessage: null, source: 'user', pluginId: null, enabled: true, handlerType: 'command', ...extra });

const events = (): DriverEvents => ({ stream: () => {}, messages: () => {}, state: () => {}, permission: () => {}, permissionDone: () => {}, usage: () => {}, model: () => {} });

describe('codexCapabilities', () => {
  it("shows Codex's MCP servers by their state in a thread, and a failed discovery without one", () => {
    expect(codexMcpServer(server('docs', { runtimeStatus: 'connected', tools: { search: {}, fetch: {} }, serverInfo: { name: 'docs', version: '1.2.0' } }))).toEqual({ name: 'docs', status: 'connected', scope: null, tools: ['fetch', 'search'], error: null, version: '1.2.0' });
    expect(codexMcpServer(server('login', { runtimeStatus: 'authenticationRequired' })).status).toBe('needs-auth');
    expect(codexMcpServer(server('off', { runtimeStatus: 'disabled' })).status).toBe('disabled');
    expect(codexMcpServer(server('starting', { runtimeStatus: 'starting' })).status).toBe('pending');
    expect(codexMcpServer(server('broken', { toolsError: 'MCP startup failed' }))).toMatchObject({ status: 'failed', error: 'MCP startup failed' });
    expect(codexMcpServer(server('quiet')).status).toBe('pending');
    expect(codexMcpServer(server('github', { pluginId: 'github@openai', runtimeStatus: 'connected' })).scope).toBe('plugin');
  });

  it("lists skills once each, without Codex's own and the ones turned off, and hooks by what they run", () => {
    const caps = codexCapabilities({
      live: true,
      mcp: [],
      skills: [skill('hello', { shortDescription: 'Says hi' }), skill('hello', { scope: 'repo' }), skill('imagegen', { scope: 'system' }), skill('off', { enabled: false })],
      hooks: [hook({ command: 'npm run lint', matcher: 'apply_patch' }), hook({ eventName: 'stop', handlerType: 'mcpTool', server: 'notes', tool: 'save', pluginId: 'p' })],
    });
    expect(caps).toEqual({
      live: true,
      mcp: [],
      agents: [],
      commands: [{ name: 'hello', description: 'Says hi', argumentHint: '' }],
      plugins: [],
      hooks: [
        { event: 'preToolUse', matcher: 'apply_patch', command: 'npm run lint', scope: 'user', enabled: true },
        { event: 'stop', matcher: null, command: 'notes/save', scope: 'plugin', enabled: true },
      ],
      // Tools shows no on/off switch, and says what Reconnect reaches.
      mcpToggle: false,
      reconnectNote: 'Reconnects the MCP servers of every Codex session running here',
    });
  });

  it('knows /compact, alone, and with words after it', () => {
    expect(isCompact('/compact')).toBe(true);
    expect(isCompact('  /Compact \n')).toBe(true);
    expect(isCompact('/compact keep the API notes')).toBe(false);
    expect(isCompact('compact')).toBe(false);
    expect(isCompactWithMore('/compact keep the API notes')).toBe(true);
    expect(isCompactWithMore('/compact')).toBe(false);
    expect(isCompactWithMore('/compacted')).toBe(false);
  });

  it("reads the config's MCP servers by name and on or off, nothing else", () => {
    expect(configuredMcp({ mcp_servers: { web: { url: 'https://x', headers: { Authorization: 'secret' } }, off: { command: 'false', enabled: false } } })).toEqual([
      { name: 'off', runtimeStatus: 'disabled', pluginId: null, tools: {}, toolsError: null },
      { name: 'web', runtimeStatus: null, pluginId: null, tools: {}, toolsError: null },
    ]);
    expect(configuredMcp({ mcp_servers: null })).toEqual([]);
    expect(configuredMcp(undefined)).toEqual([]);
  });
});

/** A running session over a fake app-server that has Tools, rename and compact. */
async function running(options: { hooksFail?: boolean } = {}) {
  let started = 0;
  const fake = fakeAppServer({
    // The first session is T, a second one OTHER.
    'thread/start': () => ({ thread: thread(started++ ? OTHER : T), model: 'gpt-5.5', reasoningEffort: null, approvalPolicy: 'on-request', sandbox: {} }),
    'config/read': () => ({ config: { mcp_servers: { docs: { command: 'docs-mcp' }, off: { command: 'x', enabled: false } } } }),
    'thread/resume': ({ threadId }) => ({ thread: thread(threadId), model: 'gpt-5.5', reasoningEffort: null, approvalPolicy: 'on-request', sandbox: {} }),
    'turn/start': () => ({ turn: { id: 'turn-1', items: [], itemsView: 'notLoaded', status: 'inProgress', error: null, startedAt: null, completedAt: null, durationMs: null } }),
    'mcpServerStatus/list': () => ({ data: [server('docs', { runtimeStatus: 'connected', tools: { search: {} } })], nextCursor: null }),
    'skills/list': () => ({ data: [{ cwd: CWD, skills: [skill('hello')], errors: [] }] }),
    'hooks/list': () => {
      // An older Codex without it.
      if (options.hooksFail) throw new Error('unknown variant `hooks/list`');
      return { data: [{ cwd: CWD, hooks: [hook({ command: 'echo hi' })], warnings: [], errors: [] }] };
    },
    'config/mcpServer/reload': () => ({}),
    'thread/name/set': () => ({}),
    'thread/compact/start': () => ({}),
    'turn/interrupt': () => ({}),
  });
  const driver = codexDriver({ server: fake, status: async () => ({ binary: '/fake/codex', version: '0.167.0', signedIn: true, account: null, login: null, problem: null }), live: () => ({ handle: () => {} }) });
  const session = await driver.start({ cwd: CWD, model: null, permissionMode: 'default' }, events());
  return { fake, driver, session };
}

describe("a Codex session's Tools, rename and compact", () => {
  it("lists the thread's own MCP connections, the folder's skills and the thread's hooks", async () => {
    const { fake, session } = await running();
    const caps = await session.capabilities();
    expect(caps).toMatchObject({ live: true, mcp: [{ name: 'docs', status: 'connected', tools: ['search'] }], commands: [{ name: 'hello' }], hooks: [{ command: 'echo hi' }] });
    expect(fake.calls.find((c) => c.method === 'mcpServerStatus/list')?.params).toEqual({ cursor: null, threadId: T, detail: 'toolsAndAuthOnly' });
    expect(fake.calls.find((c) => c.method === 'skills/list')?.params).toEqual({ cwds: [CWD] });
    expect(fake.calls.find((c) => c.method === 'hooks/list')?.params).toEqual({ threadId: T });
  });

  it('keeps the lists Codex gives when one fails', async () => {
    const { session } = await running({ hooksFail: true });
    expect(await session.capabilities()).toMatchObject({ mcp: [{ name: 'docs' }], commands: [{ name: 'hello' }], hooks: [] });
  });

  it("reconnects through Codex's MCP reload, and refuses to turn a server on or off", async () => {
    const { fake, session } = await running();
    await session.mcp('docs', 'reconnect');
    expect(fake.calls.at(-1)).toEqual({ method: 'config/mcpServer/reload', params: {} });
    await expect(session.mcp('docs', 'disable')).rejects.toThrow(MCP_TOGGLE_REFUSED);
    await expect(session.mcp('docs', 'enable')).rejects.toThrow(/config\.toml/);
    expect(fake.calls.filter((c) => c.method === 'config/mcpServer/reload')).toHaveLength(1);
  });

  it("refuses to reconnect while another session's turn runs, as it reconnects theirs too, and never resumes a crashed one for it", async () => {
    const { fake, driver, session } = await running();
    const other = await driver.start({ cwd: CWD, model: null, permissionMode: 'default' }, events());
    expect(other.sessionId).toBe(OTHER);
    await other.send('work', []);
    await expect(session.mcp('docs', 'reconnect')).rejects.toThrow(MCP_RECONNECT_BUSY);
    expect(MCP_RECONNECT_BUSY).toMatch(/every Codex session running here/);
    // Its own turn is no reason not to.
    fake.notify('turn/completed', { threadId: OTHER, turn: { id: 'turn-1', status: 'completed' } });
    await session.send('mine', []);
    await session.mcp('docs', 'reconnect');
    fake.exit();
    await expect(session.mcp('docs', 'reconnect')).rejects.toThrow(MCP_RECONNECT_NOT_LOADED);
    expect(fake.calls.some((c) => c.method === 'thread/resume')).toBe(false);
  });

  it("lists a crashed session's MCP servers from Codex's config, without starting them", async () => {
    const { fake, session } = await running();
    fake.exit();
    const caps = await session.capabilities();
    expect(caps.live).toBe(false);
    expect(caps.mcp).toEqual([expect.objectContaining({ name: 'docs', status: 'pending' }), expect.objectContaining({ name: 'off', status: 'disabled' })]);
    expect(fake.calls.some((c) => c.method === 'mcpServerStatus/list')).toBe(false);
    expect(fake.calls.find((c) => c.method === 'config/read')?.params).toEqual({ cwd: CWD });
    expect(fake.calls.find((c) => c.method === 'hooks/list')?.params).toEqual({ cwds: [CWD] });
  });

  it('renames the thread through Codex', async () => {
    const { fake, session } = await running();
    await session.rename!('Better name');
    expect(fake.calls.at(-1)).toEqual({ method: 'thread/name/set', params: { threadId: T, name: 'Better name' } });
  });

  it("runs /compact as Codex's compaction, not as a message, and resumes a crashed thread first", async () => {
    const { fake, session } = await running();
    expect((await session.commands()).map((c) => c.name)).toEqual(['compact']);
    const id = await session.send('/compact', []);
    expect(id).toMatch(/^codex-compact-/);
    expect(fake.calls.at(-1)).toEqual({ method: 'thread/compact/start', params: { threadId: T } });
    expect(fake.calls.some((c) => c.method === 'turn/start')).toBe(false);
    fake.notify('turn/completed', { threadId: T, turn: { id: 'c-1', status: 'completed' } });
    fake.exit();
    await session.send('/compact', []);
    expect(fake.calls.slice(-2).map((c) => c.method)).toEqual(['thread/resume', 'thread/compact/start']);
  });

  it('refuses /compact with instructions or an image, and steered into a running turn', async () => {
    const { fake, session } = await running();
    await expect(session.send('/compact keep the API notes', [])).rejects.toThrow(COMPACT_NO_INSTRUCTIONS);
    await expect(session.send('/compact', [{ data: 'aGk=', mediaType: 'image/png' } as never])).rejects.toThrow(COMPACT_NO_INSTRUCTIONS);
    await session.send('work', []);
    await expect(session.send('/compact', [], true)).rejects.toThrow(COMPACT_NOT_STEERED);
    expect(fake.calls.some((c) => c.method === 'thread/compact/start')).toBe(false);
    expect(fake.calls.filter((c) => c.method === 'turn/start')).toHaveLength(1);
  });

  it('stops a compaction asked for before Codex started its turn, as soon as it does', async () => {
    const { fake, session } = await running();
    await session.send('/compact', []);
    await session.interrupt();
    expect(fake.calls.some((c) => c.method === 'turn/interrupt')).toBe(false);
    fake.notify('turn/started', { threadId: T, turn: { id: 'c-1' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.calls.at(-1)).toEqual({ method: 'turn/interrupt', params: { threadId: T, turnId: 'c-1' } });
  });
});

describe("a Codex profile's rename and names", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  const home = () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'codex-tools-')));
    dirs.push(dir);
    return dir;
  };

  function adapter(codexHome: string, holders: number[]) {
    const fake = fakeAppServer({
      'thread/list': () => ({ data: [thread(T)], nextCursor: null }),
      'thread/name/set': ({ threadId, name }) => (fake.notify('thread/name/updated', { threadId, threadName: name }), {}),
    });
    const changed: string[] = [];
    const provider = codexProvider({
      profileId: 'codex-1',
      codexHome,
      userHome: codexHome,
      shellEnv: async () => ({ PATH: '/bin' }),
      binary: async () => ({ path: '/fake/codex', version: '0.167.0' }),
      createAppServer: () => fake,
      lockHolders: async (files) => new Map(files.map((file) => [file, holders])),
      onSessionChanged: (id) => changed.push(id),
    });
    return { fake, provider, changed };
  }

  it("renames a session that doesn't run here without loading it, and the list and the sidebar get the name", async () => {
    const { fake, provider, changed } = adapter(home(), []);
    expect((await provider.source.list())[0]).toMatchObject({ sessionId: T, summary: 'Prompt of 019a' });
    await provider.source.rename!(T, 'Better name');
    expect(fake.calls.at(-1)).toEqual({ method: 'thread/name/set', params: { threadId: T, name: 'Better name' } });
    expect(fake.calls.some((c) => c.method === 'thread/resume')).toBe(false);
    expect(changed).toEqual([T]);
    expect((await provider.source.list())[0]).toMatchObject({ summary: 'Better name', customTitle: 'Better name' });
  });

  it('refuses while another Codex has the session open', async () => {
    const codexHome = home();
    mkdirSync(join(codexHome, LOCK_DIR));
    writeFileSync(lockFile(codexHome, T), '');
    const { fake, provider } = adapter(codexHome, [999_999]);
    await expect(provider.source.rename!(T, 'Better name')).rejects.toThrow(/open in Codex CLI/);
    expect(fake.calls.some((c) => c.method === 'thread/name/set')).toBe(false);
  });

  it('shows a name Codex gives a thread by itself', async () => {
    const { fake, provider, changed } = adapter(home(), []);
    await provider.source.list();
    fake.notify('thread/name/updated', { threadId: T, threadName: 'Fix the login page' });
    expect(changed).toEqual([T]);
    expect((await provider.source.list())[0]).toMatchObject({ summary: 'Fix the login page' });
  });
});
