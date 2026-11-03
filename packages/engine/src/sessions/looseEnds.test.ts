import { describe, expect, it } from 'vitest';
import type { GitLooseEnd } from '@seshboard/protocol';
import { attributeLooseEnds, changedOwners, isCandidate, mergeLooseEnds, type BranchSession, type RepoFacts } from './looseEnds.ts';

const ROOT = '/work/app';
const WT = '/work/app/.claude/worktrees/feat-x';
const repo = (over: Partial<RepoFacts> = {}): RepoFacts => ({
  root: ROOT,
  baseBranch: 'main',
  checkouts: [
    { path: ROOT, branch: 'main', uncommitted: 0, unpushed: 0 },
    { path: WT, branch: 'feat/x', uncommitted: 0, unpushed: 0 },
  ],
  pullRequests: new Map(),
  failing: new Map(),
  ...over,
});
const session = (id: string, cwd: string, branch: string | null, updatedAt: number): BranchSession => ({ id, cwd, branch, updatedAt });
const asObject = (map: Map<string, GitLooseEnd[]>) => Object.fromEntries(map);

describe('attributeLooseEnds', () => {
  const sessions = [session('old-main', ROOT, 'main', 1), session('plan', WT, 'feat/x', 2), session('exec', WT, 'feat/x', 3), session('elsewhere', '/work/other', 'feat/x', 4)];

  it('gives uncommitted changes to the newest session on the checked-out branch in that checkout', () => {
    const found = attributeLooseEnds(repo({ checkouts: [{ path: ROOT, branch: 'main', uncommitted: 2, unpushed: 0 }, { path: WT, branch: 'feat/x', uncommitted: 3, unpushed: 0 }] }), sessions);
    expect(asObject(found)).toEqual({ 'old-main': [{ kind: 'uncommitted', files: 2 }], exec: [{ kind: 'uncommitted', files: 3 }] });
  });

  it('gives commits not pushed to the newest session on the branch, wherever it works, never on the default branch', () => {
    const found = attributeLooseEnds(repo({ checkouts: [{ path: ROOT, branch: 'main', uncommitted: 0, unpushed: 4 }, { path: WT, branch: 'feat/x', uncommitted: 0, unpushed: 2 }] }), sessions);
    expect(asObject(found)).toEqual({ elsewhere: [{ kind: 'unpushed', commits: 2 }] });
  });

  it('lets a merged pull request cancel "not pushed", and reads failing checks and a closed one', () => {
    const facts = (state: 'open' | 'merged' | 'closed') => repo({ checkouts: [{ path: WT, branch: 'feat/x', uncommitted: 0, unpushed: 2 }], pullRequests: new Map([['feat/x', { number: 12, state }]]), failing: new Map([['feat/x', { pr: 12, failed: 1 }]]) });
    expect(asObject(attributeLooseEnds(facts('merged'), sessions))).toEqual({});
    expect(asObject(attributeLooseEnds(facts('open'), sessions))).toEqual({ elsewhere: [{ kind: 'unpushed', commits: 2 }, { kind: 'checks-failing', pr: 12, failed: 1 }] });
    expect(asObject(attributeLooseEnds(facts('closed'), sessions))).toEqual({ elsewhere: [{ kind: 'unpushed', commits: 2 }, { kind: 'pr-closed', pr: 12 }] });
  });

  it('gives a pipeline step\'s loose ends to its run row', () => {
    const found = attributeLooseEnds(repo({ checkouts: [{ path: WT, branch: 'feat/x', uncommitted: 1, unpushed: 0 }] }), sessions.slice(0, 3), (id) => (id === 'exec' || id === 'plan' ? 'run-1' : id));
    expect(asObject(found)).toEqual({ 'run-1': [{ kind: 'uncommitted', files: 1 }] });
  });

  it('leaves a loose end nobody worked on alone, and a detached checkout too', () => {
    expect(asObject(attributeLooseEnds(repo({ checkouts: [{ path: WT, branch: 'feat/y', uncommitted: 1, unpushed: 3 }, { path: ROOT, branch: null, uncommitted: 2, unpushed: 0 }] }), sessions))).toEqual({});
  });
});

describe('mergeLooseEnds', () => {
  const before = new Map<string, GitLooseEnd[]>([['a', [{ kind: 'uncommitted', files: 1 }, { kind: 'unpushed', commits: 2 }]], ['b', [{ kind: 'pr-closed', pr: 3 }]]]);
  const found = new Map<string, GitLooseEnd[]>([['a', [{ kind: 'uncommitted', files: 4 }]]]);

  it('takes what was found when everything is known, and drops what is gone', () => {
    expect(Object.fromEntries(mergeLooseEnds(before, found, ['a', 'b'], { git: true, github: true }))).toEqual({ a: [{ kind: 'uncommitted', files: 4 }] });
  });

  it('keeps what GitHub decides when GitHub is unknown, and everything when git failed', () => {
    expect(Object.fromEntries(mergeLooseEnds(before, found, ['a', 'b'], { git: true, github: false }))).toEqual({ a: [{ kind: 'uncommitted', files: 4 }, { kind: 'unpushed', commits: 2 }], b: [{ kind: 'pr-closed', pr: 3 }] });
    expect(Object.fromEntries(mergeLooseEnds(before, found, ['a', 'b'], { git: false, github: false }))).toEqual(Object.fromEntries(before));
  });

  it('says whose loose ends changed', () => {
    expect(changedOwners(before, mergeLooseEnds(before, found, ['a', 'b'], { git: true, github: true })).sort()).toEqual(['a', 'b']);
    expect(changedOwners(before, before)).toEqual([]);
  });
});

describe('isCandidate', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = 100 * DAY;
  it('looks at listed sessions and those that went to Done by themselves lately, not those you marked done', () => {
    expect(isCandidate({ listed: true, archivedAt: null, updatedAt: 0, working: false }, now, 3)).toBe(true);
    expect(isCandidate({ listed: false, archivedAt: null, updatedAt: now - 4 * DAY, working: false }, now, 3)).toBe(true);
    expect(isCandidate({ listed: false, archivedAt: null, updatedAt: now - 7 * DAY, working: false }, now, 3)).toBe(false);
    expect(isCandidate({ listed: false, archivedAt: now - DAY, updatedAt: now - 2 * DAY, working: false }, now, 3)).toBe(false);
  });
});
