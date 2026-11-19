import { createElement, useContext } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BlockWritingContext } from './blockWriting.ts';

// What a diagram block needs to know from its surroundings is whether it sits in the block Claude is still writing. The
// blocks that draw and the page they draw in are stood in for, so the test runs without a window.
vi.mock('./MermaidBlock.tsx', () => ({
  MermaidBlock: ({ code }: { code: string }) => createElement('i', { 'data-mermaid-writing': String(useContext(BlockWritingContext)), 'data-code': code }),
}));
vi.mock('./CodeBlock.tsx', () => ({ CodeBlock: ({ code }: { code: string }) => createElement('pre', null, code) }));
vi.mock('./FileLink.tsx', () => ({ FileLink: ({ children }: { children: unknown }) => children }));

const { Markdown, StreamingMarkdown } = await import('./Markdown.tsx');

const writingFlags = (html: string) => [...html.matchAll(/data-mermaid-writing="(true|false)"/g)].map((m) => m[1]);

describe('diagram blocks in a reply', () => {
  it('know that the last block of a reply still being written is being written, and a finished block is not', () => {
    const text = '```mermaid\nflowchart LR\n  A-->B\n```\n\nSome text.\n\n```mermaid\nflowchart LR\n  A-->';
    // The first fence is closed and followed by more blocks; the second is cut off mid-line.
    expect(writingFlags(renderToStaticMarkup(createElement(StreamingMarkdown, { text })))).toEqual(['false', 'true']);
  });

  it('is not writing anywhere in a finished reply', () => {
    const text = '```mermaid\nflowchart LR\n  A-->B\n```\n\nSome text.\n\n```mermaid\npie\n  "a": 1\n```';
    expect(writingFlags(renderToStaticMarkup(createElement(Markdown, { text })))).toEqual(['false', 'false']);
  });

  it('draws the diagram of a half-written fence only as the last block says', () => {
    const html = renderToStaticMarkup(createElement(StreamingMarkdown, { text: 'Here it is:\n\n```mermaid\nflowchart LR\n  A-->' }));
    expect(writingFlags(html)).toEqual(['true']);
    // The fence is closed for display, so the block's code is what was written so far.
    expect(html).toContain('data-code="flowchart LR\n  A--&gt;"');
  });
});
