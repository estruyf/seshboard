import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FILE_REHYPE_PLUGINS, FILE_REMARK_PLUGINS } from '../filePreview/markdownPlugins.ts';
import { drawMath, katexNow, loadKatex } from './katex.ts';
import { MathCode, MathDrawnContext } from './Maths.tsx';
import { mathKind, mathSourceText, remarkMaths } from './maths.ts';
import { fadeCountOf, replySentences } from './skimFade.ts';

// The real CodeBlock needs the window (themes, highlighting); a stand-in with its parts is enough to see what a math block holds.
vi.mock('./CodeBlock.tsx', () => ({
  CodeBlock: ({ code, language, preview }: { code: string; language?: string; preview?: ReactNode }) =>
    createElement('div', { 'data-code-preview-block': preview ? '' : undefined, 'data-language': language }, preview ?? createElement('pre', null, code), preview && createElement('i', { 'data-code-view': 'source' })),
}));

beforeAll(async () => {
  await loadKatex();
});

/** The renderer's `code` for maths: the real `MathCode`, as `Markdown.tsx` calls it. */
const components: Components = {
  pre: ({ children }) => createElement('div', null, children),
  code: ({ className, children }) => {
    const kind = mathKind(className);
    return kind ? createElement(MathCode, { kind, source: String(children ?? '').replace(/\n$/, '') }) : createElement('code', null, children);
  },
};

/** An answer's Markdown, as the chat renders it (its plugins). */
const chat = (text: string, drawn = true) =>
  renderToStaticMarkup(createElement(MathDrawnContext, { value: drawn }, createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkMaths], components }, text)));

/** A previewed file's: its plugins, with raw HTML sanitised. */
const file = (text: string) =>
  renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: FILE_REMARK_PLUGINS, rehypePlugins: FILE_REHYPE_PLUGINS, components }, text));

