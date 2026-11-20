import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionsChanged } from '@seshboard/protocol';
import { createProjectResolver } from '../../claude/projectResolver.ts';
import type { SessionSource } from '../../claude/sessionSource.ts';
import { normaliseMessage } from '../../claude/transcript.ts';
import { openCacheDatabase } from '../../db/database.ts';
import { MultiProfileSource } from '../../profiles/profileSources.ts';
import { SessionIndex } from '../../sessions/sessionIndex.ts';
import { removeDir } from '../../util/removeDir.ts';
import { ProviderProfiles } from '../providerProfiles.ts';
import { ProviderSources } from '../providerSources.ts';
import { claudeTool, copilotMessages, copilotSubagent, userText, type CopilotEvent } from './copilotEvents.ts';
import { lockPids, liveStatusOf, openSessions } from './copilotInUse.ts';
import type { CopilotSdkClient } from './copilotDriver.ts';
import { copilotProvider } from './copilotProvider.ts';
import { copilotHome, copilotSessionSource } from './copilotSource.ts';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const tempDir = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-copilot-')));
  cleanups.push(() => removeDir(dir));
  return dir;
};

const ID = 'f36d4086-77a2-4363-877d-11c1ac0d7814';
const CLAUDE_ID = '11111111-1111-4111-8111-111111111111';

/** A short Copilot session as Copilot CLI writes it: a prompt, a reply with a tool call, its result, an exit. */
const EVENTS: CopilotEvent[] = [
  { type: 'session.start', id: 'e1', timestamp: '2026-06-26T16:10:42.297Z', data: { sessionId: ID, startTime: '2026-06-26T16:10:42.297Z', context: { cwd: '/work/demo', branch: 'main' } } },
  { type: 'system.message', id: 'e2', timestamp: '2026-06-26T16:10:42.300Z', data: { role: 'system', content: 'You are an AI assistant.' } },
  {
    type: 'user.message',
    id: 'e3',
    timestamp: '2026-06-26T16:10:42.845Z',
    data: { content: 'ignored <reminder>x</reminder>\n<userRequest>\nCreate a test.json file\n</userRequest>' },
  },
  {
    type: 'assistant.message',
    id: 'e4',
    timestamp: '2026-06-26T16:10:45.000Z',
    data: {
      model: 'gpt-5.3-codex',
      content: 'I will add it.',
      toolRequests: [
        { toolCallId: 'intent', name: 'report_intent', arguments: { intent: 'Creating file' } },
        { toolCallId: 'call1', name: 'create', arguments: { path: '/work/demo/test.json', file_text: '{}' } },
      ],
    },
  },
  { type: 'tool.execution_complete', id: 'e5', timestamp: '2026-06-26T16:10:46.000Z', data: { toolCallId: 'intent', success: true, result: { content: 'Intent logged' } } },
  { type: 'tool.execution_complete', id: 'e6', timestamp: '2026-06-26T16:10:47.000Z', data: { toolCallId: 'call1', success: false, error: { message: 'File already exists' } } },
  { type: 'assistant.message', id: 'e7', timestamp: '2026-06-26T16:10:48.000Z', data: { content: 'Inner step', parentToolCallId: 'task1' } },
  { type: 'assistant.message', id: 'e8', timestamp: '2026-06-26T16:10:49.000Z', data: { content: 'It already exists.', toolRequests: [] } },
  { type: 'session.shutdown', id: 'e9', timestamp: '2026-06-26T16:20:00.000Z', data: {} },
];

const jsonl = (events: CopilotEvent[]) => `${events.map((e) => JSON.stringify(e)).join('\n')}\n`;

function writeSession(dir: string, id: string, events: CopilotEvent[], yaml?: string) {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, 'events.jsonl'), jsonl(events));
  if (yaml) writeFileSync(join(dir, id, 'workspace.yaml'), yaml);
}

