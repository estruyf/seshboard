import { describe, expect, it } from 'vitest';
import { claim, release, runOnce } from './inFlight.ts';

describe('claim and release', () => {
  it('takes free keys and refuses taken ones', () => {
    const pending = new Set<string>();
    expect(claim(pending, ['a.ts'])).toBe(true);
    expect(claim(pending, ['a.ts'])).toBe(false);
    release(pending, ['a.ts']);
    expect(claim(pending, ['a.ts'])).toBe(true);
  });

  it('takes all keys or none', () => {
    const pending = new Set<string>(['b.ts']);
    expect(claim(pending, ['a.ts', 'b.ts', 'c.ts'])).toBe(false);
    expect([...pending]).toEqual(['b.ts']);
    expect(claim(pending, ['a.ts', 'c.ts'])).toBe(true);
    expect(pending).toEqual(new Set(['a.ts', 'b.ts', 'c.ts']));
  });
});

describe('runOnce', () => {
  it('runs the work once while it is in flight', async () => {
    const pending = new Set<string>();
    let calls = 0;
    let finish!: () => void;
    const work = () => {
      calls++;
      return new Promise<string>((resolve) => (finish = () => resolve('done')));
    };
    const first = runOnce(pending, 'q1', work);
    const second = runOnce(pending, 'q1', work);
    expect(await second).toBeUndefined();
    finish();
    expect(await first).toBe('done');
    expect(calls).toBe(1);
    expect(pending.size).toBe(0);
  });

  it('gives the key back when the work fails', async () => {
    const pending = new Set<string>();
    await expect(runOnce(pending, 'q1', () => Promise.reject(new Error('no')))).rejects.toThrow('no');
    expect(pending.has('q1')).toBe(false);
  });

  it('keeps keys apart', async () => {
    const pending = new Set<string>();
    const results = await Promise.all([runOnce(pending, 'a', async () => 1), runOnce(pending, 'b', async () => 2)]);
    expect(results).toEqual([1, 2]);
  });
});
