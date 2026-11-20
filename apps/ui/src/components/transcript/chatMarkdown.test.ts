import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { describe, expect, it } from 'vitest';
import { previewSchema } from '../filePreview/sanitizeSchema.ts';
import { PLAIN_REHYPE_PLUGINS, REHYPE_PLUGINS, REMARK_REHYPE_OPTIONS, remarkPluginsFor } from './chatPlugins.ts';
import { escapeLoneTags } from './escapeLoneTags.ts';
import { fileUrlTransform } from './fileRefs.ts';
import { ReplyImage } from './ReplyImage.tsx';
import { replySentences } from './skimFade.ts';
import { healMarkdown, splitBlocks, streamingBlockTexts } from './streamingMarkdown.ts';

// What `Markdown.tsx` renders with: the text through `escapeLoneTags`, read once with the plugins of `chatPlugins.ts`.
const renderSource = (source: string, keep: readonly number[] | null = null) =>
  renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      { remarkPlugins: remarkPluginsFor(keep), rehypePlugins: REHYPE_PLUGINS, remarkRehypeOptions: REMARK_REHYPE_OPTIONS, urlTransform: fileUrlTransform },
      source,
    ),
  );
const render = (text: string, keep: readonly number[] | null = null) => renderSource(escapeLoneTags(text), keep);

