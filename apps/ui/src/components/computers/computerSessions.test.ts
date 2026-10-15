import { describe, expect, it } from 'vitest';
import type { Computer, RemoteMessage, RemoteSession, RemoteSessions } from '@switchboard/protocol/client';
import { appendMessages, applyStream, applyUpdate, computerLine, NOT_STREAMING, prependMessages, sessionGroups, toolLine, visibleMessages, waitingCount } from './computerSessions.ts';

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
    const computer: Computer = { id: 'c', name: 'Studio Mac', address: 'https://x', pairedAt: 1, state: 'offline', message: 'Studio Mac doesn’t answer.', retryAt: 31_000, version: null };
    expect(computerLine(computer, 1_000)).toBe('Studio Mac doesn’t answer. Trying again in 30s.');
    expect(computerLine({ ...computer, retryAt: 120_000 }, 0)).toBe('Studio Mac doesn’t answer. Trying again in 2 min.');
    expect(computerLine({ ...computer, state: 'connected', message: null })).toBe('Connected');
  });
});
