import { describe, expect, it } from 'vitest';
import type { Computer, RemoteMessage, RemoteSession, RemoteSessions } from '@switchboard/protocol/client';
import { appendMessages, applyStream, applyUpdate, awayBanner, computerLine, inBackground, NOT_STREAMING, prependMessages, remoteItems, remoteTurns, sessionGroups, toolLine, toolsSummary, visibleMessages, waitingCount } from './computerSessions.ts';

const message = (uuid: string, text = uuid, extra: Partial<RemoteMessage> = {}): RemoteMessage => ({ uuid, role: 'assistant', timestamp: 1, parentToolUseId: null, blocks: [{ type: 'text', text }], ...extra });
const session = (id: string, status: RemoteSession['status']): RemoteSession => ({
  id,
  title: id,
  projectId: '0123456789abcdef',
  projectName: 'app',
  branch: null,
  status,
  updatedAt: 1,
  unread: false,
  pinned: false,
  model: null,
  permissionMode: null,
  profile: null,
});

describe('another computer’s conversation', () => {
  it('keeps each message once, the newer copy winning', () => {
    const merged = appendMessages([message('a'), message('b')], [message('b', 'b2'), message('c')]);
    expect(merged.map((m) => [m.uuid, (m.blocks[0] as { text: string }).text])).toEqual([['a', 'a'], ['b', 'b2'], ['c', 'c']]);
    expect(prependMessages([message('b')], [message('a'), message('b', 'old')]).map((m) => m.uuid)).toEqual(['a', 'b']);
    expect(applyUpdate([message('a')], { sessionId: 's', mode: 'replace', messages: [message('z')] }).map((m) => m.uuid)).toEqual(['z']);
  });

  it('follows what Claude is writing', () => {
    let streaming = applyStream(NOT_STREAMING, { sessionId: 's', kind: 'text', text: 'Hel' });
    streaming = applyStream(streaming, { sessionId: 's', kind: 'text', text: 'lo' });
    expect(streaming).toEqual({ kind: 'text', text: 'Hello' });
    expect(applyStream(streaming, { sessionId: 's', kind: 'clear', text: '' })).toBe(NOT_STREAMING);
  });

  it('shows the main conversation, not subagents or bare tool results', () => {
    const result = message('r', '', { blocks: [{ type: 'tool_result', toolUseId: 't', isError: false, text: 'ok', truncated: false }] });
    expect(visibleMessages([message('a'), message('sub', 'x', { parentToolUseId: 't' }), result]).map((m) => m.uuid)).toEqual(['a']);
  });

  it('sums a tool call up in one line', () => {
    expect(toolLine('Bash', { command: 'npm test\nmore', description: 'Run the tests' })).toBe('Run the tests');
    expect(toolLine('Read', { file_path: '/repo/src/a.ts' })).toBe('/repo/src/a.ts');
    expect(toolLine('Thing', {})).toBe('');
  });
});

describe('another computer’s list', () => {
  const list: RemoteSessions = {
    sessions: [session('idle', 'idle'), session('work', 'working'), session('asks', 'working'), session('needs', 'needs-you')],
    prompts: [{ requestId: 'r', sessionId: 'asks', toolName: 'Bash', input: {}, title: null, description: null, alwaysLabel: null, createdAt: 1 }],
  };

  it('puts what needs you first, then what works', () => {
    expect(sessionGroups(list).map((g) => [g.key, g.sessions.map((s) => s.id)])).toEqual([
      ['needs-you', ['asks', 'needs']],
      ['working', ['work']],
      ['recent', ['idle']],
    ]);
    expect(waitingCount(list)).toBe(2);
    expect(sessionGroups(null)).toEqual([]);
  });

  it('says how the connection is', () => {
    const computer: Computer = { id: 'c', name: 'Studio Mac', address: 'https://x', pairedAt: 1, state: 'offline', message: 'Studio Mac doesn’t answer.', retryAt: 31_000, version: null, features: [], lastSeen: null };
    expect(computerLine(computer, 1_000)).toBe('Studio Mac doesn’t answer. Trying again in 30s.');
    expect(computerLine({ ...computer, retryAt: 120_000 }, 0)).toBe('Studio Mac doesn’t answer. Trying again in 2 min.');
    expect(computerLine({ ...computer, state: 'connected', message: null })).toBe('Connected');
  });

  it('says why a remote session is away', () => {
    const computer = { name: 'mystic', state: 'offline' as const, retryAt: 31_000 };
    expect(awayBanner(computer, 1_000)).toBe('mystic is offline. Trying again in 30s.');
    expect(awayBanner({ ...computer, retryAt: null })).toBe('mystic is offline.');
    expect(awayBanner({ ...computer, state: 'connected' })).toBeNull();
    expect(awayBanner({ ...computer, state: 'unpaired' })).toBe('mystic no longer knows this computer. Pair it again.');
  });
});

