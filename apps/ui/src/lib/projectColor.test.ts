import { describe, expect, it } from 'vitest';
import { accentFromPixels, letterColor } from './projectColor.ts';

/** RGBA pixels: `count` of each colour. */
const pixels = (...runs: [number, [number, number, number, number]][]) => runs.flatMap(([count, rgba]) => Array.from({ length: count }, () => rgba).flat());

describe('letterColor', () => {
  it('gives a name the same colour every time', () => {
    expect(letterColor('switchboard')).toBe(letterColor('switchboard'));
    expect(letterColor('switchboard')).toMatch(/^hsl\(\d+ 45% 42%\)$/);
  });

  it('falls back to the muted grey with Project colours off', () => {
    expect(letterColor('switchboard', false)).toBe('var(--sb-muted)');
    expect(letterColor('another', false)).toBe(letterColor('switchboard', false));
  });
});

describe('accentFromPixels', () => {
  it('reads a red icon as red', () => {
    expect(accentFromPixels(pixels([10, [220, 30, 30, 255]]))).toMatch(/^hsl\(0 /);
  });
  it('takes the most common vivid hue, not the average of two', () => {
    const color = accentFromPixels(pixels([30, [30, 90, 230, 255]], [10, [230, 40, 40, 255]]));
    expect(Number(color?.match(/^hsl\((\d+)/)?.[1])).toBeGreaterThan(200);
    expect(Number(color?.match(/^hsl\((\d+)/)?.[1])).toBeLessThan(240);
  });
  it('keeps the lightness visible on both themes', () => {
    expect(accentFromPixels(pixels([10, [255, 240, 120, 255]]))).toMatch(/ 56%\)$/);
    expect(accentFromPixels(pixels([10, [60, 0, 0, 255]]))).toMatch(/ 40%\)$/);
  });
  it('has no colour for grey, transparent or empty icons', () => {
    expect(accentFromPixels(pixels([10, [128, 128, 128, 255]], [10, [255, 255, 255, 255]]))).toBeNull();
    expect(accentFromPixels(pixels([10, [220, 30, 30, 0]]))).toBeNull();
    expect(accentFromPixels([])).toBeNull();
  });
});
