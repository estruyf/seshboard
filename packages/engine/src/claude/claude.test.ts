import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LiveRegistry, normaliseStatus, parseRegistryEntry } from './liveRegistry.ts';
import { originFromEntrypoint, readHead, readLastActivity } from './origin.ts';
import { createProjectResolver } from './projectResolver.ts';
import { clipJson, LIMITS, normaliseMessage } from './transcript.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const tempDir = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-claude-')));
  dirs.push(dir);
  return dir;
};

describe('normaliseMessage', () => {
  it('turns a plain user prompt into a text block', () => {
    const m = normaliseMessage({ type: 'user', uuid: 'u1', parent_tool_use_id: null, timestamp: '2026-10-05T10:00:00.000Z', message: { role: 'user', content: 'Fix the bug' } });
    expect(m).toEqual({ uuid: 'u1', role: 'user', timestamp: Date.parse('2026-10-05T10:00:00.000Z'), parentToolUseId: null, model: null, blocks: [{ type: 'text', text: 'Fix the bug' }], usage: null });
  });

  it('keeps the token counts Claude reported on assistant messages', () => {
    const m = normaliseMessage({
      type: 'assistant',
      uuid: 'a1',
      parent_tool_use_id: null,
      message: { role: 'assistant', content: [], usage: { input_tokens: 3, output_tokens: 40, cache_read_input_tokens: 45_000, cache_creation_input_tokens: 1_200 } },
    });
    expect(m.usage).toEqual({ input: 3, output: 40, cacheRead: 45_000, cacheCreation: 1_200 });
  });

  it('keeps which prompt cache a reply wrote to', () => {
    const m = normaliseMessage({
      type: 'assistant',
      uuid: 'a1',
      parent_tool_use_id: null,
      message: { role: 'assistant', content: [], usage: { input_tokens: 3, output_tokens: 40, cache_creation_input_tokens: 1_200, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1_200 } } },
    });
    expect(m.usage).toEqual({ input: 3, output: 40, cacheRead: 0, cacheCreation: 1_200, cacheTtl: '1h' });
  });

  it('keeps the response id, so a reply written as several messages counts once', () => {
    const m = normaliseMessage({
      type: 'assistant',
      uuid: 'a1',
      parent_tool_use_id: null,
      message: { id: 'msg_1', model: 'claude-opus-5-5', content: [], usage: { input_tokens: 3, output_tokens: 40 } },
    });
    expect(m.usage).toEqual({ input: 3, output: 40, cacheRead: 0, cacheCreation: 0, id: 'msg_1' });
  });

  it('has no usage for what Claude Code writes itself', () => {
    const m = normaliseMessage({
      type: 'assistant',
      uuid: 'a1',
      parent_tool_use_id: null,
      message: { id: 'msg_2', model: '<synthetic>', content: [{ type: 'text', text: 'API Error: Connection lost' }], usage: { input_tokens: 0, output_tokens: 0 } },
    });
    expect(m.usage).toBeNull();
  });

  it('keeps assistant text, thinking and tool calls, and clips long tool input', () => {
    const big = 'x'.repeat(LIMITS.toolInputString + 10);
    const m = normaliseMessage({
      type: 'assistant',
      uuid: 'a1',
      parent_tool_use_id: null,
      message: {
        model: 'claude-opus-5-5',
        content: [
          { type: 'thinking', thinking: 'Let me look' },
          { type: 'text', text: 'Writing the file.' },
          { type: 'tool_use', id: 't1', name: 'Write', input: { file_path: '/a.ts', content: big } },
          { type: 'some_future_block' },
        ],
      },
    });
    expect(m.model).toBe('claude-opus-5-5');
    expect(m.blocks.map((b) => b.type)).toEqual(['thinking', 'text', 'tool_use', 'unknown']);
    const tool = m.blocks[2];
    expect(tool).toMatchObject({ type: 'tool_use', id: 't1', name: 'Write', truncated: true });
    expect(tool?.type === 'tool_use' && (tool.input as { content: string }).content.length).toBe(LIMITS.toolInputString);
    expect(m.blocks[3]).toEqual({ type: 'unknown', kind: 'some_future_block' });
  });

  it('flattens tool results and clips long output', () => {
    const m = normaliseMessage({
      type: 'user',
      uuid: 'u2',
      parent_tool_use_id: 'parent',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 't1', is_error: true, content: [{ type: 'text', text: 'line 1' }, { type: 'image' }, { type: 'text', text: 'y'.repeat(LIMITS.toolResult) }] },
        ],
      },
    });
    expect(m.parentToolUseId).toBe('parent');
    expect(m.blocks[0]).toMatchObject({ type: 'tool_result', toolUseId: 't1', isError: true, truncated: true });
    expect(m.blocks[0]?.type === 'tool_result' && m.blocks[0].text.startsWith('line 1\n[image]\n')).toBe(true);
  });

  it('copes with unexpected shapes instead of throwing', () => {
    const m = normaliseMessage({ type: 'system', uuid: 's1', parent_tool_use_id: null, timestamp: 'not a date', message: { subtype: 'compact_boundary' } });
    expect(m.timestamp).toBeNull();
    expect(m.blocks).toEqual([{ type: 'unknown', kind: 'compact_boundary' }]);
  });
});

