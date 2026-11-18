import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FILE_REHYPE_PLUGINS, FILE_REMARK_PLUGINS } from '../filePreview/markdownPlugins.ts';
import { drawMath, katexNow, loadKatex, MAX_FORMULA } from './katex.ts';
import { MathCode, MathDrawnContext, streamingBlocks } from './Maths.tsx';
import { mathKind, mathSourceText, remarkMaths } from './maths.ts';
import { fadeCountOf, keepFromMarks, replySentences } from './skimFade.ts';
import { opensMath, splitBlocks } from './streamingMarkdown.ts';

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

/** The text of rendered HTML: tags dropped, entities decoded. */
const textOf = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');

/** The HTML without the hidden TeX a drawn formula carries for a copy (`data-math-copy`). */
const shown = (html: string) => html.replace(/<span data-math-copy[^>]*>[^<]*<\/span>/g, '');

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
    expect(shown(html)).not.toContain('$x^2');
    // What a selection holds: the TeX, in its delimiters.
    expect(html).toContain('data-math-copy="true" aria-hidden="true" class="absolute top-0 left-0 size-px overflow-hidden whitespace-pre opacity-0">$x^2 + y^2 = z^2$</span>');
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
    // Shell variables and paths.
    '$HOME/$USER',
    'export PATH=$HOME/bin:$PATH',
    '${HOME}/${USER}',
    '$FOO=$BAR',
    'files in $HOME/.claude/$PROJECT',
    '($FOO) and ($BAR)',
    'echo "$FOO" "$BAR"',
    'bash: "$@" and "$*"',
    'grep "^x$" file and "^y$"',
    "R's df$col and df$other",
    'a$b and c$d',
    '10$-20$',
    'github.com/a$b$c',
  ];
  it.each(stays)('keeps "%s" as text', (text) => {
    expect(mathNodes(text)).toEqual([]);
    const html = chat(text);
    expect(html).not.toContain('katex');
    expect(textOf(html)).toBe(text);
  });

  it('still draws a formula next to a price', () => {
    expect(mathNodes('It costs $5 and $10, and $x^2$ is a square.')).toEqual(['inlineMath:x^2']);
    expect(mathNodes('Pay $5 for $a_1 + a_2$ here')).toEqual(['inlineMath:a_1 + a_2']);
  });

  it('draws the usual formulas', () => {
    expect(mathNodes('$x^2$')).toEqual(['inlineMath:x^2']);
    expect(mathNodes('Both $a$ and $b$ are real, so $n$.')).toEqual(['inlineMath:a', 'inlineMath:b', 'inlineMath:n']);
    expect(mathNodes('The $x$-axis, $y$, and ($z$); is $w$?')).toEqual(['inlineMath:x', 'inlineMath:y', 'inlineMath:z', 'inlineMath:w']);
    expect(mathNodes('Cost is $5 and $O(n)$ here, $$n^2$$ too')).toEqual(['inlineMath:O(n)', 'inlineMath:n^2']);
    expect(mathNodes('Is $O(n \\log n)$ enough? $2^{10}$ is 1024.')).toEqual(['inlineMath:O(n \\log n)', 'inlineMath:2^{10}']);
    expect(mathNodes('($x$)')).toEqual(['inlineMath:x']);
  });

  it('draws a formula next to Markdown marks, operators and brackets', () => {
    const draws = ['**$x$**', '*$x$*', '_$x$_', '~~$x$~~', '$x$<br>', '$x$|', '$x$>0', '«$x$»', '$x$ here', '$x$\u00a0here', '[$x$]', '$x$:'];
    for (const text of draws) expect(mathNodes(text), text).toEqual(['inlineMath:x']);
    expect(mathNodes('$x$/$y$')).toEqual(['inlineMath:x', 'inlineMath:y']);
    expect(mathNodes('$a$+$b$')).toEqual(['inlineMath:a', 'inlineMath:b']);
    expect(mathNodes('$x$=$y$')).toEqual(['inlineMath:x', 'inlineMath:y']);
    expect(mathNodes('$x$×$y$')).toEqual(['inlineMath:x', 'inlineMath:y']);
    // The marks still do their work around it.
    expect(chat('**$x$**')).toMatch(/<strong>[^]*class="katex"/);
    expect(chat('~~$x$~~')).toMatch(/<del>[^]*class="katex"/);
  });

  it('draws a formula in Chinese and Japanese text, which has no spaces', () => {
    expect(mathNodes('设$x$为实数')).toEqual(['inlineMath:x']);
    expect(mathNodes('日本$x$日本')).toEqual(['inlineMath:x']);
    expect(mathNodes('令$x$。')).toEqual(['inlineMath:x']);
    expect(mathNodes('令$x$，$y$、$z$；')).toEqual(['inlineMath:x', 'inlineMath:y', 'inlineMath:z']);
    expect(mathNodes('한국어$x$한국어')).toEqual(['inlineMath:x']);
    // Prices and variables still don't, next to a character of these scripts or not.
    expect(mathNodes('价格是$5和$10')).toEqual([]);
  });

  it('does not take the shell\'s $@, $*, $? and $# for a formula', () => {
    for (const text of ['"$@" and "$*"', 'status $? and $#', 'run $@ then $*.', 'echo "$#" "$?"']) expect(mathNodes(text), text).toEqual([]);
  });

  it('does not read a block from a $$ that is a sentence, but still from a fence with a meta', () => {
    expect(mathNodes('$$ is the shell pid\n\nNext.')).toEqual([]);
    expect(chat('$$ is the shell pid\n\nNext.')).toContain('Next.');
    expect(chat('$$ is the shell pid\n\nNext.')).not.toContain('katex');
    expect(mathNodes('$$x$$')).toEqual(['inlineMath:x']);
    expect(mathNodes('$$latex\nx\n$$')).toEqual(['math:x']);
    expect(mathNodes('$$  \nx\n$$')).toEqual(['math:x']);
    expect(mathNodes('- $$\n  x\n  $$')).toHaveLength(1);
  });

  it('draws a $$ formula written on one line with spaces, alone or in a list item', () => {
    const lines = ['$$ E = mc^2 $$', '$$ \\sum_{i=1}^n i = \\frac{n(n+1)}{2} $$', '$$E = mc^2$$'];
    for (const line of lines) {
      for (const text of [line, `Before.\n\n${line}\n\nAfter.`, `- ${line}`, `- item\n- ${line}\n- item`, `> ${line}`]) {
        const html = chat(text);
        expect(html, text).toContain('data-math="display"');
        expect(html, text).toContain('katex-display');
        expect(mathNodes(text).some((node) => node.startsWith('inlineMath:')), text).toBe(true);
        // And it is no block that holds the rest of a streaming reply.
        expect(opensMath(text), text).toBe(false);
      }
    }
    expect(splitBlocks('$$ E = mc^2 $$\n\nNext.')).toHaveLength(2);
  });

  it('keeps $$ working as remark-math does', () => {
    expect(mathNodes('$$ x + 1 $$')).toEqual(['inlineMath:x + 1']);
  });

  it('does not touch a dollar in code', () => {
    const html = chat('Run `echo $5 and $x$` and\n\n```sh\necho $x$\n```');
    expect(html).not.toContain('katex');
  });
});

