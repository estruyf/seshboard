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
import { ProviderSettings } from '../providerSettings.ts';
import { ProviderSources } from '../providerSources.ts';
import { claudeTool, copilotMessages, userText, type CopilotEvent } from './copilotEvents.ts';
import { copilotProvider } from './copilotProvider.ts';
import { copilotSessionSource } from './copilotSource.ts';

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

  it('maps Copilot tools onto the ones the transcript has cards for', () => {
    expect(claudeTool('bash', { command: 'ls', description: 'List' })).toEqual({ name: 'Bash', input: { command: 'ls', description: 'List' } });
    expect(claudeTool('edit', { path: '/a', old_str: 'x', new_str: 'y' })).toEqual({ name: 'Edit', input: { file_path: '/a', old_string: 'x', new_string: 'y' } });
    expect(claudeTool('view', { path: '/a', view_range: [1, 2] })).toEqual({ name: 'Read', input: { file_path: '/a' } });
    expect(claudeTool('apply_patch', '*** Begin Patch')).toEqual({ name: 'apply_patch', input: { input: '*** Begin Patch' } });
    expect(claudeTool('github-mcp-server-get_file_contents', { owner: 'o' })).toEqual({ name: 'github-mcp-server-get_file_contents', input: { owner: 'o' } });
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
});

describe('providers in the session index', () => {
  it('shows Copilot sessions only once allowed, and reads them through Copilot', async () => {
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
    const state = new Map<string, unknown>();
    const settings = new ProviderSettings({ get: (k) => state.get(k), set: (k, v) => state.set(k, v) }, [copilotProvider({ env: {}, home: root, folder: copilotDir })]);
    const source = new ProviderSources(new MultiProfileSource(() => [{ profileId: 'default', source: claude }]), () =>
      settings.allowedAdapters().map((p) => ({ provider: p.id, source: p.source })),
    );
    const db = openCacheDatabase(join(root, 'cache.sqlite'));
    const changes: SessionsChanged[] = [];
    const index = new SessionIndex({
      baseline: 0,
      db: db.db,
      source,
      projectsDirs: () => [
        { profileId: 'default', dir: projectsDir },
        ...settings.allowedAdapters().map((p) => ({ profileId: 'default', dir: p.folder, provider: p.files })),
      ],
      resolver: createProjectResolver('/nonexistent-home'),
      log: () => {},
      onChange: (c) => changes.push(c),
      onTranscriptChanged: () => {},
    });
    cleanups.push(() => db.close());

    await index.refresh();
    expect(index.snapshot().sessions.map((s) => s.id)).toEqual([CLAUDE_ID]);
    expect(settings.snapshot().providers).toEqual([{ id: 'copilot', name: 'GitHub Copilot', allowed: false, found: true, folder: copilotDir, resumeCommand: 'copilot --resume={sessionId}' }]);

    settings.setAllowed('copilot', true);
    await index.rootsChanged();
    const copilotSummary = index.get(ID);
    expect(copilotSummary).toMatchObject({ provider: 'copilot', title: 'Create test.json', updatedAt: Date.parse('2026-06-26T16:10:49.000Z') });
    expect(index.get(CLAUDE_ID)?.provider).toBeUndefined();
    expect(source.providerOf(ID)).toBe('copilot');
    expect((await source.messages(ID)).length).toBe(4);
    await expect(source.fork(ID, 'e3')).rejects.toThrow(/only available for Claude Code/);

    settings.setAllowed('copilot', false);
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
    const dir = tempDir();
    writeSession(dir, ID, EVENTS);
    const { files } = copilotProvider({ env: {}, home: dir, folder: dir });
    expect(files.sessionOf(`${ID}/events.jsonl`)).toEqual({ sessionId: ID, file: join(dir, ID, 'events.jsonl') });
    expect(files.sessionOf(`${ID}\\workspace.yaml`)).toEqual({ sessionId: ID, file: join(dir, ID, 'events.jsonl') });
    expect(files.sessionOf(`${ID}/checkpoints/1.md`)).toBeNull();
    expect([...files.files().keys()]).toEqual([ID]);
  });

  it('reads $COPILOT_HOME, else ~/.copilot', () => {
    expect(copilotProvider({ env: { COPILOT_HOME: '/c' }, home: '/h' }).folder).toBe(join('/c', 'session-state'));
    expect(copilotProvider({ env: {}, home: '/h' }).folder).toBe(join('/h', '.copilot', 'session-state'));
  });
});
