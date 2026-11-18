import { describe, expect, it } from 'vitest';
import { clipFromRange, type LiveNode, type LiveRange, type LiveStyle } from './selectionClip.ts';

/** A small page: nodes with a parent, attributes and the few computed styles the walk reads, and a Range with the DOM's rules for where it is. */
class Fake implements LiveNode {
  parentElement: Fake | null = null;
  childNodes: Fake[] = [];
  classList = { contains: (name: string) => (this.attrs.class ?? '').split(' ').includes(name) };
  constructor(
    public nodeType: number,
    public nodeName: string,
    public data: string | undefined,
    public attrs: Record<string, string>,
    public style: Partial<LiveStyle>,
  ) {}
  get localName() {
    return this.nodeType === 1 ? this.nodeName.toLowerCase() : undefined;
  }
  getAttribute(name: string) {
    return this.attrs[name] ?? null;
  }
  hasAttribute(name: string) {
    return name in this.attrs;
  }
}
const txt = (data: string) => new Fake(3, '#text', data, {}, {});
function el(name: string, attrs: Record<string, string> = {}, style: Partial<LiveStyle> = {}, ...children: (Fake | string)[]) {
  const node = new Fake(1, name.toUpperCase(), undefined, attrs, style);
  for (const child of children) {
    const c = typeof child === 'string' ? txt(child) : child;
    c.parentElement = node;
    node.childNodes.push(c);
  }
  return node;
}
/** Like the page: `user-select` is `text` on the prose root, and `user-select`, `white-space`, the font and `visibility` pass down to the elements below as they do in Chromium, so `none` is what an element sets and its children inherit. */
const DEFAULTS: LiveStyle = { userSelect: 'auto', display: 'block', visibility: 'visible', whiteSpace: 'normal', fontFamily: 'Inter, sans-serif' };
function styleOf(node: LiveNode): LiveStyle {
  const fake = node as Fake;
  const parent = fake.parentElement ? styleOf(fake.parentElement) : DEFAULTS;
  return { ...DEFAULTS, userSelect: parent.userSelect, visibility: parent.visibility, whiteSpace: parent.whiteSpace, fontFamily: parent.fontFamily, ...fake.style };
}

/** A point as the path of child indexes down to its node, then the offset: points compare as paths do, a prefix first. */
function pointPath(node: Fake, offset: number): number[] {
  const path = [offset];
  for (let n = node; n.parentElement; n = n.parentElement) path.unshift(n.parentElement.childNodes.indexOf(n));
  return path;
}
const compare = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
};
function rangeOf(startContainer: Fake, startOffset: number, endContainer: Fake, endOffset: number): LiveRange {
  const start = pointPath(startContainer, startOffset);
  const end = pointPath(endContainer, endOffset);
  const ancestors = (n: Fake) => {
    const list: Fake[] = [];
    for (let e: Fake | null = n; e; e = e.parentElement) list.push(e);
    return list;
  };
  const common = ancestors(startContainer).find((a) => ancestors(endContainer).includes(a))!;
  return {
    startContainer,
    startOffset,
    endContainer,
    endOffset,
    commonAncestorContainer: common,
    intersectsNode(node) {
      const n = node as Fake;
      if (!n.parentElement) return true;
      const index = n.parentElement.childNodes.indexOf(n);
      return compare(pointPath(n.parentElement, index), end) < 0 && compare(pointPath(n.parentElement, index + 1), start) > 0;
    },
    comparePoint(node, offset) {
      const point = pointPath(node as Fake, offset);
      return compare(point, start) < 0 ? -1 : compare(point, end) > 0 ? 1 : 0;
    },
  };
}
const root = (...children: (Fake | string)[]) => el('div', {}, { userSelect: 'text' }, ...children);
const text = (node: Fake) => node.childNodes[0]!;
const clip = (page: Fake, range: LiveRange, selected = 'browser text') => clipFromRange(page, range, styleOf, () => selected);

