import { describe, expect, it } from 'vitest';
import { cleanSelectionHtml, plainText, type ClipNode } from './clipboardHtml.ts';
import { replyHtml } from './richText.tsx';

/** A node as the cleaner reads it, written the way the transcript's DOM looks: with the classes and styles Chromium would copy. */
type Child = ClipNode | string;
const text = (data: string): ClipNode => ({ nodeType: 3, nodeName: '#text', textContent: data, childNodes: [] });
function node(name: string, attributes: Record<string, string>, ...children: Child[]): ClipNode {
  return { nodeType: 1, nodeName: name.toUpperCase(), textContent: null, childNodes: children.map((child) => (typeof child === 'string' ? text(child) : child)), getAttribute: (attribute) => attributes[attribute] ?? null };
}
const el = (name: string, ...children: Child[]) => node(name, { class: 'text-text bg-card', style: 'color: rgb(1, 2, 3)', 'data-x': '1' }, ...children);
/** What the live page tells the cleaner: the element keeps its line breaks, or is in a monospace font. */
const flagged = (n: ClipNode, flags: Pick<ClipNode, 'preformatted' | 'monospace'>): ClipNode => Object.assign(n, flags);
const fragment = (children: Child[] = [], flags: Pick<ClipNode, 'preformatted' | 'monospace'> = {}): ClipNode => ({
  nodeType: 11,
  nodeName: '#document-fragment',
  textContent: null,
  childNodes: children.map((child) => (typeof child === 'string' ? text(child) : child)),
  ...flags,
});
/** The common ancestor and what is above it, innermost first, as `selectionClip` hands them over. */
const shell = (name: string, attributes: Record<string, string> = {}) => node(name, attributes);

