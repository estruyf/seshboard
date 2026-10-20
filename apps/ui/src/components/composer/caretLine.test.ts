import { describe, expect, it } from 'vitest';
import { onFirstLine, onLastLine, scrollToRow, type RowOf } from './caretLine.ts';

/** Rows as a textarea that wraps every `width` characters would lay them out (20px a row). */
const wrapsAt =
  (text: string, width: number): RowOf =>
  (offset) => {
    let row = 0;
    let column = 0;
    for (let i = 0; i < offset; i++) {
      if (text[i] === '\n') {
        row++;
        column = 0;
      } else if (++column === width) {
        row++;
        column = 0;
      }
    }
    return row * 20;
  };

describe('onFirstLine', () => {
  it('is true anywhere on a single line that does not wrap', () => {
    const text = 'fix the tests';
    expect(onFirstLine(text, 0, 0, wrapsAt(text, 80))).toBe(true);
    expect(onFirstLine(text, 7, 7, wrapsAt(text, 80))).toBe(true);
    expect(onFirstLine(text, text.length, text.length, wrapsAt(text, 80))).toBe(true);
  });

  it('is false after a line break', () => {
    const text = 'first\nsecond';
    expect(onFirstLine(text, 3, 3, wrapsAt(text, 80))).toBe(true);
    expect(onFirstLine(text, 8, 8, wrapsAt(text, 80))).toBe(false);
  });

  it('is false on a wrapped row of the first line', () => {
    const text = 'a long first line that wraps onto a second row';
    expect(onFirstLine(text, 5, 5, wrapsAt(text, 20))).toBe(true);
    expect(onFirstLine(text, 30, 30, wrapsAt(text, 20))).toBe(false);
  });

  it('is false with a selection', () => {
    expect(onFirstLine('fix the tests', 0, 3, wrapsAt('fix the tests', 80))).toBe(false);
  });

  it('falls back to the very start when rows cannot be measured', () => {
    expect(onFirstLine('fix the tests', 0, 0, null)).toBe(true);
    expect(onFirstLine('fix the tests', 4, 4, null)).toBe(false);
    expect(onFirstLine('fix the tests', 4, 4, () => null)).toBe(false);
  });
});

describe('onLastLine', () => {
  it('is true anywhere on a single line that does not wrap', () => {
    const text = 'fix the tests';
    expect(onLastLine(text, 0, 0, wrapsAt(text, 80))).toBe(true);
    expect(onLastLine(text, text.length, text.length, wrapsAt(text, 80))).toBe(true);
  });

  it('is false before a line break', () => {
    const text = 'first\nsecond';
    expect(onLastLine(text, 3, 3, wrapsAt(text, 80))).toBe(false);
    expect(onLastLine(text, 8, 8, wrapsAt(text, 80))).toBe(true);
  });

  it('is false on an earlier row of a wrapped last line', () => {
    const text = 'a long last line that wraps onto a second row';
    expect(onLastLine(text, 5, 5, wrapsAt(text, 20))).toBe(false);
    expect(onLastLine(text, text.length, text.length, wrapsAt(text, 20))).toBe(true);
  });

  it('is false with a selection', () => {
    expect(onLastLine('fix the tests', 4, 13, wrapsAt('fix the tests', 80))).toBe(false);
  });

  it('falls back to the very end when rows cannot be measured', () => {
    expect(onLastLine('fix the tests', 13, 13, null)).toBe(true);
    expect(onLastLine('fix the tests', 4, 4, null)).toBe(false);
  });
});

describe('scrollToRow', () => {
  it('scrolls down to a new row under the bottom edge', () => {
    // A box 320px tall scrolled to the end of 400px, and a new row added under it.
    expect(scrollToRow(80, 320, 400, 20)).toBe(100);
  });

  it('scrolls up to a row above the top edge', () => {
    expect(scrollToRow(100, 320, 40, 20)).toBe(40);
  });

  it('stays put when the row shows', () => {
    expect(scrollToRow(80, 320, 200, 20)).toBe(80);
    expect(scrollToRow(80, 320, 380, 20)).toBe(80);
  });
});
