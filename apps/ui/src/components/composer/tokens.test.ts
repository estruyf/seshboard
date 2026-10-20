import { describe, expect, it } from 'vitest';
import { tokenAtCaret } from './tokens.ts';

const at = (text: string) => tokenAtCaret(text, text.length);

describe('tokenAtCaret', () => {
  it('finds / at the start, and @ and # at the start of a word', () => {
    expect(at('/rev')).toEqual({ kind: 'slash', start: 0, query: 'rev' });
    expect(at('look at @src/a')).toEqual({ kind: 'file', start: 8, query: 'src/a' });
    expect(at('#')).toEqual({ kind: 'issue', start: 0, query: '' });
    expect(at('can you look at #start')).toEqual({ kind: 'issue', start: 16, query: 'start' });
    expect(at('first line\n#32')).toEqual({ kind: 'issue', start: 11, query: '32' });
  });

  it('leaves # in the middle of a word, a link and a heading alone', () => {
    expect(at('written in C#')).toBeNull();
    expect(at('see https://example.com/page#section')).toBeNull();
    expect(at('## Heading')).toBeNull();
    // A space ends the token: what follows is plain text.
    expect(at('# Heading')).toBeNull();
    expect(at('#32 is done')).toBeNull();
  });

  it('only looks before the caret', () => {
    expect(tokenAtCaret('#32 and more', 3)).toEqual({ kind: 'issue', start: 0, query: '32' });
  });
});
