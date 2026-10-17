import { describe, expect, it } from 'vitest';
import { blankAria, blanksLeft, chipLabel, fillMessage, fromSegments, insertBlank, promptMeta, removeBlank, replaceBlank, sameScope, slashScore, toSegments } from './fillModel.ts';

describe('segments', () => {
  it('always has text around the blanks', () => {
    const segments = toSegments('{{a}}{{b:pr}} end');
    expect(segments.texts).toEqual(['', '', ' end']);
    expect(segments.blanks.map((b) => b.name)).toEqual(['a', 'b']);
    expect(fromSegments(segments)).toBe('{{a}}{{b:pr}} end');
  });

  it('keeps typed braces as text', () => {
    const segments = toSegments('Fix {{pr:pr}}');
    segments.texts[1] = ' with {{literal}}';
    expect(fromSegments(segments)).toBe('Fix {{pr:pr}} with \\{{literal}}');
  });

  it('inserts, replaces and removes blanks', () => {
    const start = toSegments('Rebase onto main');
    const inserted = insertBlank(start, 0, 7, { name: 'branch', type: 'branch', options: [], optional: false });
    expect(fromSegments(inserted)).toBe('Rebase {{branch:branch}}onto main');
    expect(fromSegments(replaceBlank(inserted, 0, { name: 'base', type: 'branch', options: [], optional: true }))).toBe('Rebase {{base?:branch}}onto main');
    expect(fromSegments(removeBlank(inserted, 0))).toBe('Rebase onto main');
  });
});

describe('filling', () => {
  const state = { text: 'Fix {{pr:pr}}. {{note?}}', values: { pr: 'https://github.com/o/r/pull/142' } };

  it('sends the filled prompt, then what was added with a blank line between', () => {
    expect(fillMessage(state, '')).toBe('Fix https://github.com/o/r/pull/142.');
    expect(fillMessage(state, '  Keep the tests.  ')).toBe('Fix https://github.com/o/r/pull/142.\n\nKeep the tests.');
  });

  it('counts the required blanks left', () => {
    expect(blanksLeft({ text: state.text, values: {} })).toEqual(['pr']);
    expect(blanksLeft(state)).toEqual([]);
  });

  it('labels chips for screen readers', () => {
    expect(blankAria({ name: 'pr', type: 'pr', optional: false }, '')).toBe('Pull request, required, empty');
    expect(blankAria({ name: 'branch', type: 'branch', optional: false }, 'feat/claude-code-mods')).toBe('Branch: feat/claude-code-mods');
    expect(blankAria({ name: 'issue', type: 'issue', optional: false }, 'https://github.com/o/r/issues/132', '#132 Support Claude Code Mods')).toBe('Issue: #132 Support Claude Code Mods');
    expect(blankAria({ name: 'context', type: 'text', optional: true }, '')).toBe('Context, optional, empty');
    expect(chipLabel({ name: 'base_branch', type: 'branch' })).toBe('base branch');
    expect(chipLabel({ name: 'pr', type: 'pr' })).toBe('pull request');
  });

  it('says what a prompt asks for and how often it was used', () => {
    expect(promptMeta({ text: 'Fix {{pr:pr}} on {{branch:branch}}', uses: 11 })).toBe('2 blanks · pull request, branch · used 11×');
    expect(promptMeta({ text: 'Plain', uses: 0 })).toBe('No blanks');
  });
});

describe('slashScore', () => {
  it('ranks the start of a name over the middle, letters in order and the description', () => {
    const scores = ['implement-issue', 'reimplement', 'improve-labels', 'other'].map((name) => slashScore('impl', name, name === 'other' ? 'implement things' : ''));
    expect(scores[0]!).toBeGreaterThan(scores[1]!);
    expect(scores[1]!).toBeGreaterThan(scores[2]!);
    expect(scores[2]!).toBeGreaterThan(scores[3]!);
    expect(slashScore('zzz', 'implement')).toBeNull();
  });
});

it('tells places apart', () => {
  expect(sameScope({ kind: 'personal', root: '/a' }, { kind: 'personal', root: '/a' })).toBe(true);
  expect(sameScope({ kind: 'personal', root: '/a' }, { kind: 'shared', root: '/a' })).toBe(false);
  expect(sameScope({ kind: 'global' }, { kind: 'global' })).toBe(true);
});
