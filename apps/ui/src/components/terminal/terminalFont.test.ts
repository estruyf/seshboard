import { describe, expect, it } from 'vitest';
import { terminalFontFamily } from './terminalFont.ts';

const FALLBACKS = 'ui-monospace, monospace';

describe('terminalFontFamily', () => {
  it('quotes each font and puts them in front of the fallbacks', () => {
    expect(terminalFontFamily({ fontFamily: 'Cascadia Code', fontFamilies: ['Cascadia Code', 'Segoe UI Emoji'] }, FALLBACKS)).toBe('"Cascadia Code", "Segoe UI Emoji", ui-monospace, monospace');
  });

  it('uses the single name from an engine that sends no list', () => {
    expect(terminalFontFamily({ fontFamily: 'MesloLGS NF' }, FALLBACKS)).toBe('"MesloLGS NF", ui-monospace, monospace');
  });

  it('drops quotes and backslashes inside a name, and blank names', () => {
    expect(terminalFontFamily({ fontFamily: null, fontFamilies: ['Fira "Code"', '  ', 'A\\B'] }, FALLBACKS)).toBe('"Fira Code", "AB", ui-monospace, monospace');
  });

  it('is just the fallbacks when nothing was found', () => {
    expect(terminalFontFamily({ fontFamily: null, fontFamilies: [] }, FALLBACKS)).toBe(FALLBACKS);
    expect(terminalFontFamily({ fontFamily: null }, FALLBACKS)).toBe(FALLBACKS);
  });
});
