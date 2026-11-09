import { describe, expect, it } from 'vitest';
import type { Effort, PermissionMode, SessionHostInfo } from '@seshboard/protocol';
import type { TurnOutcome } from '../host/sessionHost.ts';
import type { StoredUpNext } from '../host/upNextStore.ts';
import type { DriverEvents, DriverSession, ProviderAdapter, ProviderDriver } from './provider.ts';
import { ProviderHosts, type ProviderHostsDeps } from './providerHosts.ts';

const ID = 'c0ffee00-0000-4000-8000-000000000002';

/** A provider whose driver records what it is asked, and lets the test end turns. */
function setup(stored: StoredUpNext[] = [], extra: Partial<ProviderHostsDeps> = {}) {
  const calls: string[] = [];
  let events: DriverEvents | undefined;
  const session: DriverSession = {
    sessionId: ID,
    send: async (text, _a, steer) => (calls.push(`${steer ? 'steer' : 'send'}:${text}`), 'm'),
    interrupt: async () => {
      calls.push('interrupt');
      // A stopped turn ends like any other.
      events!.state('idle');
    },
    setModel: async (m) => void calls.push(`model:${m}`),
    setMode: async (m) => void calls.push(`mode:${m}`),
    commands: async () => [{ name: 'review', description: 'Review the changes', argumentHint: '' }],
    capabilities: async () => ({ live: true, mcp: [], agents: [], commands: [], plugins: [] }),
    mcp: async (server, action) => void calls.push(`mcp:${action}:${server}`),
    setEffort: async (e) => void calls.push(`effort:${e}`),
    rename: async (title) => void calls.push(`rename:${title}`),
    rewind: async (id, dryRun) => (calls.push(`rewind:${id}:${dryRun}`), { canRewind: true, error: null, files: [], insertions: 0, deletions: 0 }),
    stopTask: async (id) => void calls.push(`stop:${id}`),
    respond: (id, decision) => void calls.push(`respond:${id}:${decision.behavior}`),
    close: async () => void calls.push('close'),
  };
  const driver: ProviderDriver = {
    modes: [
      { value: 'default', label: 'Ask', description: '' },
      { value: 'plan', label: 'Plan', description: '' },
    ],
    status: async () => ({ binary: '/c', version: null, signedIn: true, account: null, login: null, problem: null }),
    models: async () => [],
    commands: async () => [{ name: 'init', description: '', argumentHint: '' }],
    start: async (config, e) => ((events = e), calls.push(`start:${config.resume ?? 'new'}:${config.permissionMode}${config.effort ? `:${config.effort}` : ''}${config.readOnly ? ':read-only' : ''}`), session),
    dispose: async () => {},
  };
  const adapter = { id: 'copilot', profileId: 'work-copilot', home: '/c', driver } as unknown as ProviderAdapter;
  const saved = new Map<string, StoredUpNext[]>([[ID, stored]]);
  const settings = new Map<string, { model?: string | null; effort?: Effort | null; permissionMode?: PermissionMode }>();
  let busyElsewhere = false;
  const infos: SessionHostInfo[] = [];
  const turns: TurnOutcome[] = [];
  const hosts = new ProviderHosts({
    providers: () => [adapter],
    profileOf: () => 'work-copilot',
    sessionCwd: () => '/w',
    openElsewhere: async () => busyElsewhere,
    settings: { get: (id) => settings.get(id) ?? null, set: (id, c) => settings.set(id, { ...settings.get(id), ...c }) },
    upNext: { list: (id) => saved.get(id) ?? [], save: (id, m) => saved.set(id, [...m]) },
    onInfo: (info) => infos.push(info),
    onStream: () => {},
    onMessages: () => {},
    onPermission: () => {},
    onPermissionResolved: () => {},
    onTurnEnd: (_id, outcome) => turns.push(outcome),
    onCreated: () => {},
    log: () => {},
    ...extra,
  });
  const last = () => infos.at(-1)!;
  const turn = { start: () => events!.state('running'), end: () => events!.state('idle') };
  return { hosts, driver, calls, saved, settings, last, turn, turns, events: () => events!, elsewhere: (on: boolean) => (busyElsewhere = on) };
}