describe('clipFromRange', () => {
  it('keeps only what the range holds, when it starts in the middle of a paragraph after an inline mark', () => {
    const strong = el('strong', {}, {}, 'then');
    const after = txt(' check it all');
    const before = txt(' and ');
    const p = el('p', {}, {}, 'Run ', el('code', {}, {}, 'npm test'), before, strong, after);
    const page = root(p);
    const result = clip(page, rangeOf(before, 1, after, 6));
    expect(result?.html).toBe('and <strong>then</strong> check');
    expect(result?.text).toBe('browser text');
  });

  it('starts and ends in the middle of two paragraphs, without the text before and after', () => {
    const first = el('p', {}, {}, 'Hello world');
    const second = el('p', {}, {}, 'Second para');
    const page = root(el('p', {}, {}, 'Before'), first, second, el('p', {}, {}, 'After'));
    expect(clip(page, rangeOf(text(first), 4, text(second), 3))?.html).toBe('<p>o world</p><p>Sec</p>');
  });

  it('does not copy the next item after a triple-click, which ends at the start of it', () => {
    const beta = el('li', {}, {}, 'beta');
    const gamma = el('li', {}, {}, 'gamma');
    const page = root(el('ul', {}, {}, el('li', {}, {}, 'alpha'), beta, gamma));
    expect(clip(page, rangeOf(beta, 0, gamma, 0))?.html).toBe('<ul><li>beta</li></ul>');
    // The same with the end in the item's text, and for a paragraph.
    expect(clip(page, rangeOf(text(beta), 0, text(gamma), 0))?.html).toBe('<ul><li>beta</li></ul>');
    const p1 = el('p', {}, {}, 'one');
    const p2 = el('p', {}, {}, 'two');
    expect(clip(root(p1, p2), rangeOf(p1, 0, p2, 0))?.html).toBe('<p>one</p>');
  });

  it('keeps an empty cell the range holds, and drops one it only touches', () => {
    const a = el('td', {}, {}, 'a');
    const empty = el('td');
    const c = el('td', {}, {}, 'c');
    const row = el('tr', {}, {}, a, empty, c);
    const page = root(el('table', {}, {}, el('tbody', {}, {}, row)));
    expect(clip(page, rangeOf(a, 0, c, 1))?.html).toMatch(/<td [^>]*>a<\/td><td [^>]*><\/td><td [^>]*>c<\/td>/);
    expect(clip(page, rangeOf(a, 0, empty, 0))?.html).not.toContain('<td style="border:1px solid #d0d7de;padding:4px 8px;text-align:left;vertical-align:top"></td>');
  });

  it('leaves out text nobody could select, hidden elements and the speaker', () => {
    const body = el('p', {}, {}, 'Done.');
    const page = root(
      el('div', {}, {}, el('h2', { class: 'sr-only' }, { userSelect: 'none' }, 'Claude'), body, el('span', {}, { userSelect: 'none' }, el('span', {}, {}, '2m 14s')), el('span', { 'aria-hidden': 'true' }, {}, 'x'), el('span', {}, { display: 'none' }, 'y'), el('span', { hidden: '' }, {}, 'z')),
    );
    const result = clip(page, rangeOf(page, 0, page, 1));
    expect(result?.html).toBe('<div><p>Done.</p></div>');
  });

  it('counts the items before a selection into where an ordered list starts', () => {
    const third = el('li', {}, {}, 'three');
    const fourth = el('li', {}, {}, 'four');
    const page = root(el('ol', { start: '5' }, {}, el('li', {}, {}, 'a'), el('li', {}, {}, 'b'), third, fourth));
    expect(clip(page, rangeOf(text(third), 0, text(fourth), 4))?.html).toBe('<ol start="7"><li>three</li><li>four</li></ol>');
  });

  describe('a formula', () => {
    const formula = (tex: string, display = false) =>
      el(
        'span',
        { 'data-math-source': tex, ...(display ? { 'data-math-display': '' } : {}) },
        {},
        el('span', { class: 'katex-html' }, { userSelect: 'none' }, 'x2'),
        el('span', { class: 'katex-mathml' }, {}, el('math', {}, {}, el('annotation', {}, {}, tex))),
        el('span', { 'data-math-copy': '', class: 'sr-only' }, {}, `$${tex}$`),
      );

    it('is its source, once, in the HTML, and the text is what the browser copies when it has the TeX', () => {
      const before = txt('Let ');
      const inline = formula('x^2');
      const after = txt(' be it.');
      const block = formula('a+b', true);
      const page = root(el('p', {}, {}, before, inline, after), block);
      const result = clip(page, rangeOf(before, 0, block, 3), 'Let $x^2$ be it.\n$$a+b$$');
      expect(result?.html).toBe('<p>Let $x^2$ be it.</p><div>$$a+b$$</div>');
      expect(result?.text).toBe('Let $x^2$ be it.\n$$a+b$$');
    });

    it('makes the text from the clip when the browser text has no TeX', () => {
      const before = txt('Let ');
      const page = root(el('p', {}, {}, before, formula('x^2'), ' be it.'));
      expect(clip(page, rangeOf(before, 0, page.childNodes[0]!, 3), 'Let x2 be it.')?.text).toBe('Let $x^2$ be it.');
    });

    it('is the whole formula when the selection is inside it', () => {
      const inline = formula('x^2');
      const page = root(el('p', {}, {}, 'Let ', inline, ' be'));
      const inside = inline.childNodes[1]!.childNodes[0]!;
      const result = clip(page, rangeOf(inside, 0, inside, 1), '$x^2$');
      expect(result?.html).toBe('$x^2$');
      expect(result?.text).toBe('$x^2$');
    });
  });

  it('copies only the summary of a closed details, and all of an open one', () => {
    const closed = el('details', {}, {}, el('summary', {}, {}, 'Title'), el('p', {}, {}, 'Hidden body'));
    expect(clip(root(closed), rangeOf(closed, 0, closed, 2))?.html).toBe('Title');
    const open = el('details', { open: '' }, {}, el('summary', {}, {}, 'Title'), el('p', {}, {}, 'Shown body'));
    expect(clip(root(open), rangeOf(open, 0, open, 2))?.html).toBe('Title<p>Shown body</p>');
  });

  it('leaves a selection that is not wholly inside the root to the browser, Select all included', () => {
    const p = el('p', {}, {}, 'Reply');
    const prose = root(el('h1', {}, {}, 'Title'), p);
    const body = el('body', {}, {}, el('nav', {}, {}, 'Sidebar'), prose);
    expect(clipFromRange(prose, rangeOf(body, 0, body, 2), styleOf, () => 'x')).toBeNull();
    expect(clipFromRange(prose, rangeOf(text(body.childNodes[0]!), 0, text(p), 3), styleOf, () => 'x')).toBeNull();
  });

  it('keeps the indent of lines in a monospace block that keeps its breaks, as one code block, when the rows inherit the font from the container', () => {
    const rows: Partial<LiveStyle> = { whiteSpace: 'pre' };
    const first = el('div', {}, rows, '    return x;');
    const second = el('div', {}, rows, '+ added');
    const container = el('div', {}, { fontFamily: 'ui-monospace, monospace' }, el('div', {}, rows, 'before'), first, second, el('div', {}, rows, 'after'));
    const page = root(container);
    expect(clip(page, rangeOf(text(first), 0, text(second), 7))?.html).toMatch(/^<pre style="[^"]*monospace[^"]*">    return x;\n\+ added<\/pre>$/);
    // All of it: the container's font stays on it, and its rows are one block.
    expect(clip(page, rangeOf(container, 0, container, 4))?.html).toMatch(/^<pre style="[^"]*">before\n    return x;\n\+ added\nafter<\/pre>$/);
  });
});
