import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { describe, expect, it } from 'vitest';
import { FILE_REHYPE_PLUGINS, FILE_REMARK_PLUGINS, fileUrlTransform } from './markdownPlugins.ts';

const render = (text: string) => renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: FILE_REMARK_PLUGINS, rehypePlugins: FILE_REHYPE_PLUGINS, urlTransform: fileUrlTransform }, text));

describe('Markdown in a previewed file', () => {
  it('keeps safe HTML', () => {
    const html = render('<details><summary>More</summary>\n\nHidden **text**\n\n</details>\n\n<p align="center"><img src="a.png" alt="logo" width="40"></p>');
    expect(html).toContain('<details>');
    expect(html).toContain('<summary>More</summary>');
    expect(html).toContain('<strong>text</strong>');
    expect(html).toContain('src="a.png"');
    expect(html).toContain('align="center"');
  });
  it('drops scripts, handlers, styles, frames and javascript: links', () => {
    const html = render(
      '<script>alert(1)</script>\n\n<p onclick="x()" style="color:red" class="big">hi</p>\n\n<iframe src="https://example.com"></iframe>\n\n<a href="javascript:alert(1)">bad</a>\n\n<form action="/x"><input name="a"></form>',
    );
    expect(html).not.toMatch(/script|alert|onclick|style=|class=|iframe|javascript:|<form/i);
    expect(html).toContain('hi');
  });
  it('allows file: links and only language classes on code', () => {
    const html = render('[x](file:///a/b.md)\n\n```ts\nconst a = 1;\n```\n\n<code class="evil language-js">y</code>');
    expect(html).toContain('href="file:///a/b.md"');
    expect(html).toContain('class="language-ts"');
    expect(html).not.toContain('evil');
  });
  it('turns the five GitHub alerts into marked blockquotes', () => {
    for (const kind of ['note', 'tip', 'important', 'warning', 'caution']) {
      const html = render(`> [!${kind.toUpperCase()}]\n> Be careful.`);
      expect(html).toContain(`data-alert="${kind}"`);
      expect(html).toContain('data-alert-title');
      expect(html).toContain('Be careful.');
      expect(html).not.toContain('[!');
    }
  });
  it('handles an alert whose text starts on the next paragraph, a lowercase marker and a plain quote', () => {
    const split = render('> [!tip]\n>\n> Second paragraph');
    expect(split).toContain('data-alert="tip"');
    expect(split).toContain('Second paragraph');
    const plain = render('> just a quote\n\n> [!UNKNOWN]\n> nope');
    expect(plain).not.toContain('data-alert');
    expect(plain).toContain('[!UNKNOWN]');
  });
});