const send = (hosts: ProviderHosts, text: string, mode?: 'queue' | 'steer' | 'now') => hosts.send({ sessionId: ID, text, attachments: [], ...(mode ? { mode } : {}) });

describe('ProviderHosts MCP Apps', () => {
  const tools: Record<string, unknown> = {
    list_items: { annotations: { readOnlyHint: true } },
    create_item: { annotations: { title: 'Create item' } },
    delete_all: { _meta: { ui: { visibility: ['model'] } } },
  };
  const withApps = () => {
    const ran: string[] = [];
    const { hosts, driver } = setup();
    driver.mcpApps = {
      resource: async ({ uri, callId }) => [{ uri, mimeType: 'text/html;profile=mcp-app', text: `<p>${callId}</p>` }],
      tools: async () => tools,
      callTool: async ({ tool }) => (ran.push(tool), { content: [] }),
    };
    return { hosts, ran };
  };

  it("reads an app's page from its server", async () => {
    const { hosts } = withApps();
    expect(await hosts.mcpAppResource(ID, 'items', 'ui://items/list', 'call-1')).toEqual([{ uri: 'ui://items/list', mimeType: 'text/html;profile=mcp-app', text: '<p>call-1</p>' }]);
  });

  it('runs a read-only tool at once, asks first for one that changes things, and never runs one apps may not call', async () => {
    const { hosts, ran } = withApps();
    await hosts.mcpAppCall(ID, 'items', 'list_items', {}, false);
    await expect(hosts.mcpAppCall(ID, 'items', 'create_item', {}, false)).rejects.toMatchObject({ code: 'NEEDS_CONFIRMATION', message: 'Create item' });
    await hosts.mcpAppCall(ID, 'items', 'create_item', {}, true);
    await expect(hosts.mcpAppCall(ID, 'items', 'delete_all', {}, true)).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    await expect(hosts.mcpAppCall(ID, 'items', 'missing', {}, true)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(ran).toEqual(['list_items', 'create_item']);
  });

  it('says a provider without MCP Apps has none', async () => {
    const { hosts } = setup();
    await expect(hosts.mcpAppResource(ID, 'items', 'ui://items/list', null)).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });
});

describe('ProviderHosts session actions', () => {
  it('keeps the effort while it is not running and resumes with it; another model drops it', async () => {
    const { hosts, calls, settings, last } = setup();
    settings.set(ID, { model: 'gpt-5-mini' });
    await hosts.setEffort(ID, 'high');
    expect(calls).toEqual([]);
    await send(hosts, 'go on');
    expect(calls[0]).toBe(`start:${ID}:default:high`);
    expect(last().effort).toBe('high');
    await hosts.setEffort(ID, 'low');
    expect(calls.at(-1)).toBe('effort:low');
    await hosts.setModel(ID, 'gpt-5');
    expect(last().effort).toBeNull();
    expect(settings.get(ID)).toMatchObject({ model: 'gpt-5', effort: null });
  });

  it('starts without an effort when no model is picked (the provider\'s Auto has none)', async () => {
    const { hosts, calls } = setup();
    await hosts.create({ profileId: 'work-copilot', cwd: '/w', prompt: 'hi', attachments: [], model: null, effort: 'high' });
    expect(calls[0]).toBe('start:new:default');
  });

  it("asks the driver what a session not running here can use, read-only, else shows its commands only", async () => {
    const { hosts, driver } = setup();
    expect(await hosts.capabilities(ID, '/work')).toEqual({ live: false, mcp: [], agents: [], commands: [{ name: 'init', description: '', argumentHint: '' }], plugins: [] });
    const asked: string[] = [];
    driver.capabilities = async (cwd) => (asked.push(cwd), { live: true, mcp: [{ name: 'docs', status: 'pending', scope: null, tools: [], error: null, version: null }], agents: [], commands: [], plugins: [], mcpToggle: false });
    expect(await hosts.capabilities(ID, '/work')).toMatchObject({ live: false, mcp: [{ name: 'docs' }], mcpToggle: false });
    expect(asked).toEqual(['/work']);
    driver.capabilities = async () => Promise.reject(new Error('Codex is not installed'));
    expect((await hosts.capabilities(ID, '/work')).commands).toEqual([{ name: 'init', description: '', argumentHint: '' }]);
    // Once it runs here, its own lists.
    await send(hosts, 'hi');
    expect((await hosts.capabilities(ID, '/work')).live).toBe(true);
  });

  it('renames a running session through it, and leaves a stopped one to the source', async () => {
    const { hosts, calls } = setup();
    expect(await hosts.rename(ID, 'New name')).toBe(false);
    await send(hosts, 'hi');
    expect(await hosts.rename(ID, 'New name')).toBe(true);
    expect(calls.at(-1)).toBe('rename:New name');
  });

  it('rewinds once the turn is over, resuming the session first, and not while it is open elsewhere', async () => {
    const { hosts, calls, turn, elsewhere } = setup();
    elsewhere(true);
    await expect(hosts.rewind(ID, 'u1', true)).rejects.toMatchObject({ code: 'SESSION_BUSY_ELSEWHERE' });
    elsewhere(false);
    expect(await hosts.rewind(ID, 'u1', true)).toMatchObject({ canRewind: true });
    expect(calls).toEqual([`start:${ID}:default`, 'rewind:u1:true']);
    await send(hosts, 'more');
    turn.start();
    expect(await hosts.rewind(ID, 'u1', false)).toMatchObject({ canRewind: false, error: 'Wait until it finishes, then rewind.' });
    turn.end();
    await hosts.rewind(ID, 'u1', false);
    expect(calls.at(-1)).toBe('rewind:u1:false');
  });

  it('lets a read-only step only read: it answers each request itself, with the read-only rule', async () => {
    const { hosts, calls, events, last } = setup();
    await hosts.create({ profileId: 'work-copilot', cwd: '/w', prompt: 'Review it', attachments: [], model: null, readOnly: true });
    expect(calls[0]).toBe('start:new:default:read-only');
    const ask = (requestId: string, toolName: string, input: Record<string, string>) =>
      events().permission({ requestId, toolName, input, toolUseId: null, title: null, description: null, decisionReason: null, blockedPath: null, alwaysLabel: null, agentId: null, createdAt: 0 });
    ask('r1', 'Read', { file_path: '/w/a.ts' });
    ask('r2', 'Bash', { command: 'git diff --stat' });
    ask('r3', 'Edit', { file_path: '/w/a.ts', old_string: 'a', new_string: 'b' });
    ask('r4', 'Bash', { command: 'rm -rf build' });
    expect(calls.filter((c) => c.startsWith('respond:'))).toEqual(['respond:r1:allow', 'respond:r2:allow', 'respond:r3:deny', 'respond:r4:deny']);
    // Nobody was asked.
    expect(last().state).not.toBe('needs-you');
    expect(hosts.list().permissions).toEqual([]);
  });

  it('writes linked sessions\' briefs into what it sends, as for Claude Code, but not into a slash command', async () => {
    const warmed: string[] = [];
    const { hosts, calls, turn } = setup([], { links: { warm: async (text) => void warmed.push(text), expand: (id, text) => `${text}\n[brief for ${id}]` } });
    await hosts.create({ profileId: 'work-copilot', cwd: '/w', prompt: 'Carry on from @Plan', attachments: [], model: null });
    turn.end();
    await send(hosts, '/review src');
    expect(warmed).toEqual(['Carry on from @Plan', '/review src']);
    expect(calls).toEqual(['start:new:default', `send:Carry on from @Plan\n[brief for ${ID}]`, 'send:/review src']);
  });

  it('shows its background tasks and stops one', async () => {
    const { hosts, calls, last, events } = setup();
    await expect(hosts.stopTask(ID, 't1')).rejects.toMatchObject({ code: 'NOT_RUNNING' });
    await send(hosts, 'hi');
    const task = { taskId: 't1', type: 'local_bash', description: 'npm run dev', startedAt: 1 };
    events().tasks!([task]);
    expect(last().backgroundTasks).toEqual([task]);
    await hosts.stopTask(ID, 't1');
    expect(calls.at(-1)).toBe('stop:t1');
  });
});

describe('ProviderHosts Up next', () => {
  it('queues while a turn runs, sends the next when it ends, and steers or stops it on request', async () => {
    const { hosts, calls, saved, last, turn, turns } = setup();
    await hosts.create({ profileId: 'work-copilot', cwd: '/w', prompt: 'first', attachments: [], model: null, permissionMode: 'plan' });
    expect(calls).toEqual(['start:new:plan', 'send:first']);
    turn.start();
    expect((await send(hosts, 'second')).queued).toBe(true);
    expect(last().queue.map((q) => q.text)).toEqual(['second']);
    expect(saved.get(ID)!.map((q) => q.text)).toEqual(['second']);
    await send(hosts, 'join in', 'steer');
    expect(calls.at(-1)).toBe('steer:join in');

    turn.end();
    await Promise.resolve();
    expect(calls.at(-1)).toBe('send:second');
    expect(last().queue).toEqual([]);

    // Send now: the turn stops, the message goes first, and the turn's end says it was superseded.
    turn.start();
    await send(hosts, 'later');
    await send(hosts, 'urgent', 'now');
    await Promise.resolve();
    expect(calls.slice(-2)).toEqual(['interrupt', 'send:urgent']);
    expect(turns.at(-1)).toMatchObject({ stopped: true, superseded: true });
    expect(last().queue.map((q) => q.text)).toEqual(['later']);
  });

  it('holds Up next after Stop until resumed, and edits and reorders it', async () => {
    const { hosts, calls, last, turn } = setup();
    await hosts.create({ profileId: 'work-copilot', cwd: '/w', prompt: 'first', attachments: [], model: null });
    turn.start();
    await send(hosts, 'a');
    await send(hosts, 'b');
    const [a, b] = last().queue;
    hosts.moveQueued(ID, b!.id, 0);
    expect(last().queue.map((q) => q.text)).toEqual(['b', 'a']);
    expect(hosts.dequeue(ID, a!.id)).toEqual({ text: 'a', attachments: [] });

    await hosts.interrupt(ID);
    expect(last()).toMatchObject({ state: 'idle', queueHold: 'stopped' });
    expect(calls.at(-1)).toBe('interrupt');
    await hosts.resumeQueue(ID);
    expect(calls.at(-1)).toBe('send:b');
    expect(last().queueHold).toBeNull();
  });

  it('brings back what was waiting after a restart, held, and resumes in the last mode', async () => {
    const { hosts, calls, settings, last } = setup([{ id: 'q1', text: 'kept', attachments: [], createdAt: 1 }]);
    settings.set(ID, { permissionMode: 'plan' });
    await hosts.resumeQueue(ID);
    expect(calls).toEqual(['start:c0ffee00-0000-4000-8000-000000000002:plan', 'send:kept']);
    expect(last().queue).toEqual([]);
  });

  it('keeps a mode picked while not running for the next resume, and checks it is one the provider has', async () => {
    const { hosts, settings, calls } = setup();
    expect((await hosts.commands(ID)).map((c) => c.name)).toEqual(['init']);
    await hosts.setPermissionMode(ID, 'plan');
    expect(settings.get(ID)).toEqual({ permissionMode: 'plan' });
    await send(hosts, 'go');
    expect(calls[0]).toBe(`start:${ID}:plan`);
    await expect(hosts.setPermissionMode(ID, 'bypassPermissions')).rejects.toMatchObject({ code: 'INVALID' });
    // A running session's own commands; before that, a new session's.
    expect((await hosts.commands(ID)).map((c) => c.name)).toEqual(['review']);
    await hosts.setPermissionMode(ID, 'default');
    expect(calls.at(-1)).toBe('mode:default');
  });
});
