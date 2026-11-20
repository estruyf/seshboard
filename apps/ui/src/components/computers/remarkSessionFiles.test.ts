import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';
import { remarkSessionFiles } from './remarkSessionFiles.ts';

const render = (text: string) => renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkSessionFiles] }, text));

describe('remarkSessionFiles', () => {
  it('marks a path in a sentence, leaving the full stop after it', () => {
    expect(render('Nothing was changed. The list is in /tmp/claude-501/p/s/scratchpad/code-review.md.')).toBe(
      '<p>Nothing was changed. The list is in <span data-session-file="/tmp/claude-501/p/s/scratchpad/code-review.md">/tmp/claude-501/p/s/scratchpad/code-review.md</span>.</p>',
    );
  });

  it('marks inline code that is only a path, not code with more in it', () => {
    expect(render('Open `/a/review.md` or run `cat /a/review.md`.')).toBe('<p>Open <code data-session-file="/a/review.md">/a/review.md</code> or run <code>cat /a/review.md</code>.</p>');
  });

  it('leaves links, code blocks and files that do not open as they are', () => {
    const html = render('[the review](/a/review.md) and /a/report.pdf\n\n```\n/a/review.md\n```');
    expect(html).not.toContain('data-session-file');
  });

  it('marks paths inside emphasis and list items', () => {
    expect(render('- **See /a/b.md**')).toContain('<strong>See <span data-session-file="/a/b.md">/a/b.md</span></strong>');
  });
});