describe('images in transcripts', () => {
  it('turns inline images into references and hands their data to the sink', () => {
    const seen: Array<[string, string, string]> = [];
    const m = normaliseMessage(
      {
        type: 'user',
        uuid: 'u9',
        parent_tool_use_id: null,
        message: {
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
            { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'read it' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'BBBBBBBB' } }] },
          ],
        },
      },
      (id, type, data) => seen.push([id, type, data]),
    );
    expect(m.blocks[0]).toEqual({ type: 'image', mediaType: 'image/png', ref: { imageId: 'u9:0:-1', mediaType: 'image/png', bytes: 3 } });
    expect(m.blocks[1]).toMatchObject({ type: 'tool_result', text: 'read it\n[image]', images: [{ imageId: 'u9:1:1', mediaType: 'image/jpeg', bytes: 6 }] });
    expect(seen).toEqual([
      ['u9:0:-1', 'image/png', 'AAAA'],
      ['u9:1:1', 'image/jpeg', 'BBBBBBBB'],
    ]);
    // The transcript itself never carries image data.
    expect(JSON.stringify(m)).not.toContain('BBBBBBBB');
  });
});

describe('ImageStore', async () => {
  const { ImageStore } = await import('../sessions/imageStore.ts');
  it('serves images per session and evicts the least recently used past its budget', () => {
    const store = new ImageStore(10);
    const sink = store.sink('s1');
    sink('a', 'image/png', '1234');
    sink('b', 'image/png', '5678');
    expect(store.get('s1', 'a')?.data).toBe('1234');
    sink('c', 'image/png', '9999');
    expect(store.get('s1', 'b')).toBeUndefined();
    expect(store.get('s1', 'a')?.data).toBe('1234');
    expect(store.get('s2', 'a')).toBeUndefined();
  });
});

describe('clipJson', () => {
  it('drops undefined, non-finite numbers and over-deep nesting', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 30; i++) deep = [deep];
    const { value, truncated } = clipJson({ a: undefined, b: Infinity, c: deep }, 10);
    expect(value).not.toHaveProperty('a');
    expect((value as { b: unknown }).b).toBeNull();
    expect(truncated).toBe(true);
  });
});

