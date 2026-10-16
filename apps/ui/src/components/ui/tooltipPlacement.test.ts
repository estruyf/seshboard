import { describe, expect, it } from 'vitest';
import { placeTooltip, placeTooltipRight } from './tooltipPlacement.ts';

const viewport = { width: 1000, height: 800 };

describe('placeTooltip', () => {
  it('centres the tooltip below its target', () => {
    expect(placeTooltip({ left: 100, top: 100, bottom: 120, width: 20 }, { width: 60, height: 20 }, viewport)).toEqual({ left: 80, top: 126 });
  });

  it('flips above when there is no room below', () => {
    expect(placeTooltip({ left: 100, top: 770, bottom: 790, width: 20 }, { width: 60, height: 20 }, viewport)).toEqual({ left: 80, top: 744 });
  });

  it('goes above when asked, and below when there is no room above', () => {
    expect(placeTooltip({ left: 100, top: 100, bottom: 120, width: 20 }, { width: 60, height: 20 }, viewport, 'above')).toEqual({ left: 80, top: 74 });
    expect(placeTooltip({ left: 100, top: 10, bottom: 30, width: 20 }, { width: 60, height: 20 }, viewport, 'above')).toEqual({ left: 80, top: 36 });
  });

  it('stays inside the window horizontally', () => {
    expect(placeTooltip({ left: 0, top: 100, bottom: 120, width: 10 }, { width: 200, height: 20 }, viewport).left).toBe(8);
    expect(placeTooltip({ left: 990, top: 100, bottom: 120, width: 10 }, { width: 200, height: 20 }, viewport).left).toBe(792);
  });
});

describe('placeTooltipRight', () => {
  it('sits to the right of its target, centred vertically', () => {
    expect(placeTooltipRight({ left: 10, top: 100, bottom: 140, right: 54, width: 44, height: 40 }, { width: 200, height: 60 }, viewport)).toEqual({ left: 60, top: 90 });
  });

  it('stays inside the window', () => {
    expect(placeTooltipRight({ left: 10, top: 0, bottom: 20, right: 54, width: 44, height: 20 }, { width: 200, height: 60 }, viewport).top).toBe(8);
    expect(placeTooltipRight({ left: 10, top: 780, bottom: 800, right: 54, width: 44, height: 20 }, { width: 200, height: 60 }, viewport).top).toBe(732);
  });
});
