import { describe, expect, it } from 'vitest';
import { bodyTokens, countLines, defaultHeading, firstSentence, flattenLinks, memoryFileText, memoryIndexLine, memoryMeta, parseSections, rulePaths, sectionBody, slugify, splitFrontmatter } from './memoryText.ts';

describe('frontmatter', () => {
  it('reads the type at the top level or under metadata, and keeps unknown fields', () => {
    const { data, body } = splitFrontmatter('---\nname: sidebar-order\ndescription: "Needs you: first"\nmetadata:\n  type: project\n  originSessionId: abc\nextra: kept\n---\n\nBody.\n');
    expect(memoryMeta(data)).toEqual({ name: 'sidebar-order', description: 'Needs you: first', type: 'project', originSessionId: 'abc', source: null });
    expect(data.extra).toBe('kept');
    expect(data.metadata).toEqual({ type: 'project', originSessionId: 'abc' });
    expect(body).toBe('Body.\n');
    expect(memoryMeta(splitFrontmatter('---\ntype: feedback\n---\nx').data).type).toBe('feedback');
  });

  it('leaves a file without frontmatter as it is', () => {
    expect(splitFrontmatter('# Title\n\n---\n')).toEqual({ data: {}, body: '# Title\n\n---\n', raw: '' });
  });

  it("reads a rule's paths as a list, inline list or string", () => {
    expect(rulePaths(splitFrontmatter('---\npaths:\n  - "apps/ui/**"\n  - src/**\n---\n').data)).toEqual(['apps/ui/**', 'src/**']);
    expect(rulePaths(splitFrontmatter('---\npaths: ["a/**", "b/**"]\n---\n').data)).toEqual(['a/**', 'b/**']);
    expect(rulePaths(splitFrontmatter('---\npaths: apps/**\n---\n').data)).toEqual(['apps/**']);
    expect(rulePaths({})).toBeUndefined();
  });

  it('writes a memory the way Claude Code does', () => {
    expect(memoryFileText({ name: 'design-system', description: 'Tokens: in styles.css', type: 'project', body: '\nUse tokens.\n\n' })).toBe(
      '---\nname: design-system\ndescription: "Tokens: in styles.css"\nmetadata:\n  type: project\n---\n\nUse tokens.\n',
    );
    expect(memoryIndexLine('Design system', 'design-system.md', 'Tokens')).toBe('- [Design system](design-system.md) — Tokens');
  });
});

describe('a large frontmatter', () => {
  it('reads a long list or block in one pass', () => {
    const items = Array.from({ length: 50_000 }, (_, i) => `  - src/${i}.ts`).join('\n');
    const pairs = Array.from({ length: 50_000 }, (_, i) => `  k${i}: v`).join('\n');
    const started = Date.now();
    const { data } = splitFrontmatter(`---\npaths:\n${items}\nmetadata:\n${pairs}\n---\nBody`);
    expect(Date.now() - started).toBeLessThan(1000);
    expect((data.paths as string[]).length).toBe(50_000);
    expect(Object.keys(data.metadata as object)).toHaveLength(50_000);
  });

  it('keeps __proto__ as a key, not a prototype', () => {
    const { data } = splitFrontmatter('---\n__proto__:\n  polluted: yes\n---\n');
    expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
    expect(Object.hasOwn(data, '__proto__')).toBe(true);
    expect((data as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('headings and names', () => {
  it('turns a memory name into a Title Case heading', () => {
    expect(defaultHeading('sidebar-order')).toBe('Sidebar Order');
    expect(defaultHeading('no_em dashes')).toBe('No Em Dashes');
    expect(defaultHeading('release-process.md')).toBe('Release Process');
  });

  it('turns a heading into a memory name', () => {
    expect(slugify('Design system')).toBe('design-system');
    expect(slugify('  Café & Co.  ')).toBe('cafe-co');
    expect(slugify('!!!')).toBe('memory');
  });

  it('takes the first sentence of a section as plain text', () => {
    expect(firstSentence('- Tokens live in **styles.css**. Use [components](x).\n')).toBe('Tokens live in styles.css.');
    expect(firstSentence('No full stop here')).toBe('No full stop here');
    expect(firstSentence('```\ncode.\n```\nThen text. More.')).toBe('Then text.');
  });
});

describe('body tokens', () => {
  it('finds [[name]] and [[name|label]] links outside code and escapes', () => {
    const body = 'See [[a]] and [[b | the b]].\nNot `[[code]]` nor \\[[escaped]].\n```\n[[fenced]]\n```\n[[c]]';
    const tokens = bodyTokens(body);
    expect(tokens.filter((t) => 'link' in t).map((t) => ('link' in t ? [t.link, t.label] : null))).toEqual([
      ['a', 'a'],
      ['b', 'the b'],
      ['c', 'c'],
    ]);
    expect(tokens.map((t) => ('link' in t ? t.raw : t.text)).join('')).toBe(body);
  });

  it('leaves broken brackets as text', () => {
    expect(bodyTokens('[[open and [[a]b]] [[]]')).toEqual([{ text: '[[open and [[a]b]] [[]]' }]);
  });
});

describe('links', () => {
  it('flattens [[name]] links to plain text', () => {
    expect(flattenLinks('See [[design-system]] and [[ queue-section ]].')).toBe('See design-system and queue-section.');
    expect(flattenLinks('A [normal](link) stays, [[x\ny]] too.')).toBe('A [normal](link) stays, [[x\ny]] too.');
  });
});

describe('sections', () => {
  const text = '---\ntitle: x\n---\n# Top\n\nIntro.\n\n## Design system\n\nTokens.\n\n```md\n## Not a heading\n```\n\n### Colours\n\nOnly tokens.\n\n## Other\n\nNo.\n';

  it('finds headings outside code fences, with where each section ends', () => {
    const sections = parseSections(text);
    expect(sections.map((s) => [s.level, s.title])).toEqual([
      [1, 'Top'],
      [2, 'Design system'],
      [3, 'Colours'],
      [2, 'Other'],
    ]);
    expect(sectionBody(text, sections[1]!)).toBe('Tokens.\n\n```md\n## Not a heading\n```\n\n### Colours\n\nOnly tokens.');
    expect(sectionBody(text, sections[3]!)).toBe('No.');
  });

  it('counts lines like an editor', () => {
    expect(countLines('')).toBe(0);
    expect(countLines('a\nb\n')).toBe(2);
    expect(countLines('a\r\nb')).toBe(2);
  });
});
