import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';
import { remarkBareLinks } from './bareLinks.ts';
import { remarkBarePaths } from './barePaths.ts';
import { fileUrlTransform } from './fileRefs.ts';

const render = (text: string) => renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkBareLinks, remarkBarePaths], urlTransform: fileUrlTransform }, text));
const hrefs = (text: string) => [...render(text).matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

describe('remarkBarePaths', () => {
  it('links an absolute path in bold text', () => {
    const path = '/private/tmp/claude-501/-Users-me-intranet/543b1f0f/scratchpad/xrank-sharepoint-search.md';
    expect(hrefs(`Het bericht staat klaar in **${path}**`)).toEqual([path]);
    expect(render(`in **${path}**`)).toContain(`<strong><a href="${path}" data-bare-path="true">${path}</a></strong>`);
  });

  it('links a home path, a Windows path and a line', () => {
    expect(hrefs('Saved to ~/notes/plan.md and C:\\work\\a.ts')).toEqual(['~/notes/plan.md', 'C:/work/a.ts']);
    expect(hrefs('See /Users/me/a.ts:12-20 and /Users/me/b.ts#L4')).toEqual(['/Users/me/a.ts:12-20', '/Users/me/b.ts#L4']);
  });

  it('leaves the full stop, comma or bracket around it out', () => {
    expect(hrefs('Written to /tmp/out/a.md.')).toEqual(['/tmp/out/a.md']);
    expect(hrefs('(see /tmp/out/a.md, then /tmp/out/b.md)')).toEqual(['/tmp/out/a.md', '/tmp/out/b.md']);
  });

  it.each([
    'Run /clear first',
    'Use and/or here',
    'Half is 1/2',
    'Run ./scripts/build.sh',
    'Edit src/a/b.ts',
    'Open example.com/a/b',
    '`/tmp/out/a.md` in code',
    '[a link](https://example.com/tmp/a.md)',
    'https://example.com/tmp/a.md',
    'A share: //host/share/a.md',
  ])('leaves text alone: %s', (text) => {
    expect(render(text)).not.toContain('data-bare-path');
  });
});
