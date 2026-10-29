import { describe, expect, it } from 'vitest';
import type { ChangedFile, GitChanges } from '@seshboard/protocol/client';
import { sameChanges } from './gitChangesRefresh.ts';

const file = (path: string, over: Partial<ChangedFile> = {}): ChangedFile => ({ path, status: 'modified', additions: 1, deletions: 0, staged: false, ...over });
const changes = (files: ChangedFile[], over: Partial<GitChanges> = {}): GitChanges => ({ root: '/work/app', branch: 'main', baseBranch: null, base: 'uncommitted', files, error: null, ...over });

describe('sameChanges', () => {
  it('is true for the same files, status and counts', () => {
    expect(sameChanges(changes([file('a.ts'), file('b.ts')]), changes([file('a.ts'), file('b.ts')]))).toBe(true);
    expect(sameChanges(null, null)).toBe(true);
  });

  it('sees a new file, an edit, a staged file and a branch switch', () => {
    const before = changes([file('a.ts')]);
    expect(sameChanges(before, changes([file('a.ts'), file('new.ts', { status: 'untracked' })]))).toBe(false);
    expect(sameChanges(before, changes([file('a.ts', { additions: 2 })]))).toBe(false);
    expect(sameChanges(before, changes([file('a.ts', { staged: true })]))).toBe(false);
    expect(sameChanges(before, changes([file('a.ts')], { branch: 'feature' }))).toBe(false);
    expect(sameChanges(before, null)).toBe(false);
  });
});
