import { describe, expect, it } from 'vitest';
import { leftBehind, looseEndLines, rowLooseEnds } from './looseEndsText.ts';

describe('loose ends in words', () => {
  const git = [{ kind: 'uncommitted' as const, files: 3 }, { kind: 'unpushed' as const, commits: 1 }];

  it('lists git first, then an unsent message and a queued prompt', () => {
    expect(looseEndLines(rowLooseEnds(git, { draft: true, queued: true }))).toEqual(['3 files not committed', '1 commit not pushed', 'An unsent message', 'A queued prompt']);
    expect(looseEndLines([{ kind: 'checks-failing', pr: 12, failed: 2 }, { kind: 'pr-closed', pr: 9 }])).toEqual(['Checks failing on #12', '#9 closed without merging']);
  });

  it('says what is left in one short sentence for the Done toast', () => {
    expect(leftBehind([])).toBeNull();
    expect(leftBehind(git)).toBe('3 files not committed, 1 commit not pushed');
    expect(leftBehind(rowLooseEnds(git, { draft: true, queued: false }))).toBe('3 files not committed, 1 commit not pushed and 1 more');
  });
});