describe('Markdown that is not a reply (a prompt, a plan, a mod)', () => {
  const plain = (text: string) =>
    renderToStaticMarkup(
      createElement(ReactMarkdown, { remarkPlugins: remarkPluginsFor(null), rehypePlugins: PLAIN_REHYPE_PLUGINS, remarkRehypeOptions: REMARK_REHYPE_OPTIONS, urlTransform: fileUrlTransform }, text),
    );

  it('shows raw HTML as the text it is, so a plan cannot hide a step', () => {
    const html = plain('1. Edit a.ts\n\n<!-- also delete ~/.ssh -->\n\n<details><summary>tidy up</summary>\n\nrm -rf ~\n\n</details>\n\n2. Run tests');
    expect(html).toContain('&lt;!-- also delete ~/.ssh --&gt;');
    expect(html).toContain('&lt;details&gt;');
    expect(html).not.toContain('<details');
    expect(html).toContain('rm -rf ~');
  });

  it('keeps every word of a prompt with placeholders and JSX', () => {
    const html = plain('Fix the <Button> so <Modal open> closes on <branch>.');
    expect(html).toContain('Fix the &lt;Button&gt; so &lt;Modal open&gt; closes on &lt;branch&gt;.');
  });

  it('still renders its Markdown and alerts', () => {
    const html = plain('#### Small\n\n> [!NOTE]\n> Read this.\n\n- [x] done');
    expect(html).toContain('<h4>Small</h4>');
    expect(html).toContain('data-alert="note"');
    expect(html).toContain('type="checkbox"');
  });
});

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
    // A path written as text is marked, so it stays text until the engine finds the file; a reply's own mark is dropped.
    expect(render('Saved in **/tmp/out/a.md**.')).toContain('<a href="/tmp/out/a.md" data-bare-path="">/tmp/out/a.md</a>');
    expect(render('<a href="/x/y.md" data-bare-path>y</a>')).not.toContain('data-bare-path');
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

  it('loads an image only from http(s) or a path of this computer', () => {
    const loads = (html: string) => /<img[^>]* src="[^"]/.test(html);
    for (const src of ['//evil.example/x.png', '\\\\evil\\x.png', '/\\evil/x.png', 'file://evil.example/x.png', 'file:////evil/x.png', 'C://evil/x.png', '/%5C%5Cevil/x.png', '/&#9;/evil/x.png', 'a/b.png', 'data:image/png;base64,AAAA', 'ftp://evil.example/x.png']) {
      expect(loads(render(`<img src="${src}">`)), src).toBe(false);
      if (!/[\\\s)&]/.test(src)) expect(loads(render(`![x](${src})`)), src).toBe(false);
    }
    expect(loads(render('![x](\\\\evil\\x.png)'))).toBe(false);
    for (const src of ['https://example.com/a.png', '/Users/me/a.png', 'C:/a.png', 'file:///Users/me/a.png', 'file:///C:/a.png']) {
      expect(render(`![diagram](${src})`), src).toContain(`src="${src}"`);
      expect(render(`<img src="${src}" alt="d">`), src).toContain(`src="${src}"`);
    }
    expect(render('<img src="HTTPS://example.com/a.png">')).toContain('src="https://example.com/a.png"');
  });

  it('shows the alt text of an image that is blocked', () => {
    expect(renderToStaticMarkup(createElement(ReplyImage, { src: '', alt: 'diagram' }))).toBe('<span class="text-muted">[diagram]</span>');
    expect(renderToStaticMarkup(createElement(ReplyImage, { src: '', alt: '' }))).toBe('');
    expect(renderToStaticMarkup(createElement(ReplyImage, { src: '/a/b.png', alt: 'd' }))).toMatch(/<img src="\/a\/b\.png" alt="d" class="[^"]*max-w-full[^"]*"\/>/);
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

  it('does not let a known tag in a sentence take the rest of the reply', () => {
    const rest = '\n\nSecond paragraph.\n\n- list item';
    for (const [text, shown] of [
      ['Wrap it in a <details> element.', '&lt;details&gt;'],
      ['Use a <pre> block.', '&lt;pre&gt;'],
      ['Put <b> around it.', '&lt;b&gt;'],
      ['The <summary> tag.', '&lt;summary&gt;'],
      ['Close it with </details> after.', '&lt;/details&gt;'],
      ['Close it with </b> after.', '&lt;/b&gt;'],
      ['An <em>unclosed one and a <kbd>pair</kbd>.', '&lt;em&gt;'],
    ] as const) {
      const html = render(text + rest);
      expect(html, text).toContain(shown);
      expect(html, text).toMatch(/<p>Second paragraph\.<\/p>\s*<ul>/);
      expect(html, text).not.toMatch(/<(?:details|pre|summary)/);
    }
  });

  it('renders a tag in a sentence that has its other half, and void tags', () => {
    expect(render('Press <kbd>Ctrl</kbd> and <b>bold <i>it</i></b> end')).toMatch(/<kbd>Ctrl<\/kbd>[\s\S]*<b>bold <i>it<\/i><\/b>/);
    expect(render('line<br>two and <br/> three <img src="https://example.com/a.png" alt="x"> end')).toMatch(/line<br\/>two[\s\S]*<br\/>[\s\S]*<img/);
    expect(render('| a |\n|---|\n| one<br>two |')).toContain('one<br/>two');
    expect(render('**bold <b>nested</b>** and *a <i>b*')).toMatch(/<strong>bold <b>nested<\/b><\/strong>/);
    expect(render('*a <i>b*')).toContain('&lt;i&gt;');
  });

  it('shows a type with an upper-case name as text', () => {
    expect(render('Use Component<P> and useState<S> here, then Foo<I> more text')).toContain('Use Component&lt;P&gt; and useState&lt;S&gt; here, then Foo&lt;I&gt; more text');
    expect(render('Dispatch<SetStateAction<S>> is it')).toContain('Dispatch&lt;SetStateAction&lt;S&gt;&gt; is it');
    expect(render('Map<K, V> and <DETAILS>x</DETAILS> and <Br> done')).toContain('&lt;Br&gt; done');
    expect(render('<SCRIPT>alert(1)</SCRIPT>')).not.toMatch(/<script/i);
  });

  it('does not let a tag at the start of a line take the rest of the reply', () => {
    const rest = '\n\nNext **bold**.\n\n- list item\n\nLast.';
    for (const [text, shown] of [
      ['<script> tags go at the end.', '&lt;script&gt; tags go at the end.'],
      ['<style> goes in the head.', '&lt;style&gt; goes in the head.'],
      ['<textarea> is a field.', '&lt;textarea&gt; is a field.'],
      ['<pre> is the tag for code.', '&lt;pre&gt; is the tag for code.'],
      ['<details> hides content.', '&lt;details&gt; hides content.'],
      ['<b>', '&lt;b&gt;'],
      ['<div>', '&lt;div&gt;'],
      ['</details> closes it.', '&lt;/details&gt; closes it.'],
    ] as const) {
      const html = render(text + rest);
      expect(html, text).toContain(shown);
      expect(html, text).toContain('<strong>bold</strong>');
      expect(html, text).toMatch(/<ul>\s*<li>list item<\/li>\s*<\/ul>\s*<p>Last\.<\/p>/);
      expect(html, text).not.toMatch(/<(?:script|style|textarea|pre|details|b|div)[ >]/);
    }
    // In a quote and a list item.
    expect(render('> <details> hides\n>\n> After.\n\nOutside')).toMatch(/&lt;details&gt; hides[\s\S]*After\.[\s\S]*Outside/);
    expect(render('- <pre> in a list\n- next item')).toMatch(/&lt;pre&gt; in a list[\s\S]*next item/);
    expect(render('- <pre> in a list\n- next item')).not.toContain('<pre');
  });

  it('keeps a block of HTML that has its end tag, in one block or over several', () => {
    expect(render('<details>\n<summary>s</summary>\n\nHidden **text**\n\n- a\n\n</details>\n\nAfter')).toMatch(/<details>[\s\S]*<strong>text<\/strong>[\s\S]*<\/details>\s*<p>After<\/p>/);
    expect(render('<pre>\ncode <b>x</b>\n\nmore\n</pre>\n\nAfter')).toMatch(/<pre>[\s\S]*<b>x<\/b>[\s\S]*more[\s\S]*<\/pre>/);
    expect(render('<div align="center">\n\n**Title**\n\n</div>')).toContain('<div align="center">');
    expect(render('<script>alert(1)</script>\n\nAfter')).not.toMatch(/script|alert/);
    expect(render('<script>if (a<b) { x() }</script>\n\nAfter')).toContain('After');
    expect(render('<table>\n<tr><td>a</td></tr>\n</table>')).toContain('<table>');
    expect(render('> <details>\n> <summary>s</summary>\n>\n> in\n>\n> </details>')).toMatch(/<details>[\s\S]*in[\s\S]*<\/details>/);
  });

  it('shows a block tag in a sentence as text', () => {
    for (const [text, shown] of [
      ['a <details>x</details> b', 'a &lt;details&gt;x&lt;/details&gt; b'],
      ['a <table>t</table> b', 'a &lt;table&gt;t&lt;/table&gt; b'],
      ['a <pre>x</pre> b', 'a &lt;pre&gt;x&lt;/pre&gt; b'],
      ['a <ul>x</ul> b', 'a &lt;ul&gt;x&lt;/ul&gt; b'],
      ['a <div>x</div> b', 'a &lt;div&gt;x&lt;/div&gt; b'],
    ] as const) expect(render(text), text).toBe(`<p>${shown}</p>`);
    // Inline tags stay.
    expect(render('a <kbd>x</kbd> <b>y</b> <span>z</span>')).toBe('<p>a <kbd>x</kbd> <b>y</b> <span>z</span></p>');
  });

  it('keeps a stray tag from changing the rest, and the rest from changing it', () => {
    const div = render('<div>\n<b>bold\n</div>\n\nAfter paragraph.');
    expect(div).not.toMatch(/\\|<b>|<strong>/);
    expect(div).toContain('&lt;b&gt;bold');
    expect(div).toContain('<p>After paragraph.</p>');
    expect(render('<ul><li>a<li>b</ul>')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(render('<table>\n<tr><td>a<td>b\n</table>\n\nAfter')).toMatch(/<table>[\s\S]*<td>a<\/td>[\s\S]*<td>b\s*<\/td>[\s\S]*<\/table>\s*<p>After<\/p>/);
    const fence = render('<script> tags go at the end.\n\n```html\n<script src="x"></script>\n```\n\nAfter the code.');
    expect(fence).toContain('&lt;script&gt; tags go at the end.');
    expect(fence).toContain('<pre><code class="language-html">');
    expect(fence).toContain('After the code.');
    expect(fence).not.toMatch(/<script/);
    const many = render(Array.from({ length: 14 }, (_, i) => `<script> stray ${i}.`).join('\n\n') + '\n\nEnd.');
    expect(many.match(/&lt;script&gt; stray/g)).toHaveLength(14);
    expect(many).toContain('<p>End.</p>');
    expect(render(Array.from({ length: 12 }, () => '<textarea>').join('\n') + '\n\nEnd.')).toContain('End.');
  });

  it('reads references and footnotes across a stray tag', () => {
    const reference = render('Before [a][1].\n\n<script> stray.\n\n[1]: https://example.com/x');
    expect(reference).toContain('href="https://example.com/x"');
    expect(reference).toContain('&lt;script&gt; stray.');
    const footnote = render('Text[^1].\n\n<pre> stray.\n\n[^1]: The note');
    expect(footnote).toContain('data-footnote-ref');
    expect(footnote).toMatch(/data-footnotes[\s\S]*The note/);
    const after = render('<pre> stray.\n\nSee [x] and [^2].\n\n[x]: https://example.com/y\n\n[^2]: Second');
    expect(after).toContain('href="https://example.com/y"');
    expect(after).toContain('data-footnote-ref');
  });

  it('keeps a < inside a formula', () => {
    expect(render('$x<y$')).toContain('class="language-math math-inline">x&lt;y</code>');
    expect(render('If $a<b$ then <branch> and x<y')).toMatch(/math-inline">a&lt;b<\/code> then &lt;branch&gt; and x&lt;y/);
    expect(render('$$\na<b\n$$\n\nAfter')).toContain('a&lt;b');
    expect(render('$$\na<b\n$$\n\nAfter')).toContain('<p>After</p>');
  });

  it('numbers Skim sentences as it renders them', () => {
    const text = 'It returns Promise<void> when done. The next sentence follows. And one more.';
    expect(replySentences(text)).toHaveLength(3);
    expect(render(text, [1])).toContain('data-skim-faded');
  });
});

describe('a reply still being written', () => {
  const stream = (text: string) => streamingBlockTexts(text).map((block) => renderSource(block)).join('');

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

  it('shows an open details block as a disclosure while it is written', () => {
    const html = stream('Intro\n\n<details>\n<summary>More</summary>\n\nBody **so far');
    expect(html).toContain('Intro');
    expect(html).toMatch(/<details>[\s\S]*<summary>More<\/summary>[\s\S]*<strong>so far<\/strong>[\s\S]*<\/details>/);
    expect(html).not.toContain('&lt;');
    expect(stream('<details>\n<summary>Mo')).toContain('<details>');
  });

  it('does not hide text after a < inside a formula being written', () => {
    expect(healMarkdown('If $a<b')).toBe('If $a<b');
    expect(healMarkdown('So $x<y$ and $a<b')).toBe('So $x<y$ and $a<b');
    expect(healMarkdown('$$\na<b')).toBe('$$\na<b');
    expect(healMarkdown('Done $x$ and <b')).toBe('Done $x$ and');
    expect(healMarkdown('Escaped \\$ and <b')).toBe('Escaped \\$ and');
    const html = streamingBlockTexts('Then If $a<b').map((block) => renderSource(block)).join('');
    expect(html).toContain('a&lt;b');
    expect(streamingBlockTexts('$$\nx<y\n\nz').join('')).toBe('$$\nx<y\n\nz');
  });

  it('closes each details the last block left open, and none that is a sentence', () => {
    expect(healMarkdown('<details>\n<summary>s</summary>\n\nBody **so')).toBe('<details>\n<summary>s</summary>\n\nBody **so**\n\n</details>');
    expect(healMarkdown('<details>\n<details>\nx')).toMatch(/\n\n<\/details>\n\n<\/details>$/);
    expect(healMarkdown('<details>\nx\n</details>\n\nDone')).toBe('<details>\nx\n</details>\n\nDone');
    expect(healMarkdown('<details> hides content.')).toBe('<details> hides content.');
    expect(healMarkdown('Wrap it in a <details>')).toBe('Wrap it in a <details>');
  });

  it('shows a details sentence in a reply being written as text', () => {
    const html = stream('<details> hides content.\n\nNext.\n\nLast');
    expect(html).toContain('&lt;details&gt; hides content.');
    expect(html).not.toMatch(/<details/);
    expect(html).toContain('<p>Last</p>');
  });

  it('keeps what is inside a details block in its block while it is written', () => {
    const text = 'Intro\n\n<details>\n<summary>More</summary>\n\nHidden **text**\n\n- a\n- b\n\n</details>\n\nAfter';
    const blocks = splitBlocks(text);
    expect(blocks.join('')).toBe(text);
    expect(blocks.map((b) => b.trim())).toEqual(['Intro', '<details>\n<summary>More</summary>\n\nHidden **text**\n\n- a\n- b\n\n</details>', 'After']);
    // Still open: everything after it stays in it.
    expect(splitBlocks('<details>\n<summary>More</summary>\n\nHidden').length).toBe(1);
  });

  it('does not stay in a details block that is only mentioned in a sentence', () => {
    expect(splitBlocks('Wrap it in a <details> element.\n\nSecond.\n\n- list')).toHaveLength(3);
    expect(splitBlocks('Close it with </details> after.\n\nSecond.\n\nThird')).toHaveLength(3);
    // Nor one at the start of a line that goes on as a sentence.
    expect(splitBlocks('<details> hides content.\n\nNext.\n\nLast.')).toHaveLength(3);
    expect(splitBlocks('<pre> is the tag for code.\n\nNext.\n\nLast.').length).toBeGreaterThan(0);
    expect(splitBlocks('Use <details>x</details> here.\n\nSecond.\n\nThird')).toHaveLength(3);
    // A block of HTML still holds the rest.
    expect(splitBlocks('<details>\n<summary>s</summary>\n\nBody\n\nMore')).toHaveLength(1);
  });

  it('does not stay in a details block that a comment, code or the end of a paragraph says otherwise about', () => {
    expect(splitBlocks('<!-- <details> -->\n\nOne\n\nTwo')).toHaveLength(3);
    expect(splitBlocks('Use `<details>` here\n\nOne\n\nTwo')).toHaveLength(3);
    expect(splitBlocks('```html\n<details>\n```\n\nOne\n\nTwo')).toHaveLength(3);
    // A closing tag at the end of a paragraph closes nothing: it is text.
    expect(render('<details>\n<summary>s</summary>\n\nBody </details>\n\nOne')).toContain('Body &lt;/details&gt;');
    const closed = splitBlocks('<details>\n<summary>s</summary>\n\nBody\n\n</details>\n\nOne\n\nTwo');
    expect(closed).toHaveLength(3);
    expect(closed[0]).toContain('</details>');
  });
});
