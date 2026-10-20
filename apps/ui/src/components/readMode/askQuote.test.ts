import { describe, expect, it } from 'vitest';
import { askPrefill } from './askQuote.ts';

describe('the Ask field prefill', () => {
  it('quotes a line and leaves a blank line for the question', () => {
    expect(askPrefill('Use the cache')).toBe('> Use the cache\n\n');
  });

  it('quotes every line, keeping blank ones as a bare marker', () => {
    expect(askPrefill('one\n\ntwo')).toBe('> one\n>\n> two\n\n');
  });

  it('trims the selection and gives nothing for an empty one', () => {
    expect(askPrefill('  hi \n')).toBe('> hi\n\n');
    expect(askPrefill('  \n ')).toBe('');
  });
});