describe('maths inside other Markdown', () => {
  it('is drawn in a list, a table, a quote and an alert', () => {
    expect(chat('- item $a_1$\n- item $b_1$')).toMatch(/<li>[^]*class="katex"[^]*<\/li>/);
    expect(chat('| a | b |\n|---|---|\n| $x^2$ | $y$ |')).toMatch(/<td>[^]*class="katex"/);
    expect(chat('> a quote with $x$')).toMatch(/<blockquote>[^]*class="katex"/);
    const alert = file('> [!NOTE]\n> Remember $E = mc^2$.');
    expect(alert).toContain('data-alert="note"');
    expect(alert).toContain('class="katex"');
    expect(chat('1. step\n\n   $$\n   a+b\n   $$')).toContain('katex-display');
  });

  it('keeps a blank line inside a $$ block, both parsed and while streaming', () => {
    expect(mathNodes('$$\na\n\nb\n$$')).toEqual(['math:a\n\nb']);
    const blocks = splitBlocks('Before.\n\n$$\na\n\nb');
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toBe('$$\na\n\nb');
    // Once it is closed, what follows is a block of its own again.
    expect(splitBlocks('$$\na\n\nb\n$$\n\nAfter.')).toEqual(['$$\na\n\nb\n$$\n\n', 'After.']);
    // A `$$` in a code fence or in code is text.
    expect(splitBlocks('```\n$$\n```\n\nNext')).toHaveLength(2);
    expect(splitBlocks('`$$` x\n\nNext')).toHaveLength(2);
  });

  it('keeps the TeX for a copy, and the glyphs out of the selection', () => {
    const inline = chat('A $x^2$ b');
    expect(inline).toContain('data-math-source="x^2"');
    expect(inline).not.toContain('data-math-display');
    expect(inline).toContain('data-math-visual');
    expect(chat('$$\ny\n$$')).toMatch(/data-math="block" data-math-source="y" data-math-display=""/);
  });
});

