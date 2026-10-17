import { describe, expect, it } from 'vitest';
import {
  blankLabel,
  blankProblems,
  blanksLeftText,
  blanksOf,
  blanksSummary,
  blankSource,
  byMostUsed,
  byRecentUse,
  escapeText,
  fill,
  freeBlankName,
  joinParts,
  missing,
  parse,
  promptPreview,
  toPlainText,
} from './savedPrompts.ts';

describe('parse', () => {
  it('splits text and blanks', () => {
    expect(parse('Start implementing {{issue:issue}} on {{branch:branch}}.')).toEqual([
      { kind: 'text', text: 'Start implementing ', raw: 'Start implementing ' },
      { kind: 'blank', name: 'issue', type: 'issue', options: [], optional: false, raw: '{{issue:issue}}' },
      { kind: 'text', text: ' on ', raw: ' on ' },
      { kind: 'blank', name: 'branch', type: 'branch', options: [], optional: false, raw: '{{branch:branch}}' },
      { kind: 'text', text: '.', raw: '.' },
    ]);
  });

  it('defaults to text, and reads every type', () => {
    const types = parse('{{a}} {{b:text}} {{c:choice=x|y}} {{d:issue}} {{e:pr}} {{f:branch}} {{g:file}}')
      .filter((part) => part.kind === 'blank')
      .map((part) => part.type);
    expect(types).toEqual(['text', 'text', 'choice', 'issue', 'pr', 'branch', 'file']);
  });

  it('falls back to text for an unknown type, and reads types in any case', () => {
    expect(blanksOf('{{a:widget}} {{b:PR}}').map((b) => b.type)).toEqual(['text', 'pr']);
  });

  it('handles a blank at the start and at the end', () => {
    const parts = parse('{{first}} middle {{last}}');
    expect(parts.map((p) => p.kind)).toEqual(['blank', 'text', 'blank']);
    expect(parse('{{only}}')).toEqual([{ kind: 'blank', name: 'only', type: 'text', options: [], optional: false, raw: '{{only}}' }]);
  });

  it('reads optional blanks', () => {
    expect(blanksOf('{{context?}} {{ notes ? : text }}')).toMatchObject([
      { name: 'context', optional: true },
      { name: 'notes', optional: true },
    ]);
  });

  it('reads choices with spaces, and drops empty and repeated options', () => {
    expect(blanksOf('{{env:choice= staging env | prod || prod }}')[0]).toMatchObject({ type: 'choice', options: ['staging env', 'prod'] });
  });

  it('keeps a choice without options as a choice with none', () => {
    expect(blanksOf('{{env:choice=}}')[0]).toMatchObject({ type: 'choice', options: [] });
    expect(blanksOf('{{env:choice}}')[0]).toMatchObject({ type: 'choice', options: [] });
  });

  it('takes the innermost braces when they are nested', () => {
    expect(parse('{{a{{b}}}}')).toEqual([
      { kind: 'text', text: '{{a', raw: '{{a' },
      { kind: 'blank', name: 'b', type: 'text', options: [], optional: false, raw: '{{b}}' },
      { kind: 'text', text: '}}', raw: '}}' },
    ]);
    expect(parse('{{{x}}}').map((p) => (p.kind === 'text' ? p.text : `[${p.name}]`))).toEqual(['{', '[x]', '}']);
  });

  it('leaves braces without a name as text', () => {
    expect(parse('{{}} and {{ :pr }}')).toEqual([{ kind: 'text', text: '{{}} and {{ :pr }}', raw: '{{}} and {{ :pr }}' }]);
  });

  it('writes literal braces after a backslash', () => {
    expect(parse('Use \\{{name}} here')).toEqual([{ kind: 'text', text: 'Use {{name}} here', raw: 'Use \\{{name}} here' }]);
    expect(fill('Use \\{{name}} for {{what}}', { what: 'templates' })).toBe('Use {{name}} for templates');
  });
});

describe('blanksOf', () => {
  it('lists a name used twice once', () => {
    expect(blanksOf('{{issue:issue}} and again {{issue:issue}}').map((b) => b.name)).toEqual(['issue']);
  });
});

