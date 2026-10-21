import { describe, expect, it } from 'vitest';
import { DEFAULT_READ_PREFS, READ_SIZES, readPrefs, stepSize } from './readPrefs.ts';

describe('reading mode preferences', () => {
  it('starts with serif text at the second size, a medium column and the tools folded', () => {
    expect(readPrefs(null)).toEqual({ font: 'serif', size: 1, width: 'medium', showTools: false });
    expect(READ_SIZES[DEFAULT_READ_PREFS.size]).toBe(17.5);
  });

  it('reads what was saved', () => {
    const saved = { font: 'mono', size: 3, width: 'wide', showTools: true };
    expect(readPrefs(JSON.stringify(saved))).toEqual(saved);
  });

  it('falls back to the default for each field that is wrong, and keeps the rest', () => {
    expect(readPrefs(JSON.stringify({ font: 'comic', size: 9, width: 'wide', showTools: 'yes' }))).toEqual({ ...DEFAULT_READ_PREFS, width: 'wide' });
    expect(readPrefs(JSON.stringify({ size: 1.5 }))).toEqual(DEFAULT_READ_PREFS);
    expect(readPrefs(JSON.stringify({ size: -1 }))).toEqual(DEFAULT_READ_PREFS);
    expect(readPrefs(JSON.stringify({ size: 0 })).size).toBe(0);
  });

  it('survives broken or unexpected JSON', () => {
    expect(readPrefs('{broken')).toEqual(DEFAULT_READ_PREFS);
    expect(readPrefs('null')).toEqual(DEFAULT_READ_PREFS);
    expect(readPrefs('7')).toEqual(DEFAULT_READ_PREFS);
    expect(readPrefs('')).toEqual(DEFAULT_READ_PREFS);
  });

  it('steps the size and stops at both ends', () => {
    expect(stepSize(1, 1)).toBe(2);
    expect(stepSize(1, -1)).toBe(0);
    expect(stepSize(3, 1)).toBe(3);
    expect(stepSize(0, -1)).toBe(0);
  });
});