describe('cleanSelectionHtml', () => {
  it('keeps the structure and drops classes, styles and data attributes', () => {
    const html = cleanSelectionHtml(fragment([el('h2', 'Plan'), el('p', 'Run ', el('strong', 'tests'), ' and ', el('em', 'look')), el('ul', el('li', 'one'), el('li', 'two'))]));
    expect(html).toBe('<h2>Plan</h2><p>Run <strong>tests</strong> and <em>look</em></p><ul><li>one</li><li>two</li></ul>');
    expect(html).not.toMatch(/class=|style=|data-/);
  });

  it('keeps inline code and code blocks monospace, without their colours', () => {
    const html = cleanSelectionHtml(fragment([el('p', 'Run ', el('code', 'npm test')), el('pre', el('code', el('span', 'a < b')))]));
    expect(html).toMatch(/<code style="font-family:[^"]*monospace">npm test<\/code>/);
    expect(html).toMatch(/<pre style="[^"]*monospace[^"]*"><code style="[^"]*monospace">a &lt; b<\/code><\/pre>/);
    expect(html).not.toMatch(/class=|color|background|data-/);
  });

  it('keeps tables with borders', () => {
    const html = cleanSelectionHtml(fragment([el('table', el('thead', el('tr', el('th', 'File'))), el('tbody', el('tr', el('td', 'a.ts'))))]));
    expect(html).toContain('<table style="border-collapse:collapse">');
    expect(html).toMatch(/<th style="border:1px solid #d0d7de[^"]*">File<\/th>/);
    expect(html).toMatch(/<td style="border:1px solid #d0d7de[^"]*">a.ts<\/td>/);
  });

  it('keeps web links and mail links, and turns a link to a file into its text', () => {
    const html = cleanSelectionHtml(
      fragment([
        el('p', 'See ', node('a', { href: 'https://example.com/?a=1&b="2"', class: 'text-link' }, 'docs'), ', ', node('a', { href: 'mailto:a@b.c' }, 'mail'), ', ', node('a', { href: 'file:///repo/src/auth.ts', 'data-file-link': '/repo/src/auth.ts' }, 'auth.ts'), ', ', node('a', { href: 'src/a.ts#L1' }, 'a.ts'), ', ', node('a', { href: 'javascript:alert(1)' }, 'x'), '.'),
      ]),
    );
    expect(html).toBe('<p>See <a href="https://example.com/?a=1&amp;b=&quot;2&quot;">docs</a>, <a href="mailto:a@b.c">mail</a>, auth.ts, a.ts, x.</p>');
  });

  it('leaves out buttons, graphics, media, fields and the TeX source of maths', () => {
    const html = cleanSelectionHtml(
      fragment([
        el('div', el('div', el('button', 'Copy code'), el('svg', el('path'))), el('pre', el('code', 'a'))),
        el('p', 'Hi', el('img'), el('input'), el('textarea', 'draft')),
        el('p', el('math', el('semantics', el('mi', 'x'), el('annotation', 'x^2')))),
      ]),
    );
    expect(html).not.toMatch(/Copy code|svg|path|img|input|draft|x\^2/);
    expect(html).toContain('<div><pre');
    expect(html).toContain('<p>Hi</p>');
    expect(html).toContain('<p>x</p>');
  });

  it('drops empty wrappers and empty headings, unwraps other elements, and escapes text', () => {
    expect(cleanSelectionHtml(fragment([el('div', el('div', el('button', 'x')))]))).toBe('');
    expect(cleanSelectionHtml(fragment([el('p', el('span', 'a & b <c>'))]))).toBe('<p>a &amp; b &lt;c&gt;</p>');
    expect(cleanSelectionHtml(fragment())).toBe('');
    expect(cleanSelectionHtml(fragment(['  ']))).toBe('');
  });

  it('copies a selection across two messages without the speaker or the turn line', () => {
    // The page leaves out the speaker's name (sr-only) and the turn line (user-select: none), as selection.toString() does:
    // the h2 and the line's spans reach the cleaner empty.
    const message = (...body: Child[]) => el('div', el('h2'), ...body);
    const html = cleanSelectionHtml(fragment([message(el('p', 'Done.'), el('span')), el('div', el('span'), el('span')), message(el('p', 'Next: '), el('ul', el('li', 'a')))]));
    expect(html).toBe('<div><p>Done.</p></div><div><p>Next: </p><ul><li>a</li></ul></div>');
  });

  describe('a selection that starts below its structure', () => {
    it('wraps two table rows in their table', () => {
      const html = cleanSelectionHtml(fragment([el('tr', el('td', 'a'), el('td', 'b')), el('tr', el('td', 'c'), el('td', 'd'))]), [shell('tbody'), shell('table'), shell('div')]);
      expect(html).toMatch(/^<table style="border-collapse:collapse"><tbody><tr><td [^>]*>a<\/td><td [^>]*>b<\/td><\/tr><tr>/);
      expect(html).toMatch(/<\/tr><\/tbody><\/table>$/);
    });

    it('keeps where a list starts when the selection starts at its third item', () => {
      expect(cleanSelectionHtml(fragment([el('li', 'c'), el('li', 'd')]), [shell('ol', { start: '3' }), shell('div')])).toBe('<ol start="3"><li>c</li><li>d</li></ol>');
      expect(cleanSelectionHtml(fragment([el('li', 'x')]), [shell('ul')])).toBe('<ul><li>x</li></ul>');
    });

    it('keeps a nested list inside its item and its list', () => {
      expect(cleanSelectionHtml(fragment([el('li', 'inner')]), [shell('ul'), shell('li'), shell('ul')])).toBe('<ul><li><ul><li>inner</li></ul></li></ul>');
    });

    it('keeps bold, italics, links, code and headings around a few words inside them', () => {
      expect(cleanSelectionHtml(fragment(['word']), [shell('strong'), shell('p')])).toBe('<strong>word</strong>');
      expect(cleanSelectionHtml(fragment(['word']), [shell('em'), shell('strong'), shell('p')])).toBe('<strong><em>word</em></strong>');
      expect(cleanSelectionHtml(fragment(['docs']), [shell('a', { href: 'https://example.com' }), shell('p')])).toBe('<a href="https://example.com">docs</a>');
      expect(cleanSelectionHtml(fragment(['auth.ts']), [shell('a', { href: 'file:///repo/auth.ts' }), shell('p')])).toBe('auth.ts');
      expect(cleanSelectionHtml(fragment(['Plan']), [shell('h2')])).toBe('<h2>Plan</h2>');
      expect(cleanSelectionHtml(fragment(['npm']), [shell('code'), shell('p')])).toMatch(/^<code style="font-family:[^"]*monospace">npm<\/code>$/);
    });

    it('keeps a selection inside a code block monospace, with its line breaks', () => {
      expect(cleanSelectionHtml(fragment([el('span', 'a'), '\nb']), [shell('code'), shell('pre'), shell('div')])).toMatch(/^<pre style="[^"]*monospace[^"]*"><code style="[^"]*monospace">a\nb<\/code><\/pre>$/);
    });

    it('pastes a few words inside one list item, table cell or paragraph as words, not as a bullet or a table', () => {
      expect(cleanSelectionHtml(fragment(['two words']), [shell('li'), shell('ul')])).toBe('two words');
      expect(cleanSelectionHtml(fragment(['cell']), [shell('td'), shell('tr'), shell('tbody'), shell('table')])).toBe('cell');
      expect(cleanSelectionHtml(fragment(['text']), [shell('p'), shell('blockquote')])).toBe('text');
    });
  });

  describe('line breaks kept by white-space', () => {
    it('turns them into <br> in a prompt', () => {
      const html = cleanSelectionHtml(fragment([flagged(el('p', 'line one\nline two\n\nline four'), { preformatted: true })]));
      expect(html).toBe('<p>line one<br>line two<br><br>line four</p>');
    });

    it('does the same for a selection inside such an element, and for text a nested element holds', () => {
      expect(cleanSelectionHtml(fragment(['a\nb'], { preformatted: true }), [shell('p')])).toBe('a<br>b');
      expect(cleanSelectionHtml(fragment([flagged(el('div', el('span', 'a\nb')), { preformatted: true })]))).toBe('<div>a<br>b</div>');
    });

    it('leaves a code block alone: its line breaks stay text', () => {
      expect(cleanSelectionHtml(fragment([flagged(el('pre', el('code', 'a\nb')), { preformatted: true })]))).toMatch(/>a\nb</);
    });

    it('keeps a block of monospace rows (a diff) as one code block, with its indent', () => {
      const row = (line: string) => flagged(el('div', line), { preformatted: true, monospace: true });
      const html = cleanSelectionHtml(fragment([el('div', row('    return x;'), row('+ added'), row('- removed'))]));
      expect(html).toMatch(/^<div><pre style="[^"]*monospace[^"]*">    return x;\n\+ added\n- removed<\/pre><\/div>$/);
      expect(html).not.toContain('<code');
    });

    it('is a code block for a selection inside one such row, and not twice inside code', () => {
      expect(cleanSelectionHtml(fragment(['  + added'], { preformatted: true, monospace: true }), [shell('div')])).toMatch(/^<pre style="[^"]*monospace[^"]*">  \+ added<\/pre>$/);
      expect(cleanSelectionHtml(fragment(['x'], { monospace: true }), [shell('code')]).match(/<code/g)).toHaveLength(1);
    });

    it('keeps leading and repeated spaces of text that is not monospace', () => {
      expect(cleanSelectionHtml(fragment([flagged(el('p', '  indented\nsome   gap'), { preformatted: true })]))).toBe('<p>&nbsp;&nbsp;indented<br>some&nbsp;&nbsp; gap</p>');
    });

    it('puts a monospace font on a block that is not preformatted as a style, not as code around blocks', () => {
      expect(cleanSelectionHtml(fragment([flagged(el('p', 'cmd'), { monospace: true })]))).toMatch(/^<p style="font-family:[^"]*monospace">cmd<\/p>$/);
    });
  });

  it('writes the text of a cleaned selection with blocks on their own lines', () => {
    const tree = fragment([el('p', 'a ', el('strong', 'b')), el('ul', el('li', 'one'), el('li', 'two')), el('table', el('tr', el('td', 'x'), el('td', 'y'))), el('button', 'Copy'), el('p', 'l1', el('br'), 'l2')]);
    expect(plainText(tree)).toBe('a b\none\ntwo\nx\ty\nl1\nl2');
  });

  it('gives the same code and table markup as Copy as rich text', () => {
    const rich = replyHtml('`x`\n\n| A |\n| --- |\n| b |');
    const clean = cleanSelectionHtml(fragment([el('p', el('code', 'x')), el('table', el('thead', el('tr', el('th', 'A'))), el('tbody', el('tr', el('td', 'b'))))]));
    for (const part of ['<code style="font-family:ui-monospace, Menlo, Consolas, monospace">x</code>', '<table style="border-collapse:collapse">']) {
      expect(rich).toContain(part);
      expect(clean).toContain(part);
    }
    expect(rich.match(/<th style="[^"]*">/)?.[0]).toBe(clean.match(/<th style="[^"]*">/)?.[0]);
  });
});
