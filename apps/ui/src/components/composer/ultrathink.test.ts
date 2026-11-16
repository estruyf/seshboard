import { describe, expect, it } from 'vitest';
import { hasUltrathink, splitUltrathink, withUltrathink } from './ultrathink.ts';

describe('hasUltrathink', () => {
  it('finds the whole word in any case, anywhere', () => {
    expect(hasUltrathink('ultrathink')).toBe(true);
    expect(hasUltrathink('Please ULTRATHINK about this')).toBe(true);
    expect(hasUltrathink('first line\nUltraThink, then fix it')).toBe(true);
    expect(hasUltrathink('(ultrathink)')).toBe(true);
  });

  it('leaves longer words alone', () => {
    expect(hasUltrathink('ultrathinking')).toBe(false);
    expect(hasUltrathink('nonultrathink')).toBe(false);
    expect(hasUltrathink('ultra think')).toBe(false);
    expect(hasUltrathink('')).toBe(false);
  });

  it('gives the same answer twice (no state kept between calls)', () => {
    expect(hasUltrathink('ultrathink')).toBe(true);
    expect(hasUltrathink('ultrathink')).toBe(true);
  });
});

describe('splitUltrathink', () => {
  it('cuts the text around each word and keeps every character', () => {
    const text = 'a ultrathink b\nUltrathink';
    const parts = splitUltrathink(text);
    expect(parts).toEqual([
      { text: 'a ', hit: false },
      { text: 'ultrathink', hit: true },
      { text: ' b\n', hit: false },
      { text: 'Ultrathink', hit: true },
    ]);
    expect(parts.map((p) => p.text).join('')).toBe(text);
  });

  it('is one plain part without the word, and none for empty text', () => {
    expect(splitUltrathink('hello')).toEqual([{ text: 'hello', hit: false }]);
    expect(splitUltrathink('')).toEqual([]);
  });
});

describe('withUltrathink', () => {
  it('adds the word at the end', () => {
    expect(withUltrathink('fix the build')).toBe('fix the build ultrathink');
    expect(withUltrathink('fix the build \n')).toBe('fix the build ultrathink');
  });

  it('never adds it twice', () => {
    expect(withUltrathink('ultrathink about the build')).toBe('ultrathink about the build');
    expect(withUltrathink('think hard. ULTRATHINK')).toBe('think hard. ULTRATHINK');
  });

  it('is the word alone for an empty message', () => {
    expect(withUltrathink('')).toBe('ultrathink');
    expect(withUltrathink('  ')).toBe('ultrathink');
  });
});
