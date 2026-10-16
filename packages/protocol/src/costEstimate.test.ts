import { describe, expect, it } from 'vitest';
import { convertUsd, costOf, CURRENCIES, formatCost, isCurrencyCode, priceOf } from './costEstimate.ts';

describe('priceOf', () => {
  it('matches the model ids Claude Code writes, newest versions first', () => {
    const io = (model: string) => {
      const p = priceOf(model);
      return p && [p.input, p.output, p.cacheRead];
    };
    expect(io('claude-fable-5-1')).toEqual([10, 50, 0.25]);
    expect(io('claude-fable-5')).toEqual([10, 50, 1]);
    expect(io('claude-opus-5-5')).toEqual([4, 20, 0.2]);
    expect(io('claude-opus-5')).toEqual([5, 25, 0.5]);
    expect(io('claude-opus-4-8')).toEqual([5, 25, 0.5]);
    expect(io('claude-opus-4-5-20251101')).toEqual([5, 25, 0.5]);
    expect(io('claude-opus-4-1-20250805')).toEqual([15, 75, 1.5]);
    expect(io('claude-opus-4-20250514')).toEqual([15, 75, 1.5]);
    expect(io('claude-sonnet-5-5')).toEqual([2, 10, 0.2]);
    expect(io('claude-sonnet-4-5-20250929')).toEqual([3, 15, 0.3]);
    expect(io('claude-3-7-sonnet-20250219')).toEqual([3, 15, 0.3]);
    expect(io('claude-haiku-5-5')).toEqual([0.1, 0.5, 0.01]);
    expect(io('claude-haiku-4-5-20251001')).toEqual([1, 5, 0.1]);
    expect(io('claude-3-5-haiku-20241022')).toEqual([0.8, 4, 0.08]);
    // A newer version than the table knows is priced like its family's latest.
    expect(io('claude-sonnet-6')).toEqual([2, 10, 0.2]);
    expect(priceOf('<synthetic>')).toBeNull();
  });

  it('prices a cache write at 1.25 times the input', () => {
    expect(priceOf('claude-opus-5-5')!.cacheWrite).toBe(5);
    expect(costOf({ input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 }, 'claude-sonnet-5-5')).toBeCloseTo(2 + 10 + 0.2 + 2.5);
    expect(costOf({ input: 1, output: 1, cacheRead: 1, cacheWrite: 1 }, 'gpt-x')).toBeNull();
  });

  it('prices writes to the hour-long cache at twice the input price, the rest at 1.25 times', () => {
    expect(priceOf('claude-opus-5-5')!.cacheWrite1h).toBe(8);
    expect(costOf({ input: 0, output: 0, cacheRead: 0, cacheWrite: 1_000_000, cacheWrite1h: 600_000 }, 'claude-opus-5-5')).toBeCloseTo(0.4 * 5 + 0.6 * 8);
    // More hour-long writes than writes (a bad row) counts no more than all of them.
    expect(costOf({ input: 0, output: 0, cacheRead: 0, cacheWrite: 1_000_000, cacheWrite1h: 5_000_000 }, 'claude-opus-5-5')).toBeCloseTo(8);
  });
});

describe('currencies', () => {
  it('converts from US dollars and formats in the currency', () => {
    expect(isCurrencyCode('EUR')).toBe(true);
    expect(isCurrencyCode('XYZ')).toBe(false);
    expect(new Set(CURRENCIES.map((c) => c.code)).size).toBe(CURRENCIES.length);
    expect(convertUsd(10, 'USD')).toBe(10);
    expect(formatCost(3.2, 'USD', 'en-US')).toBe('$3.20');
    expect(formatCost(10, 'EUR', 'en-US')).toBe(`€${convertUsd(10, 'EUR').toFixed(2)}`);
    // Whole units from 100 up, and yen never has cents.
    expect(formatCost(1234.56, 'USD', 'en-US')).toBe('$1,235');
    expect(formatCost(1, 'JPY', 'en-US')).toBe('¥158');
    expect(formatCost(0.001, 'USD', 'en-US')).toBe('<$0.01');
    expect(formatCost(0, 'USD', 'en-US')).toBe('$0.00');
  });
});
