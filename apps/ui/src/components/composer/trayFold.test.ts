import { describe, expect, it } from 'vitest';
import { boxPlaceholder, foldedFace, foldedLabel, trayFolds } from './trayFold.ts';

describe('trayFolds', () => {
  // A session's tray: the chips at their smallest level, Tools and usage, and the context ring.
  const widths = { chips: 150, info: 230, ring: 90 };

  it('keeps every chip on a wide tray', () => {
    expect(trayFolds(860, widths)).toBe(false);
  });

  it('keeps every chip on a medium tray, where the chips step down a level', () => {
    // 150 + 230 + 90 + 16 = 486: the chips are already at their smallest, and it still fits.
    expect(trayFolds(520, widths)).toBe(false);
    expect(trayFolds(486, widths)).toBe(false);
  });

  it('folds on a narrow tray', () => {
    expect(trayFolds(485, widths)).toBe(true);
    expect(trayFolds(360, widths)).toBe(true);
  });

  it('never folds a tray without a chip row', () => {
    expect(trayFolds(120, { chips: 0, info: 230, ring: 90 })).toBe(false);
  });

  it('gives half a pixel of slack to fractional widths', () => {
    expect(trayFolds(486, { chips: 150.4, info: 230, ring: 90 })).toBe(false);
  });
});

describe('the folded chip', () => {
  it('names every value on its face', () => {
    expect(foldedFace(['Opus 5.5', 'High', 'Ask first'])).toBe('Opus 5.5 · High · Ask first');
    expect(foldedFace(['Sonnet 5', null, 'Autopilot'])).toBe('Sonnet 5 · Autopilot');
  });

  it('says what it sets and to what', () => {
    expect(foldedLabel({ model: 'Opus 5.5', effort: 'High', mode: 'Ask first' })).toBe('Model, effort and mode: Opus 5.5, High, Ask first');
    expect(foldedLabel({ model: 'Sonnet 5', mode: 'Autopilot' })).toBe('Model and mode: Sonnet 5, Autopilot');
    expect(foldedLabel({ model: 'Sonnet 5' })).toBe('Model: Sonnet 5');
  });
});

describe('boxPlaceholder', () => {
  it('asks for a message while idle', () => {
    expect(boxPlaceholder({ agent: 'Claude', running: false, whileWorking: 'queue', sendNow: '⌘⇧↩' })).toBe('Message Claude');
  });

  it('says where a message goes while Claude works', () => {
    expect(boxPlaceholder({ agent: 'Claude', running: true, whileWorking: 'queue', sendNow: '⌘⇧↩' })).toBe('Message Claude. It waits in Up next, or ⌘⇧↩ sends it now.');
    expect(boxPlaceholder({ agent: 'Claude', running: true, whileWorking: 'steer', sendNow: 'Ctrl+Shift+Enter' })).toBe('Message Claude. Claude reads it at its next step, or Ctrl+Shift+Enter sends it now.');
  });

  it("uses another provider's name", () => {
    expect(boxPlaceholder({ agent: 'GitHub Copilot', running: false, whileWorking: 'queue', sendNow: '⌘⇧↩' })).toBe('Message GitHub Copilot');
    expect(boxPlaceholder({ agent: 'GitHub Copilot', running: true, whileWorking: 'queue', sendNow: '⌘⇧↩' })).toBe('Message GitHub Copilot. It waits in Up next, or ⌘⇧↩ sends it now.');
  });
});
