import { describe, expect, it } from 'vitest';
import { followEnd } from './followEnd.ts';

describe('followEnd', () => {
  it('moves a view that follows the end to its new end', () => {
    const el = { scrollTop: 400, scrollHeight: 1200 };
    expect(followEnd(el, true)).toBe(true);
    expect(el.scrollTop).toBe(1200);
  });

  it('leaves a view scrolled up where it is', () => {
    const el = { scrollTop: 400, scrollHeight: 1200 };
    expect(followEnd(el, false)).toBe(false);
    expect(el.scrollTop).toBe(400);
    expect(followEnd(null, true)).toBe(false);
  });
});
