import { describe, expect, it } from 'vitest';
import type { RemoteArchivedSession } from '@seshboard/protocol/remote-client';
import { doneAgo, mergeDone, reopenLabel, searchDone } from './done.ts';

const session = (id: string, archivedAt: number, over: Partial<RemoteArchivedSession> = {}): RemoteArchivedSession => ({ id, title: id, projectId: 'p1', projectName: 'web', branch: null, updatedAt: archivedAt, archivedAt, inactive: false, profile: null, steps: 0, ...over });

describe('the Done page', () => {
  it('lists every computer’s sessions in Done, most recently done first, keyed by computer', () => {
    const merged = mergeDone([
      { computer: 'mac', sessions: [session('a', 30), session('b', 10)] },
      { computer: 'mini', sessions: [session('a', 20)] },
    ]);
    expect(merged.map((s) => s.key)).toEqual(['mac:a', 'mini:a', 'mac:b']);
    expect(merged[1]).toMatchObject({ id: 'a', computer: 'mini' });
  });

  it('searches titles, projects and branches, every word', () => {
    const list = mergeDone([{ computer: 'mac', sessions: [session('Fix the login form', 3, { branch: 'fix/login' }), session('Add dark mode', 2, { projectName: 'docs' })] }]);
    expect(searchDone(list, '').length).toBe(2);
    expect(searchDone(list, 'LOGIN').map((s) => s.id)).toEqual(['Fix the login form']);
    expect(searchDone(list, 'dark docs').map((s) => s.id)).toEqual(['Add dark mode']);
    expect(searchDone(list, 'dark web')).toEqual([]);
  });

  it('says when a pipeline’s sessions come back too', () => {
    expect(reopenLabel(0)).toBe('Reopen');
    expect(reopenLabel(1)).toBe('Reopen with its step');
    expect(reopenLabel(3)).toBe('Reopen with its 3 steps');
  });

  it('says when each went to Done', () => {
    expect(doneAgo(1_000, 1_000)).toBe('done just now');
    expect(doneAgo(0, 3 * 3_600_000)).toBe('done 3h ago');
  });
});