/** What the parser makes of a text: the mdast nodes that are maths. */
function mathNodes(text: string): string[] {
  const out: string[] = [];
  const tree = remarkParseTree(text);
  const walk = (node: { type: string; value?: string; children?: never[] }) => {
    if (node.type === 'inlineMath' || node.type === 'math') out.push(`${node.type}:${node.value}`);
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return out;
}

function remarkParseTree(text: string) {
  return unified().use(remarkParse).use(remarkMaths).parse(text) as never;
}

describe('maths in Markdown', () => {
  it('draws inline maths with KaTeX', () => {
    const html = chat('Then $x^2 + y^2 = z^2$ holds.');
    expect(html).toContain('class="katex"');
    expect(html).toContain('data-math="inline"');
    expect(html).not.toContain('$x^2');
  });

  it('draws $$ blocks and math fences as a block with the Preview and Source switch', () => {
    for (const text of ['$$\n\\int_0^1 x\\,dx = \\frac12\n$$', '```math\n\\int_0^1 x\\,dx = \\frac12\n```']) {
      const html = chat(text);
      expect(html).toContain('data-code-preview-block');
      expect(html).toContain('katex-display');
      expect(html).toContain('data-math="block"');
      expect(html).toContain('data-code-view="source"');
    }
  });

  it('keeps the source of a block for Copy and the Source view', () => {
    // The source is what the Source view and Copy hold: the block's `code`, as written.
    const nodes = mathNodes('$$\na_1 + a_2\n$$');
    expect(nodes).toEqual(['math:a_1 + a_2']);
  });

  it('draws $$x$$ in a line of text on a line of its own', () => {
    const html = chat('Here: $$E = mc^2$$ done');
    expect(html).toContain('data-math="display"');
    expect(html).toContain('katex-display');
  });

  it('draws maths in a previewed file, and keeps it through the sanitiser', () => {
    const html = file('Inline $a_b$ and\n\n$$\n\\sum_{i=1}^n i\n$$\n\n<code class="evil">y</code>');
    expect(html).toContain('data-math="inline"');
    expect(html).toContain('data-math="block"');
    expect(html).toContain('class="katex"');
    expect(html).not.toContain('evil');
  });

  it('draws the colour of the text, never one of its own', () => {
    const html = chat('$x$ and $$\ny\n$$');
    expect(html).not.toMatch(/color:\s*#/);
  });

  it('shows the source of a formula that does not parse', () => {
    const inline = chat('Bad: $\\frac{1$ here');
    expect(inline).toContain('data-math-error');
    expect(inline).toContain('$\\frac{1$');
    const block = chat('$$\n\\frac{1\n$$');
    expect(block).toContain('data-math-error');
    expect(block).toContain('\\frac{1');
    expect(block).toContain('Couldn&#x27;t draw this formula.');
  });

  it('shows maths as written while the block is still streaming', () => {
    const inline = chat('Let $x^2$ be', false);
    expect(inline).not.toContain('katex');
    expect(inline).toContain('$x^2$');
    // An unclosed $$ at the end of the block is source, not half a formula.
    const open = chat('$$\n\\frac{a}{', false);
    expect(open).not.toContain('katex');
    expect(open).toContain('\\frac{a}{');
    expect(open).not.toContain('data-code-preview-block');
  });

  it('does not take a lone $ or an unclosed one for maths', () => {
    expect(mathNodes('Costs $5.')).toEqual([]);
    expect(mathNodes('Open $x^2 never closed')).toEqual([]);
    expect(mathNodes('a $ b')).toEqual([]);
  });
});

describe('dollar amounts', () => {
  const stays = [
    'it costs $5 and $10',
    'between $5 and $10, or more',
    'about $5-$10 a month',
    'from $100 (roughly $120 with tax) today',
    'pay $5/$10 per seat',
    'US$5 or $10.50',
    'set $HOME and $PATH first',
    'that is $1,000 up from $900.',
  ];
  it.each(stays)('keeps "%s" as text', (text) => {
    expect(mathNodes(text)).toEqual([]);
    const html = chat(text);
    expect(html).not.toContain('katex');
    expect(html).toContain(text.replace(/&/g, '&amp;'));
  });

  it('still draws a formula next to a price', () => {
    expect(mathNodes('It costs $5 and $10, and $x^2$ is a square.')).toEqual(['inlineMath:x^2']);
    expect(mathNodes('Pay $5 for $a_1 + a_2$ here')).toEqual(['inlineMath:a_1 + a_2']);
  });

  it('draws the usual formulas', () => {
    expect(mathNodes('$x^2$')).toEqual(['inlineMath:x^2']);
    expect(mathNodes('Both $a$ and $b$ are real, so the $n$th term')).toEqual(['inlineMath:a', 'inlineMath:b', 'inlineMath:n']);
    expect(mathNodes('Is $O(n \\log n)$ enough? $2^{10}$ is 1024.')).toEqual(['inlineMath:O(n \\log n)', 'inlineMath:2^{10}']);
    expect(mathNodes('($x$)')).toEqual(['inlineMath:x']);
  });

  it('keeps $$ working as remark-math does', () => {
    expect(mathNodes('$$ x + 1 $$')).toEqual(['inlineMath:x + 1']);
  });

  it('does not touch a dollar in code', () => {
    const html = chat('Run `echo $5 and $x$` and\n\n```sh\necho $x$\n```');
    expect(html).not.toContain('katex');
  });
});

describe('mathKind', () => {
  it('tells the three kinds from a code element\'s class', () => {
    expect(mathKind('language-math math-inline')).toBe('inline');
    expect(mathKind('language-math math-inline math-display-inline')).toBe('display');
    expect(mathKind('language-math math-display')).toBe('block');
    expect(mathKind('language-math')).toBe('block');
    expect(mathKind('language-ts')).toBeNull();
    expect(mathKind(undefined)).toBeNull();
  });
  it('writes a formula back the way it was written', () => {
    expect(mathSourceText('inline', 'x')).toBe('$x$');
    expect(mathSourceText('display', 'x')).toBe('$$x$$');
    expect(mathSourceText('block', 'x')).toBe('x');
  });
});

describe('Skim', () => {
  it('treats an inline formula as one piece of a sentence', () => {
    // The formula's own full stop and space don't end a sentence (a formula's text is its source, without the dollars).
    const sentences = replySentences('Take $a. b$ and add it. Then stop.');
    expect(sentences).toEqual(['Take a. b and add it.', 'Then stop.']);
  });
  it('counts the same sentences with and without a formula in them', () => {
    const count = fadeCountOf('We use $x^2$ here. The result holds. Nothing else.', []);
    expect(count.total).toBe(3);
  });
});

describe('KaTeX', () => {
  it('draws a formula once and gives null for one that does not parse', () => {
    expect(drawMath(katexOf(), 'x^2', false)).toContain('katex');
    expect(drawMath(katexOf(), '\\frac{', false)).toBeNull();
  });
  it('does not follow \\href: nothing is trusted', () => {
    expect(drawMath(katexOf(), '\\href{https://example.com}{x}', false)).toBeNull();
  });
});

const katexOf = () => katexNow()!;
