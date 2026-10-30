import { describe, expect, it } from 'vitest';
import { lettersSpread } from './letterSpacing.ts';

describe('lettersSpread', () => {
  it('passes the fraction of a pixel a measured letter is off by', () => {
    expect(lettersSpread(6.6, ['0.00625px', '0.00852273px', '', '0.437953px'])).toBe(false);
  });

  it('passes wide characters, which come out negative', () => {
    expect(lettersSpread(6.6, ['-9.87007px', '-0.00164474px'])).toBe(false);
  });

  it('finds a letter measured at 0px: a whole cell of extra space', () => {
    expect(lettersSpread(6.6, ['0.00625px', '6.6px'])).toBe(true);
    expect(lettersSpread(7.031, ['7.03125px'])).toBe(true);
  });

  it('finds a wide character measured at 0px: two cells', () => {
    expect(lettersSpread(6.6, ['13.2px'])).toBe(true);
  });

  it('draws the line at half a cell', () => {
    expect(lettersSpread(6.6, ['3.2px'])).toBe(false);
    expect(lettersSpread(6.6, ['3.3px'])).toBe(true);
  });

  it('says nothing before the cell has a width', () => {
    expect(lettersSpread(0, ['6.6px'])).toBe(false);
    expect(lettersSpread(Number.NaN, ['6.6px'])).toBe(false);
  });

  it('skips values that are not lengths', () => {
    expect(lettersSpread(6.6, ['', 'normal'])).toBe(false);
  });
});
