import { describe, expect, it } from 'vitest';
import { layoutFor } from './layout.ts';

describe('layoutFor', () => {
  it('keeps a phone on the phone layout, in portrait and in landscape', () => {
    expect(layoutFor({ width: 390, height: 844 })).toEqual({ wide: false, foldable: false });
    expect(layoutFor({ width: 844, height: 390 })).toEqual({ wide: false, foldable: false });
  });

  it('gives an iPad in portrait the sidebar, which can fold', () => {
    expect(layoutFor({ width: 820, height: 1180 })).toEqual({ wide: true, foldable: true });
  });

  it('gives an iPad in landscape and a computer the sidebar for good', () => {
    expect(layoutFor({ width: 1180, height: 820 })).toEqual({ wide: true, foldable: false });
    expect(layoutFor({ width: 1440, height: 900 })).toEqual({ wide: true, foldable: false });
  });

  it('starts wide at 768 by 600, and folds below 1024', () => {
    expect(layoutFor({ width: 767, height: 900 }).wide).toBe(false);
    expect(layoutFor({ width: 768, height: 599 }).wide).toBe(false);
    expect(layoutFor({ width: 768, height: 600 })).toEqual({ wide: true, foldable: true });
    expect(layoutFor({ width: 1023, height: 700 }).foldable).toBe(true);
    expect(layoutFor({ width: 1024, height: 700 }).foldable).toBe(false);
  });
});