describe('copilotMessages', () => {
  it('turns prompts, replies and tool calls into transcript messages', () => {
    const messages = copilotMessages(EVENTS).map((m) => normaliseMessage(m));
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(messages[0]!.blocks).toEqual([{ type: 'text', text: 'Create a test.json file' }]);
    expect(messages[1]!.model).toBe('gpt-5.3-codex');
    // report_intent is Copilot's own status line, not work: neither the call nor its result shows.
    expect(messages[1]!.blocks).toEqual([
      { type: 'text', text: 'I will add it.' },
      { type: 'tool_use', id: 'call1', name: 'Write', input: { file_path: '/work/demo/test.json', content: '{}' }, truncated: false },
    ]);
    expect(messages[2]!.blocks).toEqual([{ type: 'tool_result', toolUseId: 'call1', isError: true, text: 'File already exists', truncated: false, images: [] }]);
    expect(messages[3]!.blocks).toEqual([{ type: 'text', text: 'It already exists.' }]);
  });

  it('shows the reply of an autopilot turn, which Copilot writes in task_complete', () => {
    const messages = copilotMessages([
      { type: 'assistant.message', id: 'a1', data: { content: '', toolRequests: [{ toolCallId: 'done', name: 'task_complete', arguments: { summary: 'Yes, it is `sdk-ts`.' } }] } },
      { type: 'tool.execution_complete', id: 'r1', data: { toolCallId: 'done', success: true, result: { content: 'Task completed: Yes, it is `sdk-ts`.' } } },
      // A message that says the same as its summary shows it once.
      { type: 'assistant.message', id: 'a2', data: { content: 'All done.', toolRequests: [{ toolCallId: 'done2', name: 'task_complete', arguments: { summary: 'All done.' } }] } },
    ]).map((m) => normaliseMessage(m));
    expect(messages.map((m) => m.blocks)).toEqual([[{ type: 'text', text: 'Yes, it is `sdk-ts`.' }], [{ type: 'text', text: 'All done.' }]]);
  });

  it('maps Copilot tools onto the ones the transcript has cards for', () => {
    expect(claudeTool('bash', { command: 'ls', description: 'List' })).toEqual({ name: 'Bash', input: { command: 'ls', description: 'List' } });
    expect(claudeTool('edit', { path: '/a', old_str: 'x', new_str: 'y' })).toEqual({ name: 'Edit', input: { file_path: '/a', old_string: 'x', new_string: 'y' } });
    expect(claudeTool('view', { path: '/a', view_range: [1, 2] })).toEqual({ name: 'Read', input: { file_path: '/a' } });
    expect(claudeTool('apply_patch', '*** Begin Patch')).toEqual({ name: 'apply_patch', input: { input: '*** Begin Patch' } });
    expect(claudeTool('github-mcp-server-get_file_contents', { owner: 'o' })).toEqual({ name: 'github-mcp-server-get_file_contents', input: { owner: 'o' } });
  });

  it("names an MCP server's tool as Claude Code does, so a visual draws", () => {
    expect(claudeTool('github-mcp-server-get_file_contents', { owner: 'o' }, { mcpServerName: 'github-mcp-server', mcpToolName: 'get_file_contents' })).toEqual({ name: 'mcp__github-mcp-server__get_file_contents', input: { owner: 'o' } });
    const code = '<svg viewBox="0 0 680 80"></svg>';
    const blocks = copilotMessages([
      { type: 'assistant.message', id: 'a1', data: { content: 'Here is the flow.', toolRequests: [{ toolCallId: 'v1', name: 'visualize-show_widget', mcpServerName: 'visualize', mcpToolName: 'show_widget', arguments: { title: 'flow', loading_messages: ['Drawing'], widget_code: code } }] } },
    ]).flatMap((m) => normaliseMessage(m).blocks);
    expect(blocks.find((b) => b.type === 'tool_use')).toMatchObject({ name: 'mcp__visualize__show_widget', input: { widget_code: code }, truncated: false });
  });

  it('keeps what was typed when there is no request wrapper', () => {
    expect(userText('Fix the build <reminder>\nctx\n</reminder>')).toBe('Fix the build');
    expect(userText('Plain prompt')).toBe('Plain prompt');
  });
});