describe('the remote transcript', () => {
  const tool = (id: string, name: string, input: unknown) => ({ type: 'tool_use' as const, id, name, input: input as never, truncated: false });

  it('folds consecutive tool calls into one item, across messages', () => {
    const messages: RemoteMessage[] = [
      message('u', 'Add a filter', { role: 'user' }),
      message('a1', '', { blocks: [tool('t1', 'Read', { file_path: '/p/a.ts' }), tool('t2', 'Read', { file_path: '/p/b.ts' })] }),
      message('r1', '', { role: 'user', blocks: [{ type: 'tool_result', toolUseId: 't2', isError: true, text: 'no', truncated: false }] }),
      message('a2', '', { blocks: [tool('t3', 'Edit', { file_path: '/p/a.ts', old_string: 'x', new_string: 'y\nz' })] }),
      message('a3', 'Done.'),
      message('a4', '', { blocks: [tool('t4', 'Bash', { command: 'npm test' })] }),
    ];
    const items = remoteItems(messages);
    expect(items.map((i) => i.kind)).toEqual(['user', 'tools', 'text', 'tools']);
    const first = items[1]!;
    expect(first.kind === 'tools' && first.tools.map((t) => [t.id, t.failed])).toEqual([
      ['t1', false],
      ['t2', true],
      ['t3', false],
    ]);
  });

  it('leaves out thinking, subagents and empty prompts', () => {
    const items = remoteItems([
      message('t', '', { blocks: [{ type: 'thinking', text: 'hmm' }] }),
      message('s', 'from an agent', { parentToolUseId: 'x' }),
      message('u', '  ', { role: 'user' }),
      message('p', 'Look', { role: 'user', device: 'Elio’s iPhone' }),
    ]);
    expect(items).toEqual([{ kind: 'user', key: 'p', text: 'Look', device: 'Elio’s iPhone', at: 1 }]);
  });

  it('shows lines from Claude Code as notices', () => {
    const items = remoteItems([message('n', 'Background command "Wait" failed with exit code 1', { role: 'system' }), message('e', '', { role: 'system', blocks: [] })]);
    expect(items).toEqual([{ kind: 'notice', key: 'n', text: 'Background command "Wait" failed with exit code 1' }]);
  });

  it('sums up a run of tool calls in one line', () => {
    const reads = ['ContentOverview.tsx', 'useItems.ts', 'a.ts', 'b.ts'].map((f) => ({ name: 'Read', input: { file_path: `/p/src/${f}` } }));
    const edit = { name: 'Edit', input: { file_path: '/p/src/ContentOverview.tsx', old_string: 'a\nb', new_string: 'a\nb\nc' } };
    expect(toolsSummary([...reads, edit])).toBe('Read 4 files · Edited ContentOverview.tsx +3 −2');
    expect(toolsSummary([reads[0]!])).toBe('Read ContentOverview.tsx');
    expect(toolsSummary([{ name: 'Bash', input: { command: 'npm test' } }])).toBe('Ran npm test');
    expect(toolsSummary([{ name: 'Bash', input: { command: 'a' } }, { name: 'Bash', input: { command: 'b' } }])).toBe('Ran 2 commands');
    expect(toolsSummary([{ name: 'Write', input: { file_path: '/p/new.ts', content: '1\n2' } }, { name: 'Edit', input: { file_path: '/p/old.ts', old_string: 'x', new_string: 'y' } }])).toBe('Edited 2 files +3 −1');
    expect(toolsSummary([{ name: 'Grep', input: { pattern: 'TODO' } }, { name: 'Glob', input: { pattern: '*.ts' } }, { name: 'TodoWrite', input: {} }])).toBe('Searched 2 times · Updated the to-do list');
    expect(toolsSummary([{ name: 'mcp__github__create_issue', input: {} }])).toBe('Used mcp__github__create_issue');
  });
});

describe('remoteTurns', () => {
  it('counts a turn’s tokens from the usage the computer sent, once per response', () => {
    const usage = { input: 10, output: 50, cacheRead: 1000, cacheWrite: 100 };
    const messages: RemoteMessage[] = [
      message('u1', 'Go', { role: 'user', timestamp: 1_000 }),
      message('a1', 'Looking.', { timestamp: 2_000, usage: { id: 'resp-1', ...usage } }),
      message('a2', 'Done.', { timestamp: 9_000, usage: { id: 'resp-1', ...usage } }),
      message('a3', 'Thanks.', { timestamp: 12_000, usage: { id: 'resp-2', ...usage } }),
    ];
    expect(remoteTurns(messages)[0]?.tokens?.total).toBe(2 * 1160);
  });

  it('times each turn from the messages, with no tokens when none were sent, keyed like the text items', () => {
    const tool = { type: 'tool_use' as const, id: 't1', name: 'Bash', input: {}, truncated: false };
    const messages: RemoteMessage[] = [
      message('u1', 'Fix it', { role: 'user', timestamp: 1_000 }),
      message('a1', '', { timestamp: 2_000, blocks: [tool] }),
      message('r1', '', { role: 'user', timestamp: 30_000, blocks: [{ type: 'tool_result', toolUseId: 't1', isError: false, text: 'ok', truncated: false }] }),
      message('a2', 'Fixed.', { timestamp: 49_000 }),
      message('u2', 'Thanks', { role: 'user', timestamp: 60_000 }),
    ];
    const turns = remoteTurns(messages);
    expect(turns.map((t) => [t.key, t.replyKey, t.durationMs, t.tokens])).toEqual([
      ['u1', 'a2:0', 48_000, null],
      ['u2', null, null, null],
    ]);
    const text = remoteItems(messages).find((i) => i.kind === 'text');
    expect(text?.key).toBe('a2:0');
  });
});

describe('inBackground', () => {
  it('is true while a task runs after the turn, also unread, and never while Claude works or waits', () => {
    const tasks = [{ taskId: 'b1', type: 'local_bash', description: 'gh run watch', startedAt: 1 }];
    expect(inBackground({ status: 'background', background: tasks })).toBe(true);
    expect(inBackground({ status: 'unread', background: tasks })).toBe(true);
    expect(inBackground({ status: 'idle', background: [] })).toBe(false);
    expect(inBackground({ status: 'working', background: tasks })).toBe(false);
    expect(inBackground({ status: 'needs-you', background: tasks })).toBe(false);
    // A computer from before the list.
    expect(inBackground({ status: 'background' })).toBe(true);
  });
});
