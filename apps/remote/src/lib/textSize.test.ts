import { describe, expect, it } from 'vitest';
import { cleanTextSize, TEXT_SIZES } from './textSize.ts';

describe('the text size', () => {
  it('keeps Large and Larger, and is Default otherwise', () => {
    expect(cleanTextSize('large')).toBe('large');
    expect(cleanTextSize('larger')).toBe('larger');
    expect(cleanTextSize(null)).toBe('default');
    expect(cleanTextSize('huge')).toBe('default');
  });

  it('offers the three, Default first', () => {
    expect(TEXT_SIZES.map((s) => s.label)).toEqual(['Default', 'Large', 'Larger']);
  });
});