describe('origin', () => {
  it('maps entrypoints to origins', () => {
    expect(originFromEntrypoint('cli')).toBe('cli');
    expect(originFromEntrypoint('claude-desktop')).toBe('desktop');
    expect(originFromEntrypoint('claude-vscode')).toBe('ide');
    expect(originFromEntrypoint('sdk-ts')).toBe('sdk');
    expect(originFromEntrypoint('switchboard')).toBe('app');
    expect(originFromEntrypoint(null)).toBe('unknown');
  });

  it('reads the entrypoint and folder from the head of a transcript', () => {
    const file = join(tempDir(), 's.jsonl');
    writeFileSync(file, '{"type":"queue-operation"}\n{"type":"user","entrypoint":"cli","cwd":"/x"}\n');
    expect(readHead(file)).toEqual({ entrypoint: 'cli', cwd: '/x' });
    expect(readHead(join(tempDir(), 'missing.jsonl'))).toEqual({ entrypoint: null, cwd: null });
  });

  it('finds the folder after a first prompt with a pasted image', () => {
    // Claude Code writes `cwd` after the message, far past the first 64 KB here.
    const file = join(tempDir(), 's.jsonl');
    const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(300_000) } };
    const user = { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'é' }, image] }, entrypoint: 'sdk-ts', cwd: '/work/app' };
    writeFileSync(file, `{"type":"queue-operation"}\n${JSON.stringify(user)}\n`);
    expect(readHead(file)).toEqual({ entrypoint: 'sdk-ts', cwd: '/work/app' });
  });

  it('reads the last message time, ignoring what Claude Code appends on exit', () => {
    const file = join(tempDir(), 's.jsonl');
    const records = [
      { type: 'user', timestamp: '2026-10-05T10:00:00.000Z', message: { content: 'hi' } },
      { type: 'assistant', timestamp: '2026-10-05T10:00:05.000Z', message: { content: [{ type: 'text', text: 'hello' }] } },
      { type: 'system', subtype: 'stop_hook_summary', timestamp: '2026-10-05T10:00:06.000Z' },
      { type: 'pr-link', timestamp: '2026-10-05T11:00:00.000Z' },
      { type: 'last-prompt', lastPrompt: 'hi' },
      { type: 'cost-state', totalCostUSD: 0.01 },
    ];
    writeFileSync(file, `${records.map((r) => JSON.stringify(r)).join('\n')}\n`);
    expect(readLastActivity(file)).toBe(Date.parse('2026-10-05T10:00:06.000Z'));
    // A last record bigger than the first read is still found.
    writeFileSync(file, `${JSON.stringify(records[0])}\n${JSON.stringify({ type: 'user', timestamp: '2026-10-05T12:00:00.000Z', text: 'x'.repeat(200_000) })}\n{"type":"cost-state"}\n`);
    expect(readLastActivity(file)).toBe(Date.parse('2026-10-05T12:00:00.000Z'));
    writeFileSync(file, '{"type":"cost-state"}\n');
    expect(readLastActivity(file)).toBeNull();
    expect(readLastActivity(join(tempDir(), 'missing.jsonl'))).toBeNull();
  });
});

