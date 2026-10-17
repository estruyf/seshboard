import { describe, expect, it } from 'vitest';
import { applySuggestion, detectSuggestions } from './suggestions.ts';

const found = (text: string, branches?: string[]) => detectSuggestions(text, branches).map((s) => [s.type, s.text]);

describe('detectSuggestions', () => {
  it('finds GitHub issue and pull request links', () => {
    expect(found('Start on https://github.com/estruyf/switchboard/issues/132 and see https://github.com/o/r/pull/142/files.')).toEqual([
      ['issue', 'https://github.com/estruyf/switchboard/issues/132'],
      ['pr', 'https://github.com/o/r/pull/142/files'],
    ]);
  });

  it('finds #123 as an issue and "PR #12" as a pull request', () => {
    expect(found('Fix #123, then rebase PR #12. Not a#1 or &#39;')).toEqual([
      ['issue', '#123'],
      ['pr', 'PR #12'],
    ]);
  });

  it('finds branch names, with or without a known prefix', () => {
    expect(found('Rebase feat/claude-code-mods on main.')).toEqual([['branch', 'feat/claude-code-mods']]);
    expect(found('Check out spike-remote please', ['main', 'spike-remote'])).toEqual([['branch', 'spike-remote']]);
    // main is everywhere in prose: never a suggestion.
    expect(found('Merge into main', ['main'])).toEqual([]);
  });

  it('finds file paths and @ mentions', () => {
    expect(found('Look at apps/ui/src/lib/fuzzy.ts and @docs/project-actions.md, also ./README.md.')).toEqual([
      ['file', 'apps/ui/src/lib/fuzzy.ts'],
      ['file', '@docs/project-actions.md'],
      ['file', './README.md'],
    ]);
  });

  it('leaves out what is inside a blank already, and plain words', () => {
    expect(found('Fix {{pr:pr}} in src/a.ts')).toEqual([['file', 'src/a.ts']]);
    expect(found('Make it better, and/or faster.')).toEqual([]);
  });

  it('does not take a link to another site for a file', () => {
    expect(found('See https://example.com/docs/page.html')).toEqual([]);
  });
});

describe('applySuggestion', () => {
  it('turns a suggestion into a blank with a free name', () => {
    const text = 'Fix {{issue:issue}} and #45';
    const [suggestion] = detectSuggestions(text);
    expect(applySuggestion(text, suggestion!)).toBe('Fix {{issue:issue}} and {{issue-2:issue}}');
    const branch = 'Rebase feat/x';
    expect(applySuggestion(branch, detectSuggestions(branch)[0]!)).toBe('Rebase {{branch:branch}}');
  });
});