describe('copilotSessionSource', () => {
  it('lists sessions with an events file, with the title, folder and last activity', async () => {
    const dir = tempDir();
    writeSession(dir, ID, EVENTS, ['id: ' + ID, 'cwd: /work/demo', 'branch: main', 'client_name: github/cli', 'name: Create test.json', 'created_at: 2026-06-26T16:10:42.299Z', 'updated_at: 2026-06-26T16:30:00.000Z'].join('\n'));
    // The desktop app's sessions have a folder but no events: left out.
    mkdirSync(join(dir, '22222222-2222-4222-8222-222222222222'));
    writeFileSync(join(dir, 'not-a-session.txt'), 'x');
    const source = copilotSessionSource(dir);
    const list = await source.list();
    expect(list).toEqual([
      {
        sessionId: ID,
        summary: 'Create test.json',
        firstPrompt: 'Create a test.json file',
        lastModified: Date.parse('2026-06-26T16:10:49.000Z'),
        fileSize: expect.any(Number),
        cwd: '/work/demo',
        gitBranch: 'main',
        createdAt: Date.parse('2026-06-26T16:10:42.299Z'),
        provider: 'copilot',
        origin: 'cli',
      },
    ]);
    expect((await source.messages(ID)).length).toBe(4);
    expect(await source.messages('../etc')).toEqual([]);
  });

  it('falls back to the events when there is no workspace.yaml', async () => {
    const dir = tempDir();
    writeSession(dir, ID, EVENTS);
    const info = await copilotSessionSource(dir).info(ID);
    expect(info).toMatchObject({ summary: 'Create a test.json file', cwd: '/work/demo', gitBranch: 'main', origin: 'unknown' });
  });

  it('takes the folder from a hook when there is no session.start and no workspace.yaml', async () => {
    const dir = tempDir();
    const hook: CopilotEvent = { type: 'hook.start', id: 'h1', timestamp: '2026-06-26T16:10:42.000Z', data: { hookType: 'postToolUse', input: { sessionId: ID, cwd: '/work/demo' } } };
    writeSession(dir, ID, [hook, ...EVENTS.slice(1)]);
    const info = await copilotSessionSource(dir).info(ID);
    expect(info).toMatchObject({ summary: 'Create a test.json file', cwd: '/work/demo' });
  });

  it('lists a session whose file starts mid-conversation, by your prompt after autopilot\'s empty ones', async () => {
    const dir = tempDir();
    const hook: CopilotEvent = { type: 'hook.start', id: 'h1', data: { hookType: 'postToolUse', input: { cwd: '/work/demo' } } };
    const nudge: CopilotEvent = { type: 'user.message', id: 'u1', timestamp: '2026-06-26T16:10:43.000Z', data: { content: '', transformedContent: 'Keep going', source: 'autopilot' } };
    const prompt: CopilotEvent = { type: 'user.message', id: 'u2', timestamp: '2026-06-26T16:11:00.000Z', data: { content: 'Pick up the next task' } };
    writeSession(dir, ID, [hook, nudge, EVENTS[7]!, prompt, EVENTS[7]!]);
    const info = await copilotSessionSource(dir).info(ID);
    expect(info).toMatchObject({ summary: 'Pick up the next task', cwd: '/work/demo' });
    expect(info?.firstPrompt).toBe('Pick up the next task');
  });

  it('still leaves out a session with only autopilot\'s empty nudges', async () => {
    const dir = tempDir();
    writeSession(dir, ID, [{ type: 'user.message', id: 'u1', data: { content: '', source: 'autopilot' } }]);
    expect(await copilotSessionSource(dir).info(ID)).toBeUndefined();
  });
});

