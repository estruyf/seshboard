import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';
import { remarkBareLinks } from './bareLinks.ts';

const render = (text: string) => renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkBareLinks] }, text));
const hrefs = (text: string) => [...render(text).matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

describe('remarkBareLinks', () => {
  it('links an address without https://', () => {
    expect(render('github.com/involv-intranet/intranet/pull/2288 check the pr review')).toBe(
      '<p><a href="https://github.com/involv-intranet/intranet/pull/2288">github.com/involv-intranet/intranet/pull/2288</a> check the pr review</p>',
    );
  });

  it('leaves the full stop or bracket around it out', () => {
    expect(hrefs('See docs.example.org/a/b.')).toEqual(['https://docs.example.org/a/b']);
    expect(hrefs('(see sub.site.dev/x?y=1#z)')).toEqual(['https://sub.site.dev/x?y=1#z']);
  });

  it('keeps links GFM already makes as they are', () => {
    expect(hrefs('https://github.com/a/b and www.example.com/c')).toEqual(['https://github.com/a/b', 'http://www.example.com/c']);
    expect(hrefs('[the PR](https://github.com/a/b/pull/1)')).toEqual(['https://github.com/a/b/pull/1']);
  });

  it.each([
    'Open package.json and a.ts',
    'Edit src/github.com/thing.ts',
    'Run ./site.dev/build',
    'example.com with no path',
    'Version 1.2/3',
    '`github.com/a/b` in code',
  ])('leaves text alone: %s', (text) => {
    expect(hrefs(text)).toEqual([]);
  });

  it('leaves an e-mail address to GFM', () => {
    expect(hrefs('Mail me@example.com/x')).toEqual(['mailto:me@example.com']);
  });
});
