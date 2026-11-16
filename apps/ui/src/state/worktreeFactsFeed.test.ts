import { describe, expect, it } from 'vitest';
import { PENDING_FACTS, type WorktreeEntry, type WorktreeFacts, type WorktreeList } from '@seshboard/protocol/client';
import { addEarly, applyEarly, FRESH_MS, listIsFresh, pendingCount, PENDING_STALE_MS } from './worktreeFactsFeed.ts';

const entry = (name: string, head = `${name}-1`): WorktreeEntry => ({
  path: `/repo/${name}`,
  name,
  branch: name,
  head,
  isMain: false,
  isLocked: false,
  lockReason: null,
  missing: false,
  underClaudeDir: true,
  ...PENDING_FACTS,
  factsPending: true,
  upstream: null,
  lastActivity: null,
  sessions: [],
});
const list: WorktreeList = { root: '/repo', baseBranch: 'main', pullRequests: false, pullRequestsPending: true, worktrees: [entry('a'), entry('b')] };
const facts = (name: string, patch: Partial<WorktreeFacts> = {}): WorktreeFacts => ({ path: `/repo/${name}`, head: `${name}-1`, upstream: null, uncommitted: 2, ahead: 1, behind: 0, merged: false, unpushed: 1, pushed: false, unreadable: false, ...patch });

describe('late worktree facts', () => {
  it('puts what arrived while the list was read on it', () => {
    const early = addEarly(addEarly(undefined, { facts: [facts('a')] }), { pullRequests: { b: { number: 4, state: 'open', url: 'u' } } });
    const got = applyEarly(list, early);
    expect(got.worktrees[0]).toMatchObject({ name: 'a', uncommitted: 2, ahead: 1 });
    expect(got.worktrees[0]!.factsPending).toBeUndefined();
    // b still waits for its facts, but its pull request is in, and the list stops waiting for gh.
    expect(got.worktrees[1]).toMatchObject({ name: 'b', factsPending: true, pr: { number: 4 } });
    expect(got.pullRequests).toBe(true);
    expect(got.pullRequestsPending).toBeUndefined();
  });

  it('ignores a fact read at another HEAD, and settles the pull requests when gh could not answer', () => {
    const got = applyEarly(list, addEarly(addEarly(undefined, { facts: [facts('a', { head: 'moved' })] }), { pullRequests: null }));
    expect(got.worktrees[0]!.factsPending).toBe(true);
    expect(got.pullRequests).toBe(false);
    expect(got.pullRequestsPending).toBeUndefined();
  });

  it('leaves a list alone when nothing came early', () => {
    expect(applyEarly(list, undefined)).toBe(list);
  });

  it('counts what still waits, which goes down while facts arrive', () => {
    expect(pendingCount(list)).toBe(3);
    expect(pendingCount(applyEarly(list, addEarly(undefined, { facts: [facts('a')] })))).toBe(2);
    expect(pendingCount(applyEarly(list, addEarly(undefined, { facts: [facts('a'), facts('b')], pullRequests: null })))).toBe(0);
    expect(pendingCount(null)).toBe(0);
  });

  it('shows a read list for half a minute, but reads one that is still waiting for facts again after 15 seconds', () => {
    const done = applyEarly(list, addEarly(addEarly(undefined, { facts: [facts('a'), facts('b')] }), { pullRequests: null }));
    expect(listIsFresh(1_000, done, 1_000 + FRESH_MS - 1)).toBe(true);
    expect(listIsFresh(1_000, done, 1_000 + FRESH_MS)).toBe(false);
    expect(listIsFresh(1_000, list, 1_000 + PENDING_STALE_MS - 1)).toBe(true);
    expect(listIsFresh(1_000, list, 1_000 + PENDING_STALE_MS)).toBe(false);
  });
});
