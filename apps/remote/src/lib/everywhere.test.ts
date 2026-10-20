import { describe, expect, it } from 'vitest';
import type { RemoteProfileUsage, RemotePrompt, RemoteSession } from '@switchboard/protocol/remote-client';
import { fromKey, listKey, mergeSessions, mergeUsage, runOnDefault } from './everywhere.ts';
import { groupSessions, nextNeedsYou } from './groups.ts';
import { filterList } from './filter.ts';

const session = (id: string, over: Partial<RemoteSession> = {}): RemoteSession => ({ id, title: id, projectId: 'p', projectName: 'tideline', branch: null, status: 'idle', unread: false, updatedAt: 1, ...over }) as RemoteSession;
const prompt = (requestId: string, sessionId: string, createdAt = 1): RemotePrompt => ({ requestId, sessionId, toolName: 'Bash', input: {}, title: null, description: null, alwaysLabel: null, createdAt }) as RemotePrompt;
const usage = (id: string, name: string): RemoteProfileUsage => ({ profile: { id, name, color: 'yellow' }, usage: null, error: null }) as RemoteProfileUsage;

describe('every computer in one list', () => {
  it('keys each session and prompt by its computer, and keeps its own ids', () => {
    const merged = mergeSessions([
      { id: 'aa', sessions: { sessions: [session('s1')], prompts: [prompt('r1', 's1')] } },
      { id: 'bb', sessions: { sessions: [session('s1')], prompts: [] } },
    ]);
    expect(merged.sessions.map((s) => [s.id, s.computer, s.sessionId])).toEqual([
      ['aa:s1', 'aa', 's1'],
      ['bb:s1', 'bb', 's1'],
    ]);
    expect(merged.prompts[0]).toMatchObject({ requestId: 'aa:r1', sessionId: 'aa:s1', computer: 'aa', original: { requestId: 'r1', sessionId: 's1' } });
  });

  it('reads a key back', () => {
    expect(fromKey(listKey('a1b2', 'f00-ba:r'))).toEqual({ computer: 'a1b2', id: 'f00-ba:r' });
    expect(fromKey('nokey')).toBeNull();
    expect(fromKey(':s1')).toBeNull();
    expect(fromKey('aa:')).toBeNull();
  });

  it('groups, filters and finds the next that needs you across computers, even with the same ids', () => {
    const merged = mergeSessions([
      { id: 'aa', sessions: { sessions: [session('s1', { status: 'needs-you', updatedAt: 5 })], prompts: [prompt('r1', 's1', 5)] } },
      { id: 'bb', sessions: { sessions: [session('s1', { status: 'needs-you', updatedAt: 3 })], prompts: [prompt('r1', 's1', 3)] } },
    ]);
    expect(groupSessions(merged.sessions, 10)[0]!.sessions.map((s) => s.id)).toEqual(['aa:s1', 'bb:s1']);
    expect(filterList(merged, 'all', '').prompts.map((p) => p.requestId)).toEqual(['bb:r1', 'aa:r1']);
    expect(nextNeedsYou(merged, null)).toBe('bb:s1');
    expect(nextNeedsYou(merged, 'bb:s1')).toBe('aa:s1');
  });
});

describe('usage from every computer', () => {
  it('is the computer’s own with one computer', () => {
    const own = [usage('default', 'Default')];
    expect(mergeUsage([{ id: 'aa', name: 'mystic', usage: own }])).toBe(own);
  });

  it('names each profile after its computer, and its profile when it has more than one', () => {
    const merged = mergeUsage([
      { id: 'aa', name: 'mystic', usage: [usage('default', 'Default')] },
      { id: 'bb', name: 'studio', usage: [usage('default', 'Work'), usage('p2', 'Personal')] },
    ]);
    expect(merged?.map((u) => [u.profile.id, u.profile.name])).toEqual([
      ['aa:default', 'mystic'],
      ['bb:default', 'studio · Work'],
      ['bb:p2', 'studio · Personal'],
    ]);
  });

  it('waits for a first answer, and leaves out a computer that has none yet', () => {
    expect(mergeUsage([{ id: 'aa', name: 'mystic', usage: null }, { id: 'bb', name: 'studio', usage: null }])).toBeNull();
    expect(mergeUsage([{ id: 'aa', name: 'mystic', usage: null }, { id: 'bb', name: 'studio', usage: [usage('default', 'Default')] }])?.map((u) => u.profile.name)).toEqual(['studio']);
  });
});

describe('the computer New session starts on', () => {
  const computers = [
    { id: 'aa', connected: false },
    { id: 'bb', connected: true },
    { id: 'cc', connected: true },
  ];

  it('is the one asked for', () => {
    expect(runOnDefault(computers, 'aa', 'cc')).toBe('aa');
  });

  it('else the last one while it is connected, else the first connected one', () => {
    expect(runOnDefault(computers, null, 'cc')).toBe('cc');
    expect(runOnDefault(computers, 'gone', 'aa')).toBe('bb');
    expect(runOnDefault(computers, undefined, null)).toBe('bb');
  });

  it('with none connected, the last one or the first', () => {
    const away = computers.map((c) => ({ ...c, connected: false }));
    expect(runOnDefault(away, null, 'cc')).toBe('cc');
    expect(runOnDefault(away, null, null)).toBe('aa');
    expect(runOnDefault([], null, null)).toBeNull();
  });
});
