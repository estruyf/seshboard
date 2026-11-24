import { describe, expect, it } from 'vitest';
import { checkRemoteSessions, unreadableLine } from './remoteSessionsCheck.ts';

const session = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: id,
  projectId: 'aaaaaaaaaaaaaaaa',
  projectName: 'Web',
  branch: null,
  status: 'idle',
  updatedAt: 1,
  unread: false,
  pinned: false,
  model: null,
  permissionMode: null,
  profile: null,
  ...over,
});
const prompt = { requestId: 'r1', sessionId: 's1', toolName: 'Bash', input: {}, title: null, description: null, alwaysLabel: null, createdAt: 1 };

describe('checkRemoteSessions', () => {
  it('passes a list it can read, with fields an older version leaves out and values a newer one adds', () => {
    const list = { sessions: [session('s1'), session('s2', { status: 'thinking', workingSince: 5, extra: { new: true } })], prompts: [prompt] };
    expect(checkRemoteSessions(list)).toEqual({ list, dropped: 0 });
  });

  it('leaves out the entries the views can’t read, and counts them', () => {
    const checked = checkRemoteSessions({
      sessions: [null, session('s1'), session('s2', { title: { text: 'x' } }), session('s3', { profile: { name: 'Work' } }), session('s4', { background: [{ taskId: 1 }] })],
      prompts: [prompt, { ...prompt, createdAt: 'now' }],
      runs: [{ run: null, steps: [] }],
    });
    expect(checked?.list.sessions.map((s) => s.id)).toEqual(['s1']);
    expect(checked?.list.prompts).toEqual([prompt]);
    expect(checked?.list.runs).toEqual([]);
    expect(checked?.dropped).toBe(6);
  });

  it('keeps the orchestrators it can read, and counts the rest', () => {
    const orchestrator = { sessionId: 's1', createdAt: 1, workers: [{ sessionId: 's2', itemId: null, title: 'Fix it', startedAt: 2, pr: null }, { sessionId: null, itemId: 'q1', title: 'Then this', startedAt: 3 }] };
    const checked = checkRemoteSessions({ sessions: [session('s1')], prompts: [], orchestrators: [orchestrator, { sessionId: 's3', createdAt: 1, workers: [{ title: 7 }] }] });
    expect(checked?.list.orchestrators).toEqual([orchestrator]);
    expect(checked?.dropped).toBe(1);
    // A computer from before orchestrators sends none, and the list says none.
    expect(checkRemoteSessions({ sessions: [], prompts: [] })?.list).not.toHaveProperty('orchestrators');
  });

  it('refuses what isn’t a session list', () => {
    for (const value of [null, 'list', [], {}, { sessions: [] }, { sessions: {}, prompts: [] }, { sessions: [], prompts: [], runs: 'x' }, { sessions: [], prompts: [], orchestrators: 'x' }]) expect(checkRemoteSessions(value)).toBeNull();
  });
});

describe('unreadableLine', () => {
  it('says what was left out and what to do', () => {
    expect(unreadableLine('Studio', null)).toBe('Studio sent data this version of Seshboard can’t read. It may run an older or newer version. Update Seshboard on both computers.');
    expect(unreadableLine('Studio', 1)).toBe('Studio sent 1 item in its session list this version of Seshboard can’t read, so it isn’t shown. It may run an older or newer version. Update Seshboard on both computers.');
    expect(unreadableLine('', 2)).toMatch(/^The other computer sent 2 items in its session list .*, so they aren’t shown\./);
  });
});
