import { describe, expect, it } from 'vitest';
import { badgeDescription, badgeDotBitmap } from './taskbarBadge.ts';

describe('taskbar badge', () => {
  it('draws a pink dot with a white ring on a clear square', () => {
    const size = 16;
    const bitmap = badgeDotBitmap(size);
    expect(bitmap.length).toBe(size * size * 4);
    const at = (x: number, y: number) => [...bitmap.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)];
    expect(at(0, 0)[3]).toBe(0);
    expect(at(8, 8)).toEqual([0x7c, 0x21, 0xed, 255]);
    expect(at(8, 0).slice(0, 3)).toEqual([255, 255, 255]);
  });

  it('says how many sessions need you', () => {
    expect(badgeDescription(1)).toBe('1 session needs you');
    expect(badgeDescription(3)).toBe('3 sessions need you');
  });
});
