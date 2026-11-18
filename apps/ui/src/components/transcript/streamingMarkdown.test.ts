import { describe, expect, it } from 'vitest';
import { healMarkdown, splitBlocks } from './streamingMarkdown.ts';

describe('splitBlocks', () => {
  it('splits top-level blocks and keeps the text intact', () => {
    const text = '# Title\n\nSome **bold** text.\n\n- one\n- two\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nEnd';
    const blocks = splitBlocks(text);
    expect(blocks.join('')).toBe(text);
    expect(blocks.map((b) => b.trim())).toEqual(['# Title', 'Some **bold** text.', '- one\n- two', '```ts\nconst a = 1;\n\nconst b = 2;\n```', 'End']);
  });

  it('keeps an unfinished fence as one block to the end', () => {
    const blocks = splitBlocks('Intro\n\n```js\nfoo();\n\nbar(');
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toBe('```js\nfoo();\n\nbar(');
  });

  it('returns the text for an empty or single-line message', () => {
    expect(splitBlocks('')).toEqual(['']);
    expect(splitBlocks('Hello')).toEqual(['Hello']);
  });
});

describe('healMarkdown', () => {
  it('closes unfinished inline formatting', () => {
    expect(healMarkdown('This is **bold')).toBe('This is **bold**');
    expect(healMarkdown('Run `npm')).toBe('Run `npm`');
  });

  it('shows an unfinished link as its text', () => {
    expect(healMarkdown('See [the docs](https://exa')).toBe('See the docs');
  });

  it('leaves finished Markdown alone', () => {
    const text = 'Done: **all** `good` [link](https://example.com).';
    expect(healMarkdown(text)).toBe(text);
  });
  it('leaves an unclosed $$ and $ as written (maths is drawn once the block is complete)', () => {
    for (const text of ['$$\n\\frac{a}{', 'Let $x^2', 'cost $5 and $']) expect(healMarkdown(text)).toBe(text);
  });
});
