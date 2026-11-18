import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { describe, expect, it } from 'vitest';
import { previewSchema } from '../filePreview/sanitizeSchema.ts';
import { REHYPE_PLUGINS, REMARK_REHYPE_OPTIONS, remarkPluginsFor } from './chatPlugins.ts';
import { fileUrlTransform } from './fileRefs.ts';
import { replySentences } from './skimFade.ts';
import { healMarkdown, splitBlocks } from './streamingMarkdown.ts';

// The plugins `Markdown.tsx` renders with (`chatPlugins.ts`).
const render = (text: string, keep: readonly number[] | null = null) =>
  renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      { remarkPlugins: remarkPluginsFor(keep), rehypePlugins: REHYPE_PLUGINS, remarkRehypeOptions: REMARK_REHYPE_OPTIONS, urlTransform: fileUrlTransform },
      text,
    ),
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
      '<script>alert(1)</script>\n\n<p onclick="x()" style="color:red" class="big">hi</p>\n\n<iframe src="https://example.com"></iframe>\n\n<a href="javascript:alert(1)">bad</a>\n\n<img src="https://example.com/x" onerror="y()">\n\n<form action="/x"><input name="a"></form>',
    );
    // Nothing of it is an element or an attribute; what is not a tag the sanitiser keeps shows as the text it was.
    expect(html).not.toMatch(/script|alert|onclick|onerror|style=|class=|javascript:|<(?:iframe|form|input)/i);
    expect(html).toContain('hi');
  });

  it('turns the five GitHub alerts into marked blockquotes', () => {
    for (const kind of ['note', 'tip', 'important', 'warning', 'caution']) {
      const html = render(`> [!${kind.toUpperCase()}]\n> Be careful.`);
      expect(html).toContain(`data-alert="${kind}"`);
      expect(html).toContain('data-alert-title');
      expect(html).not.toContain('[!');
      expect(html).not.toContain('data-seal');
    }
  });

  it('turns task lists into list items with a disabled checkbox, checked or not', () => {
    const html = render('- [ ] open\n- [x] done\n- plain');
    expect(html).toContain('class="contains-task-list"');
    expect(html).toContain('class="task-list-item"');
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*disabled/);
    expect(html.match(/checked/g)).toHaveLength(1);
    // A task list inside a task keeps its classes.
    expect(render('- [ ] a\n  - [x] b')).toMatch(/contains-task-list[\s\S]*contains-task-list/);
  });

  it('keeps what the renderer itself makes: file links, language classes, footnotes, Skim fading', () => {
    const files = render('[a](src/a.ts#L12) [b](file:///a/b.md) [c](C:/a.ts) [d](https://example.com) [e](mailto:a@b.c)');
    for (const href of ['href="src/a.ts#L12"', 'href="file:///a/b.md"', 'href="C:/a.ts"', 'href="https://example.com"', 'href="mailto:a@b.c"']) expect(files).toContain(href);
    const footnote = render('Text[^1]\n\n[^1]: The note');
    expect(footnote).toContain('data-footnote-ref');
    expect(footnote).toContain('data-footnotes');
    expect(footnote).toContain('The note');
    // The links still point at the notes.
    const link = /href="#([^"]+fn-1)"/.exec(footnote)?.[1];
    expect(link).toBeTruthy();
    expect(footnote).toContain(`id="${link}"`);
    const back = /href="#([^"]+fnref-1)"/.exec(footnote)?.[1];
    expect(footnote).toContain(`id="${back}"`);
    const faded = render('Kept sentence. Faded sentence. Another one.', [1]);
    expect(faded).toContain('data-skim-faded');
    expect(faded).toContain('class="text-faint"');
    expect(faded).not.toContain('data-seal');
  });

  it('keeps code classes: dotted and any-case languages', () => {
    for (const language of ['ts', 'foo.bar', 'c++', 'Mermaid', 'language-math']) expect(render(`\`\`\`${language}\nx\n\`\`\``)).toContain(`class="language-${language}"`);
    expect(render('<code class="evil language-js">y</code>')).not.toContain('evil');
  });

  it('links an address with an upper-case protocol', () => {
    expect(render('[x](HTTPS://example.com/a) <a href="HTTP://example.com">y</a>')).toMatch(/href="https:\/\/example.com\/a"[\s\S]*href="http:\/\/example.com"/);
    expect(render('[x](JaVaScRiPt:alert(1))')).not.toMatch(/javascript/i);
  });
});

