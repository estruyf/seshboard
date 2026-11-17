import { describe, expect, it } from 'vitest';
import { cacheRewriteCost } from './contextCache.ts';
import { convertUsd, costOf, CURRENCIES, formatCost, isCurrencyCode, longPromptOver, priceOf, requestCostOf } from './costEstimate.ts';

describe('priceOf', () => {
  it('matches the model ids Claude Code writes, newest versions first', () => {
    const io = (model: string) => {
      const p = priceOf(model);
      return p && [p.input, p.output, p.cacheRead];
    };
    expect(io('claude-fable-5-2')).toEqual([8, 40, 0.2]);
    expect(io('claude-mythos-5-2')).toEqual([8, 40, 0.2]);
    expect(io('claude-fable-5-1')).toEqual([10, 50, 0.25]);
    expect(io('claude-fable-5')).toEqual([10, 50, 1]);
    expect(io('claude-opus-5-5')).toEqual([4, 20, 0.2]);
    expect(io('claude-opus-5')).toEqual([5, 25, 0.5]);
    expect(io('claude-opus-4-8')).toEqual([5, 25, 0.5]);
    expect(io('claude-opus-4-5-20251101')).toEqual([5, 25, 0.5]);
    expect(io('claude-opus-4-1-20250805')).toEqual([15, 75, 1.5]);
    expect(io('claude-opus-4-20250514')).toEqual([15, 75, 1.5]);
    expect(io('claude-sonnet-5-5')).toEqual([2, 10, 0.1]);
    expect(io('claude-sonnet-5')).toEqual([2, 10, 0.2]);
    expect(io('claude-sonnet-4-5-20250929')).toEqual([3, 15, 0.3]);
    expect(io('claude-3-7-sonnet-20250219')).toEqual([3, 15, 0.3]);
    expect(io('claude-haiku-5-5')).toEqual([0.1, 0.5, 0.01]);
    expect(io('claude-haiku-4-5-20251001')).toEqual([1, 5, 0.1]);
    expect(io('claude-3-5-haiku-20241022')).toEqual([0.8, 4, 0.08]);
    // A newer version than the table knows is priced like its family's latest.
    expect(io('claude-sonnet-6')).toEqual([2, 10, 0.1]);
    expect(io('claude-fable-6')).toEqual([8, 40, 0.2]);
    // Also a point release: not the `.0` version's price.
    expect(io('claude-opus-5-6')).toEqual([4, 20, 0.2]);
    expect(io('claude-sonnet-5-6')).toEqual([2, 10, 0.1]);
    expect(io('claude-fable-5-3')).toEqual([8, 40, 0.2]);
    expect(priceOf('<synthetic>')).toBeNull();
  });

  it("prices Haiku 5.5's requests over 100k prompt tokens at five times the price", () => {
    expect(longPromptOver('claude-haiku-5-5')).toBe(100_000);
    expect(longPromptOver('claude-sonnet-5-5')).toBeNull();
    expect(priceOf('claude-haiku-5-5', 100_000)!.input).toBe(0.1);
    expect(priceOf('claude-haiku-5-5', 100_001)).toMatchObject({ input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625, cacheWrite1h: 1 });
    expect(priceOf('claude-sonnet-5-5', 900_000)!.input).toBe(2);
    // `long` is the part from requests over the size; the rest keeps the lower price.
    const tokens = { input: 0, output: 2_000_000, cacheRead: 0, cacheWrite: 0 };
    expect(costOf({ ...tokens, long: { ...tokens, output: 1_000_000 } }, 'claude-haiku-5-5')).toBeCloseTo(0.5 + 2.5);
    expect(costOf({ ...tokens, long: { ...tokens, output: 1_000_000 } }, 'claude-sonnet-5-5')).toBeCloseTo(20);
    expect(requestCostOf({ input: 0, output: 1_000_000, cacheRead: 100_001, cacheWrite: 0 }, 'claude-haiku-5-5')).toBeCloseTo(2.5 + 100_001 * 0.05e-6);
    expect(requestCostOf({ input: 0, output: 1_000_000, cacheRead: 100_000, cacheWrite: 0 }, 'claude-haiku-5-5')).toBeCloseTo(0.5 + 100_000 * 0.01e-6);
    expect(cacheRewriteCost(200_000, 'claude-haiku-5-5', '5m')).toBeCloseTo(200_000 * 0.625e-6);
  });

  it("prices OpenAI's models for Codex and Copilot, and reads Copilot's dotted versions", () => {
    expect(priceOf('gpt-6-luna')).toMatchObject({ input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 });
    expect(priceOf('gpt-6.1-sol')).toMatchObject({ input: 2, output: 10, cacheRead: 0.1 });
    expect(priceOf('gpt-5.4-2026-03-05')!.input).toBe(2.5);
    // A model whose name only starts like a known one isn't priced as it.
    expect(priceOf('gpt-5.4-nano')).toBeNull();
    expect(priceOf('gpt-7')).toBeNull();
    // Without listed cache writes, a write costs the input price.
    expect(priceOf('gpt-5.5')!.cacheWrite).toBe(5);
    // Over 272k prompt tokens: twice the prompt's price, 1.5 times the output's. gpt-5.3-codex has no such price.
    expect(priceOf('gpt-6.1-sol', 300_000)).toMatchObject({ input: 4, cacheRead: 0.2, cacheWrite: 5, output: 15 });
    expect(priceOf('gpt-5.3-codex', 300_000)!.input).toBe(1.75);
    expect(priceOf('claude-sonnet-4.6')!.input).toBe(3);
    expect(priceOf('claude-fable-5.1')!.cacheRead).toBe(0.25);
    expect(priceOf('mai-code-1.1-flash')!.output).toBe(1.2);
  });

  it('prices a cache write at 1.25 times the input', () => {
    expect(priceOf('claude-opus-5-5')!.cacheWrite).toBe(5);
    expect(costOf({ input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 }, 'claude-sonnet-5-5')).toBeCloseTo(2 + 10 + 0.1 + 2.5);
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

  it("formats in the system's locale when the locale is missing or one Intl can't read", () => {
    const system = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(convertUsd(3.2, 'EUR'));
    expect(formatCost(3.2, 'EUR')).toBe(system);
    // '' is what Electron's app.getLocale() returns in the Windows build, which ships no locale file for the language.
    for (const locale of ['', 'en_US', 'nl-BE.UTF-8']) {
      expect(formatCost(3.2, 'EUR', locale)).toBe(system);
      expect(formatCost(1234.56, 'USD', locale)).toBe(formatCost(1234.56, 'USD'));
      expect(formatCost(0.001, 'USD', locale)).toBe(formatCost(0.001, 'USD'));
    }
  });
});
