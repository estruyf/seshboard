import { describe, expect, it } from 'vitest';
import { matchedLetters, parseQuickOpen } from './quickOpen.ts';

describe('parseQuickOpen', () => {
  it('reads a line after a colon', () => {
    expect(parseQuickOpen('CartButton:42')).toEqual({ query: 'CartButton', line: 42 });
    expect(parseQuickOpen('src/a.ts:3:7')).toEqual({ query: 'src/a.ts', line: 3 });
    expect(parseQuickOpen(':12')).toEqual({ query: '', line: 12 });
  });

  it('keeps anything else as the name', () => {
    expect(parseQuickOpen(' cartbu ')).toEqual({ query: 'cartbu', line: undefined });
    expect(parseQuickOpen('a:b')).toEqual({ query: 'a:b', line: undefined });
    expect(parseQuickOpen('a:0')).toEqual({ query: 'a', line: undefined });
  });
});

describe('matchedLetters', () => {
  it('marks a run, or each letter in turn', () => {
    expect(matchedLetters('CartButton.tsx', 'cartbu')).toEqual([0, 1, 2, 3, 4, 5]);
    expect(matchedLetters('cart-button.css', 'cbu')).toEqual([0, 5, 6]);
    expect(matchedLetters('abc', 'x')).toEqual([]);
  });
});