describe('providers in the session index', () => {
  it('shows a Copilot profile\'s sessions, under that profile, and reads them through Copilot', async () => {
    const root = tempDir();
    const copilotDir = join(root, 'session-state');
    writeSession(copilotDir, ID, EVENTS, 'name: Create test.json\ncwd: /work/demo\n');
    const projectsDir = join(root, 'projects');
    mkdirSync(projectsDir);
    const claude: SessionSource = {
      list: async () => [{ sessionId: CLAUDE_ID, summary: 'A Claude session', lastModified: 1000, cwd: '/work/demo' }],
      info: async (id) => (id === CLAUDE_ID ? { sessionId: CLAUDE_ID, summary: 'A Claude session', lastModified: 1000, cwd: '/work/demo' } : undefined),
      messages: async () => [],
    };
    // The profiles Settings › Profiles has: none of Copilot's at first.
    let copilotProfiles: Array<{ id: string; provider: 'copilot'; home: string }> = [];
    // No `copilot` here: a test never starts the machine's own Copilot CLI.
    const providers = new ProviderProfiles(() => copilotProfiles, (p) => copilotProvider({ profileId: p.id, copilotHome: p.home, userHome: root, binary: async () => null }));
    const source = new ProviderSources(new MultiProfileSource(() => [{ profileId: 'default', source: claude }]), () =>
      providers.adapters().map((p) => ({ provider: p.id, profileId: p.profileId, source: p.source })),
    );
    const db = openCacheDatabase(join(root, 'cache.sqlite'));
    const changes: SessionsChanged[] = [];
    const index = new SessionIndex({
      baseline: 0,
      db: db.db,
      source,
      projectsDirs: () => [
        { profileId: 'default', dir: projectsDir },
        ...providers.adapters().map((p) => ({ profileId: p.profileId, dir: p.folder, provider: p.files })),
      ],
      resolver: createProjectResolver('/nonexistent-home'),
      log: () => {},
      onChange: (c) => changes.push(c),
      onTranscriptChanged: () => {},
    });
    cleanups.push(() => db.close());

    await index.refresh();
    expect(index.snapshot().sessions.map((s) => s.id)).toEqual([CLAUDE_ID]);

    copilotProfiles = [{ id: 'work-copilot', provider: 'copilot', home: root }];
    await index.rootsChanged();
    const copilotSummary = index.get(ID);
    expect(copilotSummary).toMatchObject({ provider: 'copilot', profileId: 'work-copilot', title: 'Create test.json', updatedAt: Date.parse('2026-06-26T16:10:49.000Z') });
    expect(index.get(CLAUDE_ID)?.provider).toBeUndefined();
    expect(source.providerOf(ID)).toBe('copilot');
    expect(source.profileOf(ID)).toBe('work-copilot');
    expect((await source.messages(ID)).length).toBe(4);
    // Forking goes through Copilot, which isn't installed here.
    await expect(source.fork(ID, 'e3')).rejects.toThrow(/Install GitHub Copilot CLI/);
    await expect(source.rename!(ID, 'New name')).rejects.toThrow(/Install GitHub Copilot CLI/);

    copilotProfiles = [];
    await index.rootsChanged();
    expect(index.get(ID)).toBeNull();
    expect(changes.at(-1)?.removed).toEqual([ID]);
  });
});

describe('copilotSessionSource without a prompt', () => {
  it('leaves out a session nothing was asked in yet', async () => {
    const dir = tempDir();
    writeSession(dir, ID, [EVENTS[0]!, EVENTS[8]!], 'cwd: /work/demo\nclient_name: github/autopilot\n');
    const source = copilotSessionSource(dir);
    expect(await source.list()).toEqual([]);
    expect(await source.info(ID)).toBeUndefined();
  });
});

