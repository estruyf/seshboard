import { describe, expect, it } from 'vitest';
import { guarded } from './guarded.ts';

describe('guarded', () => {
  it('runs the callback, and logs what it throws instead of throwing', () => {
    const logged: unknown[][] = [];
    let ran = 0;
    guarded('test', () => void ran++, (...args) => logged.push(args))();
    expect(ran).toBe(1);
    const error = new RangeError('Invalid language tag: ');
    expect(() =>
      guarded('theme reload', () => {
        throw error;
      }, (...args) => logged.push(args))(),
    ).not.toThrow();
    expect(logged).toEqual([['[main] theme reload failed', error]]);
  });
});
