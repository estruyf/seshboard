import { describe, expect, it } from 'vitest';
import { chipShape, effortBars, footerLevel, modelFamily, shortModelName } from './chipFaces.ts';

describe('footerLevel', () => {
  const widths = [420, 340, 310, 280, 260];

  it('keeps everything when the full row fits', () => {
    expect(footerLevel(600, widths)).toBe(0);
    expect(footerLevel(420, widths)).toBe(0);
    // Measured widths are fractional: a row that fits to the pixel doesn't step down.
    expect(footerLevel(419.6, widths)).toBe(0);
  });

  it('steps down one level at a time as the room shrinks', () => {
    expect(footerLevel(419, widths)).toBe(1);
    expect(footerLevel(340, widths)).toBe(1);
    expect(footerLevel(339, widths)).toBe(2);
    expect(footerLevel(310, widths)).toBe(2);
    expect(footerLevel(309, widths)).toBe(3);
    expect(footerLevel(280, widths)).toBe(3);
    expect(footerLevel(279, widths)).toBe(4);
    expect(footerLevel(260, widths)).toBe(4);
  });

  it('stays at the last level when even that does not fit', () => {
    expect(footerLevel(100, widths)).toBe(4);
    expect(footerLevel(0, widths)).toBe(4);
  });

  it('skips a level that saves nothing', () => {
    // Only one profile: level 1 is as wide as level 0, so the model is the next to shrink.
    expect(footerLevel(300, [320, 320, 280, 260, 240])).toBe(2);
  });

  it('treats a level not measured yet as too wide', () => {
    expect(footerLevel(500, [])).toBe(4);
    expect(footerLevel(500, [600])).toBe(4);
  });
});

describe('chip faces', () => {
  it('drops the profile name first, then the model version, then the effort and mode labels', () => {
    expect(chipShape(0)).toEqual({ effortLabel: true, modeLabel: true, modelVersion: true, profileName: true });
    expect(chipShape(1)).toEqual({ effortLabel: true, modeLabel: true, modelVersion: true, profileName: false });
    expect(chipShape(2)).toEqual({ effortLabel: true, modeLabel: true, modelVersion: false, profileName: false });
    expect(chipShape(3)).toEqual({ effortLabel: false, modeLabel: true, modelVersion: false, profileName: false });
    expect(chipShape(4)).toEqual({ effortLabel: false, modeLabel: false, modelVersion: false, profileName: false });
  });

  it('shortens model names without cutting words', () => {
    expect(shortModelName('Opus 4.5')).toBe('Opus 4.5');
    expect(shortModelName('Claude Opus 4.5 (1M context)')).toBe('Opus 4.5');
    expect(shortModelName('Default (recommended)')).toBe('Default model');
    expect(shortModelName('Default model')).toBe('Default model');
    expect(shortModelName('')).toBe('Default model');
    expect(modelFamily('Opus 4.5')).toBe('Opus');
    expect(modelFamily('Sonnet 4.5 [1m]')).toBe('Sonnet');
    expect(modelFamily('Haiku')).toBe('Haiku');
    expect(modelFamily('Default model')).toBe('Default model');
    expect(modelFamily('claude-opus-5-5')).toBe('claude-opus-5-5');
  });

  it('fills the effort bars by level', () => {
    expect(effortBars('')).toEqual({ filled: 0, strong: false });
    expect(effortBars('low')).toEqual({ filled: 1, strong: false });
    expect(effortBars('medium')).toEqual({ filled: 2, strong: false });
    expect(effortBars('high')).toEqual({ filled: 3, strong: false });
    expect(effortBars('xhigh')).toEqual({ filled: 3, strong: true });
    expect(effortBars('max')).toEqual({ filled: 3, strong: true });
  });
});
