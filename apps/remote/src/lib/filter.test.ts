import { describe, expect, it } from 'vitest';
import type { RemotePrompt, RemoteSession } from '@seshboard/protocol/remote-client';
import { filterCounts, filterList, matchesSearch, visibleFilter } from './filter.ts';

const session = (id: string, status: RemoteSession['status'], extra: Partial<RemoteSession> = {}): RemoteSession => ({
  id,
  title: `Session ${id}`,
  projectId: 'aaaaaaaaaaaaaaaa',
  projectName: 'Web',
  branch: null,
  status,
  updatedAt: 1,
  unread: false,
  pinned: false,
  model: null,
  permissionMode: null,
  profile: null,
  ...extra,
});
const prompt = (sessionId: string, createdAt: number): RemotePrompt => ({ requestId: `r-${sessionId}`, sessionId, toolName: 'Bash', input: { command: 'ls' }, title: null, description: null, alwaysLabel: null, createdAt });

describe('the list filter', () => {
  const list = {
    sessions: [session('a', 'needs-you'), session('b', 'needs-you'), session('c', 'working'), session('d', 'idle', { branch: 'fix/login', title: 'Tidy up' })],
    prompts: [prompt('b', 5), prompt('a', 9)],
  };

  it('counts what needs you and what works', () => {
    expect(filterCounts(list.sessions)).toEqual({ needsYou: 2, working: 1 });
  });

  it('falls back to All when a chip has nothing left', () => {
    expect(visibleFilter('working', { needsYou: 1, working: 0 })).toBe('all');
    expect(visibleFilter('needs-you', { needsYou: 0, working: 3 })).toBe('all');
    expect(visibleFilter('working', { needsYou: 0, working: 3 })).toBe('working');
  });

  it('shows prompts as cards, oldest first, and leaves their sessions out of the rows', () => {
    const shown = filterList(list, 'all', '');
    expect(shown.prompts.map((p) => p.sessionId)).toEqual(['b', 'a']);
    expect(shown.sessions.map((s) => s.id)).toEqual(['c', 'd']);
  });

  it('keeps only what the chip asks for', () => {
    expect(filterList(list, 'working', '')).toMatchObject({ prompts: [], sessions: [{ id: 'c' }] });
    expect(filterList(list, 'needs-you', '').sessions).toEqual([]);
    expect(filterList(list, 'needs-you', '').prompts).toHaveLength(2);
  });

  it('searches the title, the project and the branch', () => {
    expect(matchesSearch(list.sessions[3]!, 'login')).toBe(true);
    expect(matchesSearch(list.sessions[3]!, 'web tidy')).toBe(true);
    expect(matchesSearch(list.sessions[3]!, 'api')).toBe(false);
    expect(filterList(list, 'all', 'session a').prompts.map((p) => p.sessionId)).toEqual(['a']);
  });
});
