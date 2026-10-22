import { describe, expect, it } from 'vitest';
import { checkEvent, checkResult, checkSessions } from './computerData.ts';

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

describe('What another computer sends', () => {
  it('keeps the sessions this version can read, and counts the rest', () => {
    const checked = checkSessions({ sessions: [session('s1'), null, session('s2', { status: 'thinking' }), session('s3', { title: 7 })], prompts: [{ requestId: 'r1' }], runs: [{}] });
    expect(checked).toEqual({ ok: true, value: { sessions: [session('s1')], prompts: [], runs: [] }, dropped: 5 });
  });

  it('refuses a list that isn’t one, and says where, without the data', () => {
    const checked = checkResult('sessions.list', { sessions: 'secret', prompts: [] });
    expect(checked).toEqual({ ok: false, issue: expect.stringMatching(/^sessions: /) });
    expect(JSON.stringify(checked)).not.toContain('secret');
  });

  it('checks other answers and events whole', () => {
    expect(checkResult('projects.list', { projects: [{ id: 'aaaaaaaaaaaaaaaa', name: 'Web' }] })).toMatchObject({ ok: true, dropped: 0 });
    expect(checkResult('projects.list', { projects: [{ id: 'aaaaaaaaaaaaaaaa', name: null }] })).toMatchObject({ ok: false });
    expect(checkEvent('sessions.changed', { sessions: [null], prompts: [] })).toMatchObject({ ok: true, dropped: 1 });
    expect(checkEvent('upNext.changed', { sessionId: 's1', queue: 'x' })).toMatchObject({ ok: false });
    expect(checkEvent('nothing.like.this', {})).toBeNull();
  });
});
