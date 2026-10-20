import { describe, expect, it } from 'vitest';
import { changesSummary, diffLines } from './diff.ts';

describe('diffLines', () => {
  it('drops the file headers and keeps hunks, additions, removals and context', () => {
    const diff = ['diff --git a/x.ts b/x.ts', 'index 1..2 100644', '--- a/x.ts', '+++ b/x.ts', '@@ -1,3 +1,3 @@', ' keep', '-old', '+new', '\\ No newline at end of file', ''].join('\n');
    expect(diffLines(diff)).toEqual([
      { kind: 'hunk', text: '@@ -1,3 +1,3 @@' },
      { kind: 'context', text: 'keep' },
      { kind: 'del', text: 'old' },
      { kind: 'add', text: 'new' },
      { kind: 'note', text: 'No newline at end of file' },
    ]);
  });

  it('says when a file is binary', () => {
    expect(diffLines('diff --git a/a.png b/a.png\nBinary files /dev/null and b/a.png differ')).toEqual([{ kind: 'note', text: 'A binary file: no diff to show.' }]);
  });

  it('keeps a line that starts with the marker of a header inside a hunk', () => {
    expect(diffLines('@@ -1 +1 @@\n--- not a header\n+++ nor this')).toEqual([
      { kind: 'hunk', text: '@@ -1 +1 @@' },
      { kind: 'del', text: '-- not a header' },
      { kind: 'add', text: '++ nor this' },
    ]);
  });
});

describe('changesSummary', () => {
  it('adds up the lines', () => {
    expect(changesSummary([{ additions: 100, deletions: 30 }, { additions: 20, deletions: 10 }])).toBe('+120 −40 · 2 files');
    expect(changesSummary([{ additions: 1, deletions: 0 }])).toBe('+1 −0 · 1 file');
  });
});
