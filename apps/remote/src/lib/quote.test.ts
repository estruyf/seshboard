import { describe, expect, it } from 'vitest';
import { quotedText, quotePillPlace } from './quote.ts';

const phone = { width: 390, height: 800 };
const pill = { width: 100, height: 36 };
const line = (left: number, top: number, width = 200) => ({ left, top, width, height: 20 });

describe('quotePillPlace', () => {
  it('goes under the last line, centred on it', () => {
    expect(quotePillPlace(line(20, 100), line(40, 200), pill, phone)).toEqual({ left: 90, top: 230 });
  });

  it('stays on screen at the edges', () => {
    expect(quotePillPlace(line(0, 100), line(0, 200, 40), pill, phone).left).toBe(8);
    expect(quotePillPlace(line(0, 100), line(350, 200, 40), pill, phone).left).toBe(282);
  });

  it('goes above the first line when there is no room under the last', () => {
    expect(quotePillPlace(line(20, 600), line(20, 760), pill, phone).top).toBe(554);
    expect(quotePillPlace(line(20, 10), line(20, 760), pill, phone).top).toBe(8);
  });
});

describe('quotedText', () => {
  it('keeps the text without the blank lines around it', () => {
    expect(quotedText('\n\nRate limits\r\nare in  \n\n')).toBe('Rate limits\nare in');
    expect(quotedText(' \n \n')).toBeNull();
  });
});