describe('what a reply may load', () => {
  it('drops picture and source, whatever their srcset holds', () => {
    for (const html of [
      '<picture><source srcset="file://evil.example/share/x.png"><img src="https://example.com/a.png"></picture>',
      '<picture><source srcset="//evil.example/x.png 2x"></picture>',
    ]) expect(render(html)).not.toMatch(/<(?:source|picture)|(?:src|srcset|href)="[^"]*evil/i);
    // The same in a previewed file's schema.
    expect(previewSchema.tagNames).not.toContain('picture');
    expect(previewSchema.tagNames).not.toContain('source');
    expect(previewSchema.attributes?.source ?? []).toEqual([]);
  });

  it('loads an image only from an absolute http(s) address', () => {
    for (const src of ['//evil.example/x.png', '\\\\evil\\x.png', 'file://evil.example/x.png', 'file:///a/b.png', '/a/b.png', 'a/b.png', 'data:image/png;base64,AAAA', 'ftp://evil.example/x.png']) {
      expect(render(`<img src="${src}">`), src).not.toMatch(/src="[^"]/);
      if (!/[\\\s)]/.test(src)) expect(render(`![x](${src})`), src).not.toMatch(/src="[^"]/);
    }
    expect(render('![x](\\\\evil\\x.png)')).not.toMatch(/src="[^"]/);
    expect(render('![x](https://example.com/a.png)')).toContain('src="https://example.com/a.png"');
    expect(render('<img src="HTTPS://example.com/a.png">')).toContain('src="https://example.com/a.png"');
  });

  it('takes no keyboard, form or id attributes', () => {
    const html = render('<p tabindex="0" accesskey="x" id="root" aria-labelledby="root">a</p>\n\n<a href="https://example.com" tabindex="1" accesskey="k" action="x" method="post" enctype="t">b</a>');
    expect(html).not.toMatch(/tabindex|accesskey|id=|aria-labelledby|action|method|enctype/i);
    expect(html).toContain('>a<');
    expect(render('<form action="/x"><input name="a"></form>')).not.toMatch(/<(?:form|input)/);
  });

  it('cannot forge the marks of the app', () => {
    const html = render(
      '<span class="text-faint" data-skim-faded>x</span> <span data-seal="x:skim">y</span>\n\n<blockquote data-alert="caution">q</blockquote>\n\n<p data-alert-title>t</p>\n\n<p id="user-content-fn-1">z</p><p id="footnote-label">w</p>',
    );
    // The footnotes' own heading has its id.
    expect(render('Text[^1]\n\n[^1]: The note')).toContain('id="footnote-label"');
    expect(html).not.toMatch(/text-faint|data-skim-faded|data-seal|data-alert|id=|class=/);
    expect(html).toContain('>x<');
  });
});

describe('text that only looks like a tag', () => {
  it('stays as written', () => {
    expect(render('Returns Promise<void> and Vec<u8>')).toContain('Returns Promise&lt;void&gt; and Vec&lt;u8&gt;');
    expect(render('git checkout <branch> then push.')).toContain('git checkout &lt;branch&gt; then push.');
    expect(render('Set it:\n\n<your-token>\n\nthen go')).toMatch(/<p>&lt;your-token&gt;<\/p>/);
    expect(render('if x<y and z>w')).toContain('if x&lt;y and z&gt;w');
    expect(render('- <flag> on\n- off <flag>')).toContain('&lt;flag&gt; on');
    expect(render('> `<a>` and <b2> in a quote')).toContain('&lt;b2&gt;');
  });

  it('still renders the tags it knows, and drops comments, style and the rest of the page', () => {
    expect(render('x <b>bold</b> <br> y')).toContain('<b>bold</b>');
    expect(render('x <!-- hidden --> y')).not.toContain('hidden');
    expect(render('<style>body { color: red }</style>\n\nafter')).not.toMatch(/color|body|style/);
    expect(render('a <style>p { color: red }</style> b')).not.toMatch(/color|style/);
    expect(render('<title>t</title><textarea>secret</textarea>after')).not.toMatch(/secret|>t</);
    expect(render('<script>alert(1)</script>')).not.toMatch(/script|alert/);
  });

  it('numbers Skim sentences as it renders them', () => {
    const text = 'It returns Promise<void> when done. The next sentence follows. And one more.';
    expect(replySentences(text)).toHaveLength(3);
    expect(render(text, [1])).toContain('data-skim-faded');
  });
});

describe('a reply still being written', () => {
  const stream = (text: string) => render(healMarkdown(text));

  it('leaves half a tag out until it is complete', () => {
    for (const half of ['Line one <br', 'Line one <deta', 'Line one </summ', 'Line one <a href="x', 'Line one <!-', 'Line one <kb']) {
      const html = stream(half);
      expect(html).toContain('Line one');
      expect(html).not.toContain('&lt;');
    }
  });

  it('leaves a lone <, a comparison and text in angle brackets alone', () => {
    expect(healMarkdown('Use x<y when it is smaller\nand then more text')).toBe('Use x<y when it is smaller\nand then more text');
    expect(healMarkdown('Returns Promise<void')).toBe('Returns Promise<void');
    expect(healMarkdown('if a <')).toBe('if a <');
    // A tag that was typed in full, with attributes, only goes while it is the last thing.
    expect(healMarkdown('line one\n<details open')).toBe('line one\n');
    expect(healMarkdown('<br tail\nmore')).toBe('<br tail\nmore');
  });

  it('keeps half a tag inside code, also in a list item, a quote and across lines', () => {
    expect(healMarkdown('Use `<div')).toContain('<div');
    expect(healMarkdown('```html\n<div')).toContain('<div');
    expect(healMarkdown('- item\n  ```html\n  <div')).toContain('<div');
    expect(healMarkdown('1. item\n   ~~~\n   <details')).toContain('<details');
    expect(healMarkdown('> ```\n> <div')).toContain('<div');
    expect(healMarkdown('Use `foo\nbar <div')).toContain('<div');
    // A closed fence is not code any more.
    expect(healMarkdown('```\nx\n```\n\nthen <div')).not.toContain('<div');
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

  it('does not stay in a details block that a comment, code or the end of a paragraph says otherwise about', () => {
    expect(splitBlocks('<!-- <details> -->\n\nOne\n\nTwo')).toHaveLength(3);
    expect(splitBlocks('Use `<details>` here\n\nOne\n\nTwo')).toHaveLength(3);
    expect(splitBlocks('```html\n<details>\n```\n\nOne\n\nTwo')).toHaveLength(3);
    // A closing tag at the end of a paragraph closes it.
    const closed = splitBlocks('<details>\n<summary>s</summary>\n\nBody </details>\n\nOne\n\nTwo');
    expect(closed).toHaveLength(3);
    expect(closed[0]).toContain('</details>');
  });
});
