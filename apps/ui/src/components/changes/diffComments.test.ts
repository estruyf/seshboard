import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from '../../lib/unifiedDiff.ts';
import { anchorOf, MAX_QUOTED_LINES, reviewDraft, reviewSummary, targetFromRows, type DiffComment } from './diffComments.ts';

const diff = ['@@ -10,4 +10,4 @@ function login()', ' const a = 1;', '-const b = 2;', '+const b = 3;', '+const c = 4;', ' return a;', '-old();'].join('\n');
const rows = parseUnifiedDiff(diff);

const comment = (over: Partial<DiffComment> = {}): DiffComment => ({ id: 'c1', root: '/repo', path: 'src/auth.ts', side: 'new', start: 11, end: 12, lines: [], body: 'Why 3?', ...over });

describe('targetFromRows', () => {
  it('counts lines of the file as it is now, and quotes deleted lines between them', () => {
    // Rows: 0 hunk, 1 same, 2 del, 3 add, 4 add, 5 same, 6 del.
    expect(targetFromRows(rows, 1, 3)).toEqual({
      side: 'new',
      start: 10,
      end: 11,
      lines: [
        { kind: 'same', text: 'const a = 1;' },
        { kind: 'del', text: 'const b = 2;' },
        { kind: 'add', text: 'const b = 3;' },
      ],
    });
  });

  it('puts deleted lines alone on the old side, picked either way round', () => {
    expect(targetFromRows(rows, 2, 2)).toMatchObject({ side: 'old', start: 11, end: 11 });
    expect(targetFromRows(rows, 6, 6)).toMatchObject({ side: 'old', start: 13, end: 13 });
    expect(targetFromRows(rows, 4, 3)).toMatchObject({ side: 'new', start: 11, end: 12 });
  });

  it('leaves out hunk headers, and has nothing for them alone', () => {
    expect(targetFromRows(rows, 0, 1)?.lines).toHaveLength(1);
    expect(targetFromRows(rows, 0, 0)).toBeNull();
  });
});

describe('anchorOf', () => {
  const target = targetFromRows(rows, 3, 4)!;

  it('finds the lines where they are', () => {
    expect(anchorOf(target, rows)).toEqual({ first: 3, last: 4, start: 11, end: 12 });
  });

  it('follows lines that moved, with their new numbers', () => {
    const moved = parseUnifiedDiff(['@@ -1,2 +1,5 @@', '+import x;', '+', ' const a = 1;', '+const b = 3;', '+const c = 4;'].join('\n'));
    expect(anchorOf(target, moved)).toEqual({ first: 4, last: 5, start: 4, end: 5 });
  });

  it('picks the nearest copy when the lines are in more than one place', () => {
    const twice = parseUnifiedDiff(['@@ -1,0 +1,2 @@', '+const b = 3;', '+const c = 4;', '@@ -20,0 +12,2 @@', '+const b = 3;', '+const c = 4;'].join('\n'));
    expect(anchorOf(target, twice)?.start).toBe(12);
  });

  it('is stale once the text is gone, and a deleted line matches only a deleted one', () => {
    expect(anchorOf(target, parseUnifiedDiff('@@ -1 +1 @@\n+const b = 30;'))).toBeNull();
    const deleted = targetFromRows(rows, 2, 2)!;
    expect(anchorOf(deleted, parseUnifiedDiff('@@ -1 +1 @@\n+const b = 2;'))).toBeNull();
    expect(anchorOf(deleted, parseUnifiedDiff('@@ -5 +5 @@\n-const b = 2;'))).toEqual({ first: 1, last: 1, start: 5, end: 5 });
  });

  it('takes an unchanged line for an added one, as in the diff against the base', () => {
    expect(anchorOf(target, parseUnifiedDiff('@@ -7,2 +7,2 @@\n const b = 3;\n const c = 4;'))).toMatchObject({ start: 7, end: 8 });
  });
});

describe('reviewDraft', () => {
  it('puts every comment in one item, in the order of files and lines, each with its file, lines and code', () => {
    const comments = [
      comment({ id: 'b', path: 'src/z.ts', start: 3, end: 3, lines: [{ kind: 'add', text: 'z()' }], body: 'Rename.' }),
      comment({ id: 'a', start: 11, end: 12, lines: targetFromRows(rows, 3, 4)!.lines, body: '  Why 3?\n' }),
      comment({ id: 'c', side: 'old', start: 13, end: 13, lines: [{ kind: 'del', text: 'old();' }], body: 'Keep this.' }),
    ];
    const { text, item } = reviewDraft(comments, (c) => `pkg/${c.path}`);
    expect(text).toBe('Address my review comments on the changes, one by one.');
    expect(item).toMatchObject({ kind: 'text', source: 'review', label: 'Review: 3 comments on 2 files', language: 'markdown' });
    expect(item.text).toBe(
      [
        '## pkg/src/auth.ts, lines 11-12',
        '',
        '```diff',
        '+const b = 3;',
        '+const c = 4;',
        '```',
        '',
        'Why 3?',
        '',
        '## pkg/src/auth.ts, deleted line 13 (numbered as before the change)',
        '',
        '```diff',
        '-old();',
        '```',
        '',
        'Keep this.',
        '',
        '## pkg/src/z.ts, line 3',
        '',
        '```diff',
        '+z()',
        '```',
        '',
        'Rename.',
      ].join('\n'),
    );
  });

  it('cuts a long quote, and fences code that has backticks of its own', () => {
    const lines = Array.from({ length: MAX_QUOTED_LINES + 2 }, (_, i) => ({ kind: 'same' as const, text: i === 0 ? '```' : `line ${i}` }));
    const { text, item } = reviewDraft([comment({ lines })]);
    expect(text).toBe('Address my review comment on the changes.');
    expect(item.text).toContain('````diff\n ```\n');
    expect(item.text).toContain('\n… 2 more lines\n````');
    expect(item.text).not.toContain(`line ${MAX_QUOTED_LINES}`);
  });
});

it('reviewSummary counts comments and files', () => {
  expect(reviewSummary([{ path: 'a' }])).toBe('1 comment on 1 file');
  expect(reviewSummary([{ path: 'a' }, { path: 'a' }, { path: 'b' }])).toBe('3 comments on 2 files');
});
