import { describe, expect, it } from 'vitest';
import { nextOpenQuestion } from './questionFlow.ts';

describe('nextOpenQuestion', () => {
  it('goes to the next question that has no answer', () => {
    expect(nextOpenQuestion([true, false, false], 0)).toBe(1);
  });

  it('skips questions that are answered already', () => {
    expect(nextOpenQuestion([true, true, false], 0)).toBe(2);
  });

  it('wraps to an earlier open question when none is left after', () => {
    expect(nextOpenQuestion([false, true, true], 2)).toBe(0);
  });

  it('is undefined when everything else is answered, even if `from` is not', () => {
    expect(nextOpenQuestion([true, false, true], 1)).toBeUndefined();
    expect(nextOpenQuestion([true], 0)).toBeUndefined();
  });
});
