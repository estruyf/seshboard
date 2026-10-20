import { describe, expect, it } from 'vitest';
import { reviewMinutes } from './catchUpRules.ts';

const none = { waiting: false, diff: null, testsFailed: false, outOfScope: 0 };

describe('reviewMinutes', () => {
  it('is one minute for a permission or a question, whatever changed', () => {
    expect(reviewMinutes({ ...none, waiting: true, diff: { files: 40, add: 3000, del: 900 }, testsFailed: true, outOfScope: 5 })).toBe(1);
  });

  it('adds lines, files, failing tests and out-of-scope files to half a minute', () => {
    expect(reviewMinutes(none)).toBe(1);
    // 0.5 + 160/150 + 6 × 0.25 = 3.07
    expect(reviewMinutes({ ...none, diff: { files: 6, add: 120, del: 40 } })).toBe(3);
    // + 2 for failing tests
    expect(reviewMinutes({ ...none, diff: { files: 6, add: 120, del: 40 }, testsFailed: true })).toBe(5);
    // + 1 per file outside the scope
    expect(reviewMinutes({ ...none, diff: { files: 6, add: 120, del: 40 }, outOfScope: 2 })).toBe(5);
  });

  it('stays between 1 and 30', () => {
    expect(reviewMinutes({ ...none, diff: { files: 0, add: 0, del: 0 } })).toBe(1);
    expect(reviewMinutes({ ...none, diff: { files: 300, add: 50_000, del: 20_000 } })).toBe(30);
  });
});
