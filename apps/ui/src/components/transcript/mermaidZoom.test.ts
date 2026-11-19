import { describe, expect, it } from 'vitest';
import { actualSize, clampScale, fitView, MAX_SCALE, MIN_SCALE, panBy, wheelFactor, zoomAt } from './mermaidZoom.ts';

describe('mermaidZoom', () => {
  it('keeps the point under the pointer fixed while zooming', () => {
    const view = { scale: 1, x: 40, y: 20 };
    const next = zoomAt(view, 2, 300, 200);
    expect(next.scale).toBe(2);
    // The content point under (300, 200) was ((300 - 40) / 1, (200 - 20) / 1); it is still there.
    expect((300 - next.x) / next.scale).toBeCloseTo(260);
    expect((200 - next.y) / next.scale).toBeCloseTo(180);
  });

  it('stops at the smallest and largest zoom', () => {
    expect(clampScale(100)).toBe(MAX_SCALE);
    expect(clampScale(0)).toBe(MIN_SCALE);
    expect(zoomAt({ scale: MAX_SCALE, x: 0, y: 0 }, 2, 10, 10).scale).toBe(MAX_SCALE);
  });

  it('fits the diagram in the box, centred, without blowing a small one up past 2x', () => {
    const box = { width: 1000, height: 600 };
    const wide = fitView({ width: 2000, height: 500 }, box);
    expect(wide.scale).toBeCloseTo((1000 - 48) / 2000);
    expect(wide.x).toBeCloseTo((1000 - 2000 * wide.scale) / 2);
    const tiny = fitView({ width: 100, height: 50 }, box);
    expect(tiny.scale).toBe(2);
    expect(tiny.x).toBe((1000 - 200) / 2);
    expect(tiny.y).toBe((600 - 100) / 2);
  });

  it('shows the diagram at its own size, centred, and pans', () => {
    expect(actualSize({ width: 400, height: 200 }, { width: 1000, height: 600 })).toEqual({ scale: 1, x: 300, y: 200 });
    expect(panBy({ scale: 2, x: 10, y: 10 }, -4, 6)).toEqual({ scale: 2, x: 6, y: 16 });
  });

  it('turns a wheel notch into a zoom, in either direction, and a line-based wheel into pixels', () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
    expect(wheelFactor(-100) * wheelFactor(100)).toBeCloseTo(1);
    expect(wheelFactor(0)).toBe(1);
    expect(wheelFactor(3, 1)).toBeCloseTo(wheelFactor(48));
    expect(wheelFactor(1e6)).toBeCloseTo(wheelFactor(200));
  });
});