describe('copilotProvider', () => {
  it('maps the files the watcher reports to their session', () => {
    const home = tempDir();
    const dir = join(home, 'session-state');
    writeSession(dir, ID, EVENTS);
    const { files } = copilotProvider({ profileId: 'p', copilotHome: home, userHome: home });
    expect(files.sessionOf(`${ID}/events.jsonl`)).toEqual({ sessionId: ID, file: join(dir, ID, 'events.jsonl') });
    expect(files.sessionOf(`${ID}\\workspace.yaml`)).toEqual({ sessionId: ID, file: join(dir, ID, 'events.jsonl') });
    expect(files.sessionOf(`${ID}/checkpoints/1.md`)).toBeNull();
    expect([...files.files().keys()]).toEqual([ID]);
  });

  it("reads through Copilot's API once its runtime runs, and the files before that", async () => {
    const home = tempDir();
    const dir = join(home, 'session-state');
    writeSession(dir, ID, EVENTS);
    const OTHER = '0f0f0f0f-0000-4000-8000-000000000002';
    writeSession(dir, OTHER, EVENTS);
    const asked: string[] = [];
    const client: CopilotSdkClient = {
      start: async () => {},
      stop: async () => {},
      getAuthStatus: async () => ({ isAuthenticated: true }),
      listModels: async () => [],
      createSession: () => Promise.reject(new Error('not here')),
      resumeSession: () => Promise.reject(new Error('not here')),
      // Copilot's own process: its lock never means open elsewhere.
      cliProcess: { pid: process.pid },
      rpc: {
        sessions: {
          fork: () => Promise.reject(new Error('not here')),
          readPersistedEvents: async ({ sessionId }) => (asked.push(sessionId), { events: [EVENTS[2]!], cursor: 'c', hasMore: false, cursorStatus: 'ok' }),
          checkInUse: async ({ sessionIds }) => ({ inUse: sessionIds.filter((id) => id === OTHER) }),
        },
      },
    };
    const adapter = copilotProvider({ profileId: 'p', copilotHome: home, userHome: home, createClient: async () => client, binary: async () => ({ path: '/fake/copilot', version: '1.0.90' }) });
    // Not running yet: the file, whole, and nothing open (no locks).
    const fromFile = (await adapter.source.messages(ID)).length;
    expect(fromFile).toBeGreaterThan(1);
    expect(await adapter.inUse!(OTHER)).toBe(false);
    expect(asked).toEqual([]);

    await adapter.driver!.status();
    expect(await adapter.source.messages(ID)).toHaveLength(1);
    expect(asked).toEqual([ID]);
    expect(await adapter.inUse!(OTHER)).toBe(true);
    expect(await adapter.inUse!(ID)).toBe(false);
    // Open in Copilot CLI: its status from the events on disk, its process from a lock when there is one.
    expect(await adapter.live!([ID, OTHER])).toEqual([{ sessionId: OTHER, pid: 0, status: 'idle', updatedAt: expect.any(Number) }]);
    expect(adapter.trashPaths!(ID)).toEqual([join(dir, ID)]);
    expect(adapter.trashPaths!('../etc')).toEqual([]);
    await adapter.driver!.dispose();
  });

  it('reads $COPILOT_HOME, else ~/.copilot', () => {
    expect(copilotHome({ COPILOT_HOME: '/c' }, '/h')).toBe('/c');
    expect(copilotHome({}, '/h')).toBe(join('/h', '.copilot'));
    expect(copilotProvider({ profileId: 'p', copilotHome: '/c', userHome: '/h' }).folder).toBe(join('/c', 'session-state'));
  });
});