describe('project resolver', () => {
  it('groups a nested folder under its git root and reads the branch', () => {
    const repo = tempDir();
    mkdirSync(join(repo, '.git'));
    writeFileSync(join(repo, '.git', 'HEAD'), 'ref: refs/heads/feature/x\n');
    mkdirSync(join(repo, 'src', 'deep'), { recursive: true });
    const resolver = createProjectResolver('/nonexistent-home');
    const location = resolver.resolve(join(repo, 'src', 'deep'));
    expect(location).toEqual({ root: repo, gitDir: join(repo, '.git'), worktree: null });
    expect(resolver.branch(location)).toBe('feature/x');
  });

  it('folds a linked worktree into its main repository', () => {
    const repo = tempDir();
    const wtGitDir = join(repo, '.git', 'worktrees', 'my-wt');
    mkdirSync(wtGitDir, { recursive: true });
    writeFileSync(join(wtGitDir, 'HEAD'), 'ref: refs/heads/worktree-my-wt\n');
    const wt = join(repo, '.claude', 'worktrees', 'my-wt');
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, '.git'), `gitdir: ${wtGitDir}\n`);
    const resolver = createProjectResolver('/nonexistent-home');
    const location = resolver.resolve(wt);
    expect(location.root).toBe(repo);
    expect(location.worktree).toEqual({ name: 'my-wt', path: wt });
    expect(resolver.branch(location)).toBe('worktree-my-wt');
  });

  it('still recognises a deleted Claude worktree by its path', () => {
    const location = createProjectResolver('/nonexistent-home').resolve('/gone/repo/.claude/worktrees/old-wt/src');
    expect(location).toEqual({ root: '/gone/repo', gitDir: null, worktree: { name: 'old-wt', path: '/gone/repo/.claude/worktrees/old-wt' } });
  });

  it('does not treat a git repo in the home folder as the root of everything below it', () => {
    const home = tempDir();
    mkdirSync(join(home, '.git'));
    mkdirSync(join(home, 'notes'));
    const resolver = createProjectResolver(home);
    expect(resolver.resolve(join(home, 'notes'))).toEqual({ root: join(home, 'notes'), gitDir: null, worktree: null });
    expect(resolver.resolve(home).root).toBe(home);
  });
});

describe('live registry', () => {
  it('normalises statuses', () => {
    expect(normaliseStatus('busy')).toBe('running');
    expect(normaliseStatus('idle')).toBe('idle');
    expect(normaliseStatus('waiting')).toBe('needs-you');
    expect(normaliseStatus('requires_action')).toBe('needs-you');
    expect(normaliseStatus('something-new')).toBe('running');
  });

  it('parses an entry and rejects junk', () => {
    const entry = parseRegistryEntry(
      { pid: 42, sessionId: 's1', cwd: '/repo/app', status: 'busy', name: 'Fix tests', entrypoint: 'cli', startedAt: 1, statusUpdatedAt: 2 },
      () => '/repo',
    );
    expect(entry).toEqual({ sessionId: 's1', pid: 42, cwd: '/repo/app', projectRoot: '/repo', status: 'running', rawStatus: 'busy', name: 'Fix tests', origin: 'cli', startedAt: 1, updatedAt: 2, profileId: 'default' });
    expect(parseRegistryEntry({ sessionId: 's1' }, () => null)).toBeNull();
    expect(parseRegistryEntry('nope', () => null)).toBeNull();
  });

  it('leaves out sessions it is told to ignore', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '1.json'), JSON.stringify({ pid: 1, sessionId: 'helper', status: 'busy' }));
    writeFileSync(join(dir, '2.json'), JSON.stringify({ pid: 2, sessionId: 'real', status: 'idle' }));
    const registry = new LiveRegistry({ dir, resolveRoot: () => null, isAlive: () => true, ignore: (id) => id === 'helper', onChange: () => {} });
    registry.scan();
    expect(registry.list().map((l) => l.sessionId)).toEqual(['real']);
  });

  it('lists only live processes and reports changes once', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '1.json'), JSON.stringify({ pid: 1, sessionId: 'alive', status: 'idle' }));
    writeFileSync(join(dir, '2.json'), JSON.stringify({ pid: 2, sessionId: 'dead', status: 'busy' }));
    writeFileSync(join(dir, '3.json'), '{ half written');
    const changes: string[][] = [];
    const registry = new LiveRegistry({ dir, resolveRoot: () => null, isAlive: (pid) => pid === 1, onChange: (live) => changes.push(live.map((l) => l.sessionId)) });
    registry.scan();
    registry.scan();
    expect(changes).toEqual([['alive']]);
    writeFileSync(join(dir, '1.json'), JSON.stringify({ pid: 1, sessionId: 'alive', status: 'busy' }));
    registry.scan();
    expect(changes).toHaveLength(2);
    expect(registry.list()[0]?.status).toBe('running');
  });
});
