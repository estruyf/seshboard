import { describe, expect, it } from 'vitest';
import type { SessionSummary } from '@switchboard/protocol/client';
import { stubBrief } from '@switchboard/protocol/client';
import { briefPr, linkableSessions, linkDetail } from './sessionLinks.ts';

const session = (id: string, over: Partial<SessionSummary> = {}): SessionSummary => ({
  id,
  title: id,
  firstPrompt: null,
  customTitle: null,
  cwd: '/repo',
  projectRoot: '/repo',
  gitBranch: null,
  worktree: null,
  origin: 'app',
  createdAt: 1,
  updatedAt: 1,
  fileSize: 1,
  tag: null,
  pinned: false,
  archivedAt: null,
  restoredAt: null,
  viewedAt: null,
  unread: false,
  inApp: true,
  profileId: 'default',
  ...over,
});

const all = [
  session('self', { title: 'Hide tokens with the cost', updatedAt: 10 }),
  session('a', { title: 'Usage cost toggle', gitBranch: 'worktree-usage-cost', updatedAt: 5 }),
  session('b', { title: 'Usage limits card', worktree: { name: 'limits-card', branch: 'worktree-limits-card' }, updatedAt: 9 }),
  session('c', { title: 'Explain the cache', updatedAt: 8 }),
  session('d', { title: 'Docs for usage', projectRoot: '/other', updatedAt: 7 }),
  session('e', { title: 'Old spike', archivedAt: 20, updatedAt: 3 }),
  session('f', { title: 'Fix login', gitBranch: 'fix/usage-login', updatedAt: 2 }),
];
const ids = (list: SessionSummary[]) => list.map((s) => s.id);

describe('linkableSessions', () => {
  it('lists this project\'s most recent ones for a bare @, never this session', () => {
    expect(ids(linkableSessions(all, { selfId: 'self', root: '/repo', query: '' }))).toEqual(['b', 'c', 'a', 'f']);
  });

  it('matches titles first, then branches, then other projects', () => {
    expect(ids(linkableSessions(all, { selfId: 'self', root: '/repo', query: 'usage' }))).toEqual(['b', 'a', 'f', 'd']);
    expect(ids(linkableSessions(all, { selfId: 'self', root: '/repo', query: 'limits-card' }))).toEqual(['b']);
  });

  it('lists none for a path', () => {
    expect(linkableSessions(all, { selfId: 'self', root: '/repo', query: 'src/usage' })).toEqual([]);
    expect(linkableSessions(all, { selfId: 'self', root: '/repo', query: 'usage.ts' })).toEqual([]);
  });

  it('only lists an archived session by its full title', () => {
    expect(ids(linkableSessions(all, { selfId: 'self', root: '/repo', query: 'spike' }))).toEqual([]);
    expect(ids(linkableSessions(all, { selfId: 'self', root: '/repo', query: 'Old spike' }))).toEqual(['e']);
  });
});

describe('linkDetail', () => {
  it('says the branch and pull request, or why there is none', () => {
    expect(linkDetail(null)).toBeNull();
    expect(linkDetail({ gone: true, branch: null, pr: null })).toBe('This session is gone');
    expect(linkDetail({ gone: false, branch: null, pr: null })).toBe('No branch');
    expect(linkDetail({ gone: false, branch: 'worktree-usage-cost', pr: null })).toBe('worktree-usage-cost');
    expect(linkDetail({ gone: false, branch: 'worktree-usage-cost', pr: { number: 148, state: 'open', url: 'u' } })).toBe('worktree-usage-cost · #148');
  });
});

describe('briefPr', () => {
  it('reads the number of the brief\'s pull request', () => {
    expect(briefPr({ ...stubBrief('A', 'id'), fields: { 'pull request': '#148 open, base main, https://x/pull/148' } })).toBe(148);
    expect(briefPr({ ...stubBrief('A', 'id'), fields: { 'pull request': 'none yet' } })).toBeNull();
  });
});
