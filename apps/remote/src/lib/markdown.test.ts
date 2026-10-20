import { describe, expect, it } from 'vitest';
import { decodeEntities, parseMarkdown, safeHref } from './markdown.ts';

describe('parseMarkdown', () => {
  it('reads headings, emphasis, inline code and lists', () => {
    expect(parseMarkdown('## Done\n\nIt is **fast** and *small*, see `limit.ts`.\n\n- one\n- two')).toEqual([
      { type: 'heading', depth: 2, children: [{ type: 'text', text: 'Done' }] },
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: 'It is ' },
          { type: 'strong', children: [{ type: 'text', text: 'fast' }] },
          { type: 'text', text: ' and ' },
          { type: 'em', children: [{ type: 'text', text: 'small' }] },
          { type: 'text', text: ', see ' },
          { type: 'code', text: 'limit.ts' },
          { type: 'text', text: '.' },
        ],
      },
      { type: 'list', ordered: false, start: 1, items: [[{ type: 'paragraph', children: [{ type: 'text', text: 'one' }] }], [{ type: 'paragraph', children: [{ type: 'text', text: 'two' }] }]] },
    ]);
  });

  it('keeps numbered lists\' first number', () => {
    expect(parseMarkdown('3. three\n4. four')[0]).toMatchObject({ type: 'list', ordered: true, start: 3 });
  });

  it('reads code blocks and tables', () => {
    expect(parseMarkdown('```ts\nconst a = 1 < 2;\n```')).toEqual([{ type: 'code', lang: 'ts', text: 'const a = 1 < 2;' }]);
    expect(parseMarkdown('| a | b |\n|:-|-:|\n| `x` | y |')).toEqual([
      { type: 'table', align: ['left', 'right'], header: [[{ type: 'text', text: 'a' }], [{ type: 'text', text: 'b' }]], rows: [[[{ type: 'code', text: 'x' }], [{ type: 'text', text: 'y' }]]] },
    ]);
  });

  it('keeps raw HTML as text, inline and as a block', () => {
    expect(parseMarkdown('Hi <b>there</b> <script>alert(1)</script>')).toEqual([{ type: 'paragraph', children: [{ type: 'text', text: 'Hi <b>there</b> <script>alert(1)</script>' }] }]);
    expect(parseMarkdown('<div onclick="x()">block</div>')).toEqual([{ type: 'paragraph', children: [{ type: 'text', text: '<div onclick="x()">block</div>' }] }]);
  });

  it('only links to web addresses', () => {
    const links = parseMarkdown('[ok](https://example.com/a) [js](javascript:alert(1)) [file](file:///etc/passwd) [rel](src/a.ts) ![pic](data:image/png;base64,AAAA)')[0];
    const hrefs = (links as { children: Array<{ type: string; href?: string | null }> }).children.filter((c) => c.type === 'link').map((c) => c.href);
    expect(hrefs).toEqual(['https://example.com/a', null, null, null]);
  });

  it('reads entities as the character they stand for', () => {
    expect(parseMarkdown('a &amp; b &lt;c&gt; &#x1F600;')).toEqual([{ type: 'paragraph', children: [{ type: 'text', text: 'a & b <c> 😀' }] }]);
    expect(decodeEntities('&bogus; &#0;')).toBe('&bogus; &#0;');
  });

  it('keeps quotes and rules', () => {
    expect(parseMarkdown('> careful\n\n---')).toEqual([{ type: 'quote', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'careful' }] }] }, { type: 'rule' }]);
  });
});

describe('safeHref', () => {
  it('takes http and https only', () => {
    expect(safeHref('http://localhost:3000/x')).toBe('http://localhost:3000/x');
    expect(safeHref('JAVASCRIPT:alert(1)')).toBeNull();
    expect(safeHref('mailto:me@example.com')).toBeNull();
    expect(safeHref('/relative')).toBeNull();
  });
});