describe('a $$ block while streaming', () => {
  it('opens only for a $$ at the start of a line', () => {
    expect(opensMath('$$\na')).toBe(true);
    expect(opensMath('  $$\na')).toBe(true);
    expect(opensMath('$$\\frac{a}{b}')).toBe(true);
    expect(opensMath('$$\na\n$$')).toBe(false);
    expect(opensMath('pid $$ is the shell.')).toBe(false);
    expect(opensMath('One $$x$$ here\n\nand $$y$$')).toBe(false);
    expect(opensMath('$$x$$')).toBe(false);
  });
  it('ignores $$ in code', () => {
    expect(opensMath('```sh\n$$\n```')).toBe(false);
    expect(opensMath('```sh\n$$')).toBe(false);
    expect(opensMath('~~~\n$$\n~~~\n\nafter')).toBe(false);
    // A shorter fence inside a longer one is text, so what follows is still code.
    expect(opensMath('````md\n```\n$$\n```\n$$\n````')).toBe(false);
    // Indented code is not a $$ line.
    expect(opensMath('    $$\n    x')).toBe(false);
    // Inside a block a fence is text.
    expect(opensMath('$$\n```\n')).toBe(true);
  });
  it('sees a $$ block in a list item or a quote', () => {
    expect(opensMath('- $$\n  x')).toBe(true);
    expect(opensMath('- $$\n  x\n  $$')).toBe(false);
    expect(opensMath('1. $$\n   x')).toBe(true);
    expect(opensMath('> $$\n> x')).toBe(true);
    expect(opensMath('> $$\n> x\n> $$')).toBe(false);
    expect(opensMath('- > $$\n  > x')).toBe(true);
    expect(opensMath('* * $$\n    x')).toBe(true);
    expect(splitBlocks('- $$\n  x\n\n  y\n  $$\n\nAfter.')).toHaveLength(2);
    expect(splitBlocks('> $$\n> x\n>\n> y\n> $$\n\nAfter.')).toHaveLength(2);
    expect(splitBlocks('1. step\n\n   $$\n   a\n\n   b\n   $$\n\nAfter.')).toHaveLength(2);
  });
  it('does not take a $$ sentence for a block', () => {
    expect(opensMath('$$ is the shell pid')).toBe(false);
    expect(opensMath('$$ is the shell pid\n\nNext.')).toBe(false);
    expect(splitBlocks('$$ is the shell pid\n\nNext.\n\nThen.')).toHaveLength(3);
    // A fence's meta, nothing, or spaces after it still open one.
    expect(opensMath('$$latex\nx')).toBe(true);
    expect(opensMath('$$   \nx')).toBe(true);
    expect(opensMath('$$\nx')).toBe(true);
  });
  it('does not merge the rest of a reply after a stray $$', () => {
    const blocks = splitBlocks('The pid $$ is the shell.\n\nSecond.\n\nThird.');
    expect(blocks).toHaveLength(3);
  });
  it('reads a long reply once, not once for every block', () => {
    const text = `Start $$ here\n\n${Array.from({ length: 4000 }, (_, i) => `Paragraph ${i} with some words in it.`).join('\n\n')}`;
    expect(text.length).toBeGreaterThan(150_000);
    const begun = performance.now();
    const blocks = splitBlocks(text);
    expect(blocks.length).toBeGreaterThan(3999);
    // Generous: it took a second and more when every block was read again from its start.
    expect(performance.now() - begun).toBeLessThan(5_000);
    // And an open block really does take everything until its end.
    expect(splitBlocks(`$$\na\n\n${text.replace('Start $$ here', 'Start')}`)).toHaveLength(1);
  });
});

describe('streaming', () => {
  it('turns drawing off only for the last block', () => {
    const blocks = ['First $a$ done.\n\n', 'Second $b$ done.\n\n', 'Third $c$ in progress'];
    const html = renderToStaticMarkup(
      createElement('div', null, streamingBlocks(blocks, (text) => createElement(ReactMarkdown, { remarkPlugins: [remarkMaths], components }, text))),
    );
    expect(html.match(/data-math="inline"/g)).toHaveLength(2);
    expect(html).toContain('$c$');
    expect(shown(html)).not.toContain('$a$');
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
  it('matches a keep quote that has a formula in it', () => {
    const sentences = replySentences('The bound $O(n)$ holds. Nothing else.');
    expect(keepFromMarks(sentences, ['The bound $O(n)$ holds'])).toEqual([1]);
    expect(keepFromMarks(sentences, ['The bound O(n) holds'])).toEqual([1]);
  });
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

describe('KaTeX limits', () => {
  it('limits a box or a rule to 10em, so a formula cannot draw over the page', () => {
    const html = drawMath(katexOf(), '\\rule{1em}{2000em}', false)!;
    // The TeX stays in the annotation; what is drawn (the styles) is clamped.
    expect(html).not.toMatch(/style="[^"]*2000em/);
    expect(html).toContain('border-top-width:10em');
    expect(drawMath(katexOf(), '\\raisebox{40em}{x}', false)!).not.toMatch(/style="[^"]*40em/);
  });
  it('draws a long derivation: 26 lines of \\implies in an aligned block', () => {
    const lines = Array.from({ length: 26 }, (_, i) => `x_{${i}} &\\implies x_{${i + 1}}`).join(' \\\\ ');
    expect(drawMath(katexOf(), `\\begin{aligned} ${lines} \\end{aligned}`, true)).toContain('katex');
  });
  it('shows the source of a formula that expands without end, or is very long', () => {
    expect(drawMath(katexOf(), '\\def\\a{\\a\\a}\\a', false)).toBeNull();
    expect(drawMath(katexOf(), 'x+'.repeat(MAX_FORMULA), false)).toBeNull();
    expect(drawMath(katexOf(), 'x+'.repeat(100), false)).toContain('katex');
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