describe('a session open in Copilot CLI', () => {
  it('reads working, waiting and idle from its last events', () => {
    const at = (type: string, data: Record<string, unknown> = {}): CopilotEvent => ({ type, data });
    expect(liveStatusOf([at('user.message'), at('assistant.turn_start')])).toBe('running');
    expect(liveStatusOf([at('assistant.turn_start'), at('permission.requested', { requestId: 'p' })])).toBe('needs-you');
    expect(liveStatusOf([at('assistant.turn_start'), at('permission.requested', { requestId: 'p' }), at('permission.completed', { requestId: 'p' })])).toBe('running');
    expect(liveStatusOf([at('assistant.turn_start'), at('session.idle')])).toBe('idle');
    // As on disk, where going idle isn't written: a turn that ends on a reply with tool calls goes on; one without ends.
    expect(liveStatusOf([at('assistant.turn_start'), at('assistant.message', { toolRequests: [{ toolCallId: 't' }] }), at('assistant.turn_end')])).toBe('running');
    expect(liveStatusOf([at('assistant.turn_start'), at('assistant.message', { content: 'Done.' }), at('assistant.turn_end'), at('hook.start')])).toBe('idle');
  });

  it('counts a lock only when its process is alive and not Seshboard\'s own copilot', () => {
    const dir = tempDir();
    writeSession(dir, ID, [...EVENTS.slice(0, 4), { type: 'assistant.turn_start', data: {} }]);
    writeFileSync(join(dir, ID, 'inuse.111.lock'), '');
    writeFileSync(join(dir, ID, 'inuse.222.lock'), '');
    const alive = (pid: number) => pid !== 222;
    // 111 is ours, 222 is gone: nobody else has it.
    expect(openSessions(dir, [ID], new Set([111]), alive)).toEqual([]);
    writeFileSync(join(dir, ID, 'inuse.333.lock'), '');
    expect(openSessions(dir, [ID], new Set([111]), alive)).toEqual([{ sessionId: ID, pid: 333, status: 'running', updatedAt: expect.any(Number) }]);
    expect(lockPids(join(dir, ID)).sort()).toEqual([111, 222, 333]);
  });
});

describe('a Copilot subagent', () => {
  it('reads its own steps by the tool call that started it, without the main conversation\'s', () => {
    const events: CopilotEvent[] = [
      { type: 'user.message', id: 'u1', data: { content: 'Explore the repo' } },
      { type: 'assistant.message', id: 'a1', data: { content: 'Asking an agent.', toolRequests: [{ toolCallId: 'task-1', name: 'task', arguments: { description: 'Explore', prompt: 'Look around', agent_type: 'explore' } }] } },
      { type: 'subagent.started', id: 's1', data: { toolCallId: 'task-1', agentName: 'explore', agentDisplayName: 'Explore agent', agentDescription: '' } },
      { type: 'assistant.message', id: 'x1', data: { parentToolCallId: 'task-1', content: 'Reading files.', toolRequests: [{ toolCallId: 'v1', name: 'view', arguments: { path: '/w/a.ts' } }] } },
      { type: 'tool.execution_complete', id: 'x2', data: { parentToolCallId: 'task-1', toolCallId: 'v1', success: true, result: { content: 'a' } } },
      // Another agent's step, and the main conversation going on.
      { type: 'assistant.message', id: 'y1', data: { parentToolCallId: 'task-2', content: 'Not this one.' } },
      { type: 'tool.execution_complete', id: 'r1', data: { toolCallId: 'task-1', success: true, result: { content: 'Done exploring' } } },
    ];
    const agent = copilotSubagent(events, 'task-1');
    expect(agent.agentType).toBe('Explore agent');
    expect(agent.messages.map((m) => m.uuid)).toEqual(['x1', 'x2']);
    expect(copilotMessages(events).map((m) => m.uuid)).toEqual(['u1', 'a1', 'r1']);
    expect(copilotSubagent(events, 'task-9')).toEqual({ agentType: null, messages: [] });
  });
});

describe('Seshboard\'s own throwaway sessions', () => {
  it('leaves an ephemeral one out (a fork Ask about this session asks), from the list and when read', async () => {
    const dir = join(tempDir(), 'session-state');
    writeSession(dir, ID, EVENTS);
    const claude: SessionSource = { list: async () => [], info: async () => undefined, messages: async () => [] };
    const ephemeral = new Set([ID]);
    const sources = new ProviderSources(new MultiProfileSource(() => [{ profileId: 'default', source: claude }]), () => [{ provider: 'copilot', profileId: 'p', source: copilotSessionSource(dir) }], (id) => ephemeral.has(id));
    expect(await sources.list()).toEqual([]);
    expect(await sources.info(ID)).toBeUndefined();
    ephemeral.clear();
    expect((await sources.list()).map((i) => i.sessionId)).toEqual([ID]);
  });
});
