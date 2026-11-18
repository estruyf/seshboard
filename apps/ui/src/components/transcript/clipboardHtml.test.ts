import { describe, expect, it } from 'vitest';
import { cleanSelectionHtml, type ClipNode } from './clipboardHtml.ts';
import { replyHtml } from './richText.tsx';

/** A node as the cleaner reads it, written the way the transcript's DOM looks: with the classes and styles Chromium would copy. */
type Child = ClipNode | string;
function node(name: string, attributes: Record<string, string>, ...children: Child[]): ClipNode {
  const childNodes = children.map((child) => (typeof child === 'string' ? { nodeType: 3, nodeName: '#text', textContent: child, childNodes: [] } : child));
  return { nodeType: 1, nodeName: name.toUpperCase(), textContent: null, childNodes, getAttribute: (attribute) => attributes[attribute] ?? null };
}
const el = (name: string, ...children: Child[]) => node(name, { class: 'text-text bg-card', style: 'color: rgb(1, 2, 3)', 'data-x': '1' }, ...children);
const fragment = (...children: Child[]): ClipNode => ({ nodeType: 11, nodeName: '#document-fragment', textContent: null, childNodes: children.map((child) => (typeof child === 'string' ? el('span', child) : child)) });

describe('cleanSelectionHtml', () => {
  it('keeps the structure and drops classes, styles and data attributes', () => {
    const html = cleanSelectionHtml(fragment(el('h2', 'Plan'), el('p', 'Run ', el('strong', 'tests'), ' and ', el('em', 'look')), el('ul', el('li', 'one'), el('li', 'two'))));
    expect(html).toBe('<h2>Plan</h2><p>Run <strong>tests</strong> and <em>look</em></p><ul><li>one</li><li>two</li></ul>');
    expect(html).not.toMatch(/class=|style=|data-/);
  });

  it('keeps inline code and code blocks monospace, without their colours', () => {
    const html = cleanSelectionHtml(fragment(el('p', 'Run ', el('code', 'npm test')), el('pre', el('code', el('span', 'a < b')))));
    expect(html).toMatch(/<code style="font-family:[^"]*monospace">npm test<\/code>/);
    expect(html).toMatch(/<pre style="[^"]*monospace[^"]*"><code style="[^"]*monospace">a &lt; b<\/code><\/pre>/);
    expect(html).not.toMatch(/class=|color|background|data-/);
  });

  it('keeps tables with borders', () => {
    const html = cleanSelectionHtml(fragment(el('table', el('thead', el('tr', el('th', 'File'))), el('tbody', el('tr', el('td', 'a.ts'))))));
    expect(html).toContain('<table style="border-collapse:collapse">');
    expect(html).toMatch(/<th style="border:1px solid #d0d7de[^"]*">File<\/th>/);
    expect(html).toMatch(/<td style="border:1px solid #d0d7de[^"]*">a.ts<\/td>/);
  });

  it('keeps web links and mail links, and turns a link to a file into its text', () => {
    const html = cleanSelectionHtml(
      fragment(
        el('p', 'See ', node('a', { href: 'https://example.com/?a=1&b="2"', class: 'text-link' }, 'docs'), ', ', node('a', { href: 'mailto:a@b.c' }, 'mail'), ', ', node('a', { href: 'file:///repo/src/auth.ts', 'data-file-link': '/repo/src/auth.ts' }, 'auth.ts'), ', ', node('a', { href: 'src/a.ts#L1' }, 'a.ts'), ', ', node('a', { href: 'javascript:alert(1)' }, 'x'), '.'),
      ),
    );
    expect(html).toBe('<p>See <a href="https://example.com/?a=1&amp;b=&quot;2&quot;">docs</a>, <a href="mailto:a@b.c">mail</a>, auth.ts, a.ts, x.</p>');
  });

  it('leaves out buttons, graphics, media, fields and what is not selectable', () => {
    const html = cleanSelectionHtml(
      fragment(
        el('div', el('div', el('button', 'Copy code'), el('svg', el('path'))), el('span', node('span', { class: 'absolute select-none uppercase' }, 'ts')), el('pre', el('code', 'a'))),
        el('p', 'Hi', el('img'), el('input'), el('textarea', 'draft')),
      ),
    );
    expect(html).not.toMatch(/Copy code|svg|path|>ts<|img|input|draft/);
    expect(html).toContain('<div><pre');
    expect(html).toContain('<p>Hi</p>');
  });

  it('drops empty wrappers, unwraps other elements, and escapes text', () => {
    expect(cleanSelectionHtml(fragment(el('div', el('div', el('button', 'x')))))).toBe('');
    expect(cleanSelectionHtml(fragment(el('p', el('span', 'a & b <c>'))))).toBe('<p>a &amp; b &lt;c&gt;</p>');
  });

  it('keeps the start of a numbered list', () => {
    expect(cleanSelectionHtml(fragment(node('ol', { start: '3' }, el('li', 'c'))))).toBe('<ol start="3"><li>c</li></ol>');
  });

  it('puts a selection inside a code block or inline code in monospace', () => {
    expect(cleanSelectionHtml(fragment('npm test'), 'code')).toMatch(/^<code style="font-family:[^"]*monospace">npm test<\/code>$/);
    expect(cleanSelectionHtml(fragment(el('span', 'a'), '\nb'), 'pre')).toMatch(/^<pre style="[^"]*monospace[^"]*">a\nb<\/pre>$/);
    expect(cleanSelectionHtml(fragment(el('button', 'x')), 'pre')).toBe('');
  });

  it('is empty for nothing', () => {
    expect(cleanSelectionHtml(fragment())).toBe('');
    expect(cleanSelectionHtml(fragment('  '))).toBe('');
  });

  it('gives the same code and table markup as Copy as rich text', () => {
    const rich = replyHtml('`x`\n\n| A |\n| --- |\n| b |');
    const clean = cleanSelectionHtml(fragment(el('p', el('code', 'x')), el('table', el('thead', el('tr', el('th', 'A'))), el('tbody', el('tr', el('td', 'b'))))));
    for (const part of ['<code style="font-family:ui-monospace, Menlo, Consolas, monospace">x</code>', '<table style="border-collapse:collapse">']) {
      expect(rich).toContain(part);
      expect(clean).toContain(part);
    }
    expect(rich.match(/<th style="[^"]*">/)?.[0]).toBe(clean.match(/<th style="[^"]*">/)?.[0]);
  });
});
