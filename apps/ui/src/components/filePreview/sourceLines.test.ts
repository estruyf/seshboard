import { describe, expect, it } from 'vitest';
import { lineBlocks, lineRange, plainLines, shikiLines } from './sourceLines.ts';

describe('shikiLines', () => {
  it('splits Shiki’s HTML into its lines', () => {
    const html = '<pre class="shiki" tabindex="0"><code><span class="line"><span style="--shiki-light:#000">const</span></span>\n<span class="line"></span>\n<span class="line"><span>b</span></span></code></pre>';
    expect(shikiLines(html)).toEqual(['<span class="line"><span style="--shiki-light:#000">const</span></span>', '<span class="line"></span>', '<span class="line"><span>b</span></span>']);
  });

  it('gives up on anything else', () => {
    expect(shikiLines('<div>no code</div>')).toBeNull();
  });
});

describe('plainLines', () => {
  it('keeps the empty last line of a file that ends with a newline, as Shiki does', () => {
    expect(plainLines('a\r\nb\n')).toEqual(['a', 'b', '']);
  });
});

describe('lineRange', () => {
  it('marks one line, or a range, inside the file', () => {
    expect(lineRange(10, undefined, 100)).toEqual({ start: 10, end: 10 });
    expect(lineRange(10, 14, 100)).toEqual({ start: 10, end: 14 });
    expect(lineRange(10, 400, 100)).toEqual({ start: 10, end: 100 });
    expect(lineRange(400, undefined, 100)).toEqual({ start: 100, end: 100 });
    expect(lineRange(10, 4, 100)).toEqual({ start: 10, end: 10 });
  });

  it('marks nothing without a line', () => {
    expect(lineRange(undefined, 14, 100)).toBeNull();
    expect(lineRange(0, undefined, 100)).toBeNull();
    expect(lineRange(3, undefined, 0)).toBeNull();
  });
});

describe('lineBlocks', () => {
  it('cuts the lines into blocks that know their first line', () => {
    expect(lineBlocks(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([
      { first: 1, lines: ['a', 'b'] },
      { first: 3, lines: ['c', 'd'] },
      { first: 5, lines: ['e'] },
    ]);
    expect(lineBlocks([], 2)).toEqual([]);
  });
});
