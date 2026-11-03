import { describe, expect, it } from 'vitest';
import { mergedMoves, type MergeCandidate } from './mergedDone.ts';

const MERGED_AT = 1_000;
const repo = (state: 'open' | 'merged' | 'closed' = 'merged', mergedAt: number | null = MERGED_AT) => ({ baseBranch: 'main', pullRequests: new Map([['feat/x', { number: 12, state, mergedAt }]]) });
const s = (id: string, over: Partial<MergeCandidate> = {}): MergeCandidate => ({ id, branch: 'feat/x', updatedAt: MERGED_AT - 100, listed: true, pinned: false, working: false, attention: false, openInApp: false, restoredAt: null, donePr: null, looseEnds: false, ...over });

describe('mergedMoves', () => {
  it('moves the newest session on the merged branch to Done, with the pull request', () => {
    expect(mergedMoves(repo(), [s('old', { updatedAt: 1 }), s('new')])).toEqual([{ sessionId: 'new', pr: 12 }]);
  });

  it('leaves open and closed pull requests, the default branch, and a merge without a time alone', () => {
    expect(mergedMoves(repo('open'), [s('a')])).toEqual([]);
    expect(mergedMoves(repo('closed'), [s('a')])).toEqual([]);
    expect(mergedMoves(repo('merged', null), [s('a')])).toEqual([]);
    expect(mergedMoves({ baseBranch: 'feat/x', pullRequests: repo().pullRequests }, [s('a')])).toEqual([]);
  });

  it('skips pinned, working, waiting, running in Seshboard, with loose ends left, and what is in Done already', () => {
    for (const over of [{ pinned: true }, { working: true }, { attention: true }, { openInApp: true }, { listed: false }, { looseEnds: true }] as Partial<MergeCandidate>[]) {
      expect(mergedMoves(repo(), [s('a', over)]), JSON.stringify(over)).toEqual([]);
    }
  });

  it('skips a session reopened or active after the merge, and never handles a merge twice, so Reopen sticks', () => {
    expect(mergedMoves(repo(), [s('a', { restoredAt: MERGED_AT + 1 })])).toEqual([]);
    expect(mergedMoves(repo(), [s('a', { updatedAt: MERGED_AT + 1 })])).toEqual([]);
    expect(mergedMoves(repo(), [s('a', { restoredAt: MERGED_AT - 10 })])).toEqual([{ sessionId: 'a', pr: 12 }]);
    // Reopened later (restoredAt is set again, and the merge is in donePr): never moved again.
    expect(mergedMoves(repo(), [s('a', { donePr: 12 })])).toEqual([]);
    // A newer pull request on the same branch is a new merge.
    expect(mergedMoves({ baseBranch: 'main', pullRequests: new Map([['feat/x', { number: 13, state: 'merged' as const, mergedAt: MERGED_AT }]]) }, [s('a', { donePr: 12 })])).toEqual([{ sessionId: 'a', pr: 13 }]);
  });

  it('moves the session a pipeline run started from, and leaves a run row of its own alone', () => {
    expect(mergedMoves(repo(), [s('parent', { branch: 'main' }), s('step')], (id) => (id === 'step' ? 'parent' : id))).toEqual([{ sessionId: 'parent', pr: 12 }]);
    expect(mergedMoves(repo(), [s('step')], () => 'run-1')).toEqual([]);
  });
});
