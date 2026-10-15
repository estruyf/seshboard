import { describe, expect, it } from 'vitest';
import type { RemoteSession } from '@switchboard/protocol/remote-client';
import { fuzzyScore, paletteGroups, rankSessions, sessionScore } from './palette.ts';

const session = (id: string, title: string, change: Partial<RemoteSession> = {}): RemoteSession => ({
  id,
  title,
  projectId: '0123456789abcdef',
  projectName: 'tideline',
  branch: null,
  status: 'idle',
  updatedAt: 1,
  unread: false,
  pinned: false,
  model: null,
  permissionMode: null,
  ...change,
});

describe('fuzzyScore', () => {
  it('matches letters in order, and nothing else', () => {
    expect(fuzzyScore('pub', 'Publish the beta')).not.toBeNull();
    expect(fuzzyScore('ptb', 'Publish the beta')).not.toBeNull();
    expect(fuzzyScore('btp', 'Publish the beta')).toBeNull();
    expect(fuzzyScore('', 'anything')).toBe(0);
  });

  it('counts a run and the start of a word more than scattered letters', () => {
    expect(fuzzyScore('beta', 'Publish the beta')!).toBeGreaterThan(fuzzyScore('bta', 'Publish the beta')!);
    expect(fuzzyScore('the', 'Publish the beta')!).toBeGreaterThan(fuzzyScore('lis', 'Publish the beta')!);
    expect(fuzzyScore('pub', 'Publish')!).toBeGreaterThan(fuzzyScore('pub', 'A long title that ends in publish')!);
  });
});

describe('sessionScore', () => {
  it('matches the title, the project or the branch, every word somewhere', () => {
    const s = session('a', 'Fix the cache', { projectName: 'switchboard', branch: 'feat/remote' });
    expect(sessionScore(s, 'cache')).not.toBeNull();
    expect(sessionScore(s, 'switch')).not.toBeNull();
    expect(sessionScore(s, 'remote')).not.toBeNull();
    expect(sessionScore(s, 'cache remote')).not.toBeNull();
    expect(sessionScore(s, 'cache zebra')).toBeNull();
  });
});

describe('rankSessions', () => {
  it('puts the best match first', () => {
    const ranked = rankSessions([session('a', 'Update the readme'), session('b', 'Publish the beta')], 'beta');
    expect(ranked.map((s) => s.id)).toEqual(['b']);
  });

  it('puts what needs you first when the scores tie, then the most recent', () => {
    const ranked = rankSessions(
      [session('old', 'Tests', { updatedAt: 1 }), session('new', 'Tests', { updatedAt: 5 }), session('asks', 'Tests', { status: 'needs-you', updatedAt: 2 })],
      'tests',
    );
    expect(ranked.map((s) => s.id)).toEqual(['asks', 'new', 'old']);
    expect(rankSessions([session('a', 'x', { updatedAt: 3 }), session('b', 'y', { status: 'needs-you' })], '').map((s) => s.id)).toEqual(['b', 'a']);
  });
});

describe('paletteGroups', () => {
  const projects = [
    { id: '0123456789abcdef', name: 'tideline' },
    { id: 'fedcba9876543210', name: 'switchboard' },
  ];
  const actions = [
    { id: 'new', title: 'New session' },
    { id: 'read-all', title: 'Mark all as read' },
  ];

  it('lists sessions, the projects to start in, and the actions, leaving out empty groups', () => {
    const groups = paletteGroups({ sessions: [session('a', 'Publish the beta')], projects, actions, query: 'switch' });
    expect(groups.map((g) => g.label)).toEqual(['Start']);
    expect(groups[0]!.items[0]).toMatchObject({ kind: 'start', project: { name: 'switchboard' } });
    expect(paletteGroups({ sessions: [session('a', 'Publish the beta')], projects, actions, query: 'read' }).map((g) => g.label)).toEqual(['Actions']);
  });

  it('shows everything for an empty query', () => {
    const groups = paletteGroups({ sessions: [session('a', 'Publish the beta')], projects, actions, query: '' });
    expect(groups.map((g) => g.label)).toEqual(['Sessions', 'Start', 'Actions']);
    expect(groups[2]!.items.map((i) => i.id)).toEqual(['action:new', 'action:read-all']);
  });
});
