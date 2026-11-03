import { describe, expect, it } from 'vitest';
import { mergedDoneText } from './mergedDoneText.ts';

describe('mergedDoneText', () => {
  it('names one session and its pull request, and counts more', () => {
    expect(mergedDoneText([{ title: 'Add dark mode', pr: 12 }])).toBe('“Add dark mode” moved to Done, #12 merged');
    expect(mergedDoneText([{ title: 'a', pr: 1 }, { title: 'b', pr: 2 }])).toBe('2 sessions moved to Done, PR merged');
  });
});
