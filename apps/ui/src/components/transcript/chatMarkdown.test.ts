import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import type { PluggableList } from 'unified';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';
import { remarkAlerts } from '../filePreview/remarkAlerts.ts';
import { remarkBareLinks } from './bareLinks.ts';
import { chatSchema } from './chatSchema.ts';
import { fileUrlTransform } from './fileRefs.ts';
import { remarkSkimFade } from './skimFade.ts';
import { healMarkdown, splitBlocks } from './streamingMarkdown.ts';

// The same plugins, in the same order, as `Markdown.tsx` (which can't load here: it imports the stores).
const REMARK: PluggableList = [remarkGfm, remarkBareLinks, remarkAlerts];
const REHYPE: PluggableList = [rehypeRaw, [rehypeSanitize, chatSchema]];

const render = (text: string, keep: readonly number[] | null = null) =>
  renderToStaticMarkup(
    createElement(ReactMarkdown, { remarkPlugins: keep ? [...REMARK, [remarkSkimFade, { keep }]] : REMARK, rehypePlugins: REHYPE, urlTransform: fileUrlTransform }, text),
  );

describe('Markdown in a reply', () => {
  it('renders the plain Markdown it did before', () => {
    const html = render('# Title\n\n#### Small\n\nSome **bold** and `code`.\n\n---\n\n> quoted\n\n1. one\n2. two');
    for (const tag of ['<h1>', '<h4>', '<strong>bold</strong>', '<code>code</code>', '<hr/>', '<blockquote>', '<ol>']) expect(html).toContain(tag);
  });

  it('keeps a quote with bold text, a list and inline code', () => {
    const html = render('> Hey, **thanks**\n>\n> 1. first `a`\n> 2. second');
    expect(html).toMatch(/<blockquote>[\s\S]*<strong>thanks<\/strong>[\s\S]*<ol>[\s\S]*<code>a<\/code>[\s\S]*<\/blockquote>/);
  });

  it('renders safe HTML: a break in a table cell, details, kbd, sub and sup', () => {
    const html = render('| a | b |\n|---|---|\n| one<br>two | x |\n\n<details><summary>More</summary>\n\nHidden **text**\n\n</details>\n\nPress <kbd>Ctrl</kbd> H<sub>2</sub>O x<sup>2</sup>');
    expect(html).toMatch(/<td>one<br\/>two<\/td>/);
    for (const tag of ['<details>', '<summary>More</summary>', '<strong>text</strong>', '<kbd>Ctrl</kbd>', '<sub>2</sub>', '<sup>2</sup>']) expect(html).toContain(tag);
  });

  it('drops scripts, handlers, styles, frames, forms and javascript: links', () => {
    const html = render(
      '<script>alert(1)</script>\n\n<p onclick="x()" style="color:red" class="big">hi</p>\n\n<iframe src="https://example.com"></iframe>\n\n<a href="javascript:alert(1)">bad</a>\n\n<img src="x" onerror="y()">\n\n<form action="/x"><input name="a"></form>',
    );
    expect(html).not.toMatch(/script|alert|onclick|onerror|style=|class=|iframe|javascript:|<form/i);
    expect(html).toContain('hi');
  });

  it('turns the five GitHub alerts into marked blockquotes', () => {
    for (const kind of ['note', 'tip', 'important', 'warning', 'caution']) {
      const html = render(`> [!${kind.toUpperCase()}]\n> Be careful.`);
      expect(html).toContain(`data-alert="${kind}"`);
      expect(html).toContain('data-alert-title');
      expect(html).not.toContain('[!');
    }
  });

  it('turns task lists into list items with a disabled checkbox, checked or not', () => {
    const html = render('- [ ] open\n- [x] done\n- plain');
    expect(html).toContain('class="contains-task-list"');
    expect(html).toContain('class="task-list-item"');
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*disabled/);
    expect(html.match(/checked/g)).toHaveLength(1);
  });

  it('keeps what the renderer itself makes: file links, language classes, footnotes, Skim fading', () => {
    const files = render('[a](src/a.ts#L12) [b](file:///a/b.md) [c](C:/a.ts) [d](https://example.com) [e](mailto:a@b.c)');
    for (const href of ['href="src/a.ts#L12"', 'href="file:///a/b.md"', 'href="C:/a.ts"', 'href="https://example.com"', 'href="mailto:a@b.c"']) expect(files).toContain(href);
    expect(render('```ts\nconst a = 1;\n```')).toContain('class="language-ts"');
    const footnote = render('Text[^1]\n\n[^1]: The note');
    expect(footnote).toContain('data-footnote-ref');
    expect(footnote).toContain('data-footnotes');
    expect(footnote).toContain('The note');
    // The links still point at the notes.
    expect(footnote).toContain('href="#user-content-fn-1"');
    expect(footnote).toContain('id="user-content-fn-1"');
    expect(footnote).toContain('id="user-content-fnref-1"');
    // An `id` of someone's HTML is dropped.
    expect(render('<p id="root">x</p>')).not.toContain('id=');
    const faded = render('Kept sentence. Faded sentence. Another one.', [1]);
    expect(faded).toContain('data-skim-faded');
    expect(faded).toContain('class="text-faint"');
  });

  it('does not load images from disk and links no other protocol', () => {
    const html = render('![x](file:///a/b.png)\n\n<img src="file:///a/b.png">\n\n[x](vbscript:run) [y](data:text/html,hi)');
    expect(html).not.toMatch(/file:|vbscript|data:text/);
  });

  it('leaves a lone < alone and keeps the body of an open details block', () => {
    expect(render('a < b and c > d')).toContain('a &lt; b and c &gt; d');
    expect(render('<details><summary>Open</summary>\n\nBody')).toContain('Body');
  });
});

describe('a reply still being written', () => {
  const stream = (text: string) => render(healMarkdown(text));

  it('leaves half a tag out until it is complete', () => {
    for (const half of ['Line one <br', 'Line one <deta', 'Line one </summ', 'Line one <a href="x', 'Line one <!-']) {
      const html = stream(half);
      expect(html).toContain('Line one');
      expect(html).not.toContain('&lt;');
    }
  });

  it('keeps half a tag inside code', () => {
    expect(healMarkdown('Use `<div')).toContain('<div');
    expect(healMarkdown('```html\n<div')).toContain('<div');
  });

  it('shows the text before an open details block', () => {
    const html = stream('Intro\n\n<details>\n<summary>More</summary>\n\nBody **so far');
    expect(html).toContain('Intro');
    expect(html).toContain('<strong>so far</strong>');
  });

  it('keeps what is inside a details block in its block while it is written', () => {
    const text = 'Intro\n\n<details>\n<summary>More</summary>\n\nHidden **text**\n\n- a\n- b\n\n</details>\n\nAfter';
    const blocks = splitBlocks(text);
    expect(blocks.join('')).toBe(text);
    expect(blocks.map((b) => b.trim())).toEqual(['Intro', '<details>\n<summary>More</summary>\n\nHidden **text**\n\n- a\n- b\n\n</details>', 'After']);
    // Still open: everything after it stays in it.
    expect(splitBlocks('<details>\n<summary>More</summary>\n\nHidden').length).toBe(1);
  });
});
