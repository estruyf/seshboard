import { describe, expect, it } from 'vitest';
import { hasUltrathink, offersUltrathink, splitUltrathink, ultrathinkSend, withUltrathink } from './ultrathink.ts';

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

  it('puts the word on a line of its own after several lines, so a list, quote or fence cannot take it', () => {
    expect(withUltrathink('- one\n- two')).toBe('- one\n- two\n\nultrathink');
    expect(withUltrathink('> quoted\n> more\n')).toBe('> quoted\n> more\n\nultrathink');
    expect(withUltrathink('```\ncode\n```\n\n')).toBe('```\ncode\n```\n\nultrathink');
  });

  it('is the word alone for an empty message', () => {
    expect(withUltrathink('')).toBe('ultrathink');
    expect(withUltrathink('  ')).toBe('ultrathink');
  });
});

describe('ultrathinkSend', () => {
  it('sends the message as it is when the option is off', () => {
    expect(ultrathinkSend('fix it', { armed: false, steer: false })).toEqual({ typed: 'fix it', consume: false });
  });

  it('adds the word and uses the option up on a normal send, a queued message or Send now', () => {
    expect(ultrathinkSend('fix it', { armed: true, steer: false })).toEqual({ typed: 'fix it ultrathink', consume: true });
  });

  it('keeps the option for a steer: the running turn keeps its effort', () => {
    expect(ultrathinkSend('fix it', { armed: true, steer: true })).toEqual({ typed: 'fix it', consume: false });
  });

  it('keeps the option for a slash command, which would take the word as an argument', () => {
    expect(ultrathinkSend('/compact', { armed: true, steer: false })).toEqual({ typed: '/compact', consume: false });
    expect(ultrathinkSend('  /review the diff', { armed: true, steer: false })).toEqual({ typed: '  /review the diff', consume: false });
  });

  it('does not double a word that is typed already, and still uses the option up', () => {
    expect(ultrathinkSend('Ultrathink about this', { armed: true, steer: false })).toEqual({ typed: 'Ultrathink about this', consume: true });
  });
});

describe('offersUltrathink', () => {
  it('is not offered where the effort is xhigh or max already', () => {
    expect(offersUltrathink('')).toBe(true);
    expect(offersUltrathink('low')).toBe(true);
    expect(offersUltrathink('high')).toBe(true);
    expect(offersUltrathink('xhigh')).toBe(false);
    expect(offersUltrathink('max')).toBe(false);
  });
});