describe('fill', () => {
  it('fills every use of a name with one value', () => {
    expect(fill('Fix {{pr:pr}}. Then rebase {{pr:pr}}.', { pr: '#142' })).toBe('Fix #142. Then rebase #142.');
  });

  it('leaves nothing for an empty optional blank, and trims the result', () => {
    expect(fill('Review the change. {{context?}}', {})).toBe('Review the change.');
  });

  it('trims each value', () => {
    expect(fill('On {{branch:branch}}.', { branch: '  main \n' })).toBe('On main.');
  });
});

describe('missing', () => {
  it('lists required blanks that are empty, once each', () => {
    expect(missing('{{a}} {{b?}} {{c:pr}} {{a}}', { c: '' })).toEqual(['a', 'c']);
    expect(missing('{{a}} {{c:pr}}', { a: 'x', c: '  ' })).toEqual(['c']);
    expect(missing('{{a}} {{b?}}', { a: 'x' })).toEqual([]);
  });
});

describe('toPlainText', () => {
  it('keeps filled values and writes empty blanks as their label in brackets', () => {
    expect(toPlainText('Fix {{pr:pr}} on {{base_branch:branch}}', { pr: '#142' })).toBe('Fix #142 on [Base branch]');
  });
});

describe('labels and summaries', () => {
  it('makes a label from the name', () => {
    expect(blankLabel({ name: 'base_branch' })).toBe('Base branch');
    expect(blankLabel({ name: 'pr' })).toBe('Pr');
  });

  it('summarises the blanks', () => {
    expect(blanksSummary('{{issue:issue}} {{env:choice=a|b}} {{issue:issue}}')).toBe('2 blanks · issue, choice');
    expect(blanksSummary('{{pr:pr}}')).toBe('1 blank · pull request');
    expect(blanksSummary('No blanks here')).toBe('No blanks');
  });

  it('says how many blanks are left', () => {
    expect(blanksLeftText(1)).toBe('1 blank left');
    expect(blanksLeftText(2)).toBe('2 blanks left');
  });

  it('previews a prompt with its blanks as boxes', () => {
    expect(promptPreview('Start implementing {{issue:issue}}\nwith tests')).toBe('Start implementing ▢ with tests');
    expect(promptPreview('x'.repeat(100), 10)).toBe('xxxxxxxxx…');
  });
});

describe('writing prompts', () => {
  it('writes blanks back as they are read', () => {
    for (const spec of [
      { name: 'a', type: 'text', options: [], optional: false },
      { name: 'b', type: 'pr', options: [], optional: true },
      { name: 'env', type: 'choice', options: ['staging env', 'prod'], optional: false },
    ] as const) {
      expect(blanksOf(blankSource({ ...spec, options: [...spec.options] }))[0]).toMatchObject(spec);
    }
  });

  it('escapes typed braces, and joins parts back into the same prompt', () => {
    expect(escapeText('a {{b}}')).toBe('a \\{{b}}');
    const text = 'Use \\{{x}} for {{pr:pr}} {{env:choice=a|b}}.';
    expect(joinParts(parse(text))).toBe(text);
    expect(fill(joinParts(parse(text)), { pr: '1', env: 'a' })).toBe('Use {{x}} for 1 a.');
  });

  it('finds a free name', () => {
    expect(freeBlankName('{{issue:issue}} {{issue-2}}', 'issue')).toBe('issue-3');
    expect(freeBlankName('', 'branch')).toBe('branch');
  });

  it('reports a choice without options and a name used for two kinds of blank', () => {
    expect(blankProblems('{{env:choice=}}')).toEqual(['The choice “env” needs options.']);
    expect(blankProblems('{{x:pr}} {{x:branch}} {{x:issue}}')).toEqual(['“x” is used for two different blanks. Give each its own name.']);
    expect(blankProblems('{{x:pr}} {{x:pr}}')).toEqual([]);
  });
});

describe('ordering by use', () => {
  const prompts = [
    { name: 'B', uses: 2, lastUsedAt: 100, updatedAt: 1 },
    { name: 'A', uses: 9, lastUsedAt: 50, updatedAt: 1 },
    { name: 'C', uses: 0, lastUsedAt: null, updatedAt: 5 },
    { name: 'D', uses: 0, lastUsedAt: null, updatedAt: 9 },
  ];

  it('puts the most recently used first, then the newest unused', () => {
    expect(byRecentUse(prompts).map((p) => p.name)).toEqual(['B', 'A', 'D', 'C']);
  });

  it('puts the most used first', () => {
    expect(byMostUsed(prompts).map((p) => p.name)).toEqual(['A', 'B', 'C', 'D']);
  });
});
