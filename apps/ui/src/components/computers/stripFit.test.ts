import { describe, expect, it } from 'vitest';
import { fitComputerChips, MIN_NAME, moreLabel, STRIP_GAP } from './stripFit.ts';

// A chip is about 30px of dot, padding and gap plus 6.5px a letter at text-ui; names are cut at 9rem (144px).
const name = (text: string) => Math.min(144, text.length * 6.5);
const chip = (text: string) => 30 + name(text);
const cut = (text: string) => 30 + Math.min(MIN_NAME, name(text));
const here = chip('This Mac');
const plus = () => 28;
const fit = (available: number, names: string[]) => fitComputerChips(available, { here, widths: names.map(chip), least: names.map(cut), plusWidth: plus, menuButton: 16 });

describe('fitComputerChips', () => {
  it('shows every chip when they fit, with room for one ▾', () => {
    const need = here + chip('mystic') + chip('studio') + 2 * STRIP_GAP + 16;
    expect(fit(need, ['mystic', 'studio'])).toBe(2);
    // Short names can't be cut, so a pixel less folds the last one.
    expect(fit(need - 1, ['mystic', 'studio'])).toBe(1);
  });

  it('cuts the last name before it folds', () => {
    const need = here + chip('mystic') + cut('Render workstation') + 2 * STRIP_GAP + 16;
    expect(fit(need, ['mystic', 'Render workstation'])).toBe(2);
    expect(fit(need - 1, ['mystic', 'Render workstation'])).toBe(1);
  });

  it('keeps one computer in the narrowest sidebar', () => {
    expect(fit(216, ['Smoke Mac'])).toBe(1);
    expect(fit(216, ['Render workstation'])).toBe(1);
  });

  it('folds the last chips into +N in a narrow sidebar', () => {
    expect(fit(212, ['Studio Mac', 'Render workstation'])).toBe(1);
    expect(fit(200, ['Studio Mac', 'Render workstation'])).toBe(0);
    expect(fit(216, ['mystic', 'studio', 'render'])).toBe(1);
    expect(fit(320, ['mystic', 'studio', 'render'])).toBe(3);
  });

  it('counts a long name at its 9rem width', () => {
    const long = 'Render farm workstation in the basement';
    expect(chip(long)).toBe(174);
    expect(fit(296, ['mystic', long])).toBe(2);
    expect(fit(250, ['mystic', 'studio', long])).toBe(1);
  });

  it('keeps This Mac and +N when nothing else fits', () => {
    expect(fit(here + STRIP_GAP + plus() + 1, ['mystic'])).toBe(0);
    expect(fit(0, ['mystic', 'studio'])).toBe(0);
  });

  it('has nothing to fold without paired computers', () => {
    expect(fit(100, [])).toBe(0);
  });
});

describe('moreLabel', () => {
  it('names how many and how many need you', () => {
    expect(moreLabel(1, 0)).toBe('1 more computer');
    expect(moreLabel(2, 0)).toBe('2 more computers');
    expect(moreLabel(2, 3)).toBe('2 more computers, 3 need you');
  });
});
