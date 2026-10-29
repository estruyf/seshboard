import { safeLocale } from './locale.ts';
import type { TokenCounts } from './usage.ts';

/**
 * What tokens would cost at Anthropic's API list prices, for the estimate next to the plan's usage bars. A plan is
 * not billed per token, so this is never a charge: it says what the same work would have cost on the API. Prices are
 * per million tokens, in US dollars; a cache write is 1.25 times the input price for the 5-minute cache and twice it for
 * the hour-long one (Claude Code uses either; the transcript says which). Fast mode's premium and long-context pricing
 * are left out.
 */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  /** A write to the 5-minute cache. */
  cacheWrite: number;
  /** A write to the hour-long cache. */
  cacheWrite1h: number;
}

const price = (input: number, output: number, cacheRead = input / 10): ModelPrice => ({ input, output, cacheRead, cacheWrite: input * 1.25, cacheWrite1h: input * 2 });

/**
 * List prices by model id, first match wins: newer versions before the family's older ones. Model ids come from the
 * transcripts as the API wrote them (`claude-opus-4-1-20250805`, `claude-sonnet-5-5`), so a pattern matches a prefix
 * of the version. Checked against Anthropic's pricing in October 2026.
 */
const PRICES: ReadonlyArray<readonly [RegExp, ModelPrice]> = [
  [/(fable|mythos)-5-1/, price(10, 50, 0.25)],
  [/fable|mythos/, price(10, 50)],
  [/opus-5-5/, price(4, 20, 0.2)],
  [/opus-(5|4-[5-9])/, price(5, 25)],
  [/opus-4|3-opus/, price(15, 75)],
  [/sonnet-5/, price(2, 10, 0.2)],
  [/sonnet-4|3-[57]-sonnet/, price(3, 15)],
  [/haiku-5/, price(0.1, 0.5)],
  [/haiku-4/, price(1, 5)],
  [/3-5-haiku/, price(0.8, 4)],
  [/3-haiku/, price(0.25, 1.25)],
  // A family's newer model than this table knows: priced like its latest.
  [/opus/, price(4, 20, 0.2)],
  [/sonnet/, price(2, 10, 0.2)],
  [/haiku/, price(0.1, 0.5)],
];

/** A model's list price, or null for one this table doesn't know (`<synthetic>`, another provider's). */
export function priceOf(model: string): ModelPrice | null {
  const id = model.toLowerCase();
  return PRICES.find(([pattern]) => pattern.test(id))?.[1] ?? null;
}

/**
 * What tokens of one model cost at its list price, in US dollars; null when the model has no known price.
 * `cacheWrite1h`: the part of `cacheWrite` that went to the hour-long cache (the rest is priced as 5-minute writes).
 */
export function costOf(tokens: TokenCounts & { cacheWrite1h?: number }, model: string): number | null {
  const p = priceOf(model);
  if (!p) return null;
  const hour = Math.min(tokens.cacheWrite, tokens.cacheWrite1h ?? 0);
  return (tokens.input * p.input + tokens.output * p.output + tokens.cacheRead * p.cacheRead + (tokens.cacheWrite - hour) * p.cacheWrite + hour * p.cacheWrite1h) / 1_000_000;
}

/**
 * The currencies the estimate can be shown in, with how many of each one US dollar buys. From the ECB's euro
 * reference rates of `RATES_DATE`; an estimate doesn't need today's rate, so they are updated now and then.
 */
export const CURRENCIES = [
  { code: 'USD', name: 'US dollar', perUsd: 1 },
  { code: 'EUR', name: 'Euro', perUsd: 0.8887 },
  { code: 'GBP', name: 'British pound', perUsd: 0.7499 },
  { code: 'CHF', name: 'Swiss franc', perUsd: 0.824 },
  { code: 'CAD', name: 'Canadian dollar', perUsd: 1.416 },
  { code: 'AUD', name: 'Australian dollar', perUsd: 1.437 },
  { code: 'NZD', name: 'New Zealand dollar', perUsd: 1.766 },
  { code: 'JPY', name: 'Japanese yen', perUsd: 158.0 },
  { code: 'CNY', name: 'Chinese yuan', perUsd: 6.686 },
  { code: 'HKD', name: 'Hong Kong dollar', perUsd: 7.848 },
  { code: 'SGD', name: 'Singapore dollar', perUsd: 1.279 },
  { code: 'KRW', name: 'South Korean won', perUsd: 1332 },
  { code: 'INR', name: 'Indian rupee', perUsd: 94.96 },
  { code: 'SEK', name: 'Swedish krona', perUsd: 9.904 },
  { code: 'NOK', name: 'Norwegian krone', perUsd: 9.441 },
  { code: 'DKK', name: 'Danish krone', perUsd: 6.642 },
  { code: 'PLN', name: 'Polish złoty', perUsd: 3.883 },
  { code: 'CZK', name: 'Czech koruna', perUsd: 21.61 },
  { code: 'HUF', name: 'Hungarian forint', perUsd: 322.6 },
  { code: 'BRL', name: 'Brazilian real', perUsd: 5.083 },
  { code: 'MXN', name: 'Mexican peso', perUsd: 18.38 },
  { code: 'ZAR', name: 'South African rand', perUsd: 16.43 },
  { code: 'ILS', name: 'Israeli shekel', perUsd: 3.094 },
  { code: 'TRY', name: 'Turkish lira', perUsd: 49.53 },
] as const;
export type CurrencyCode = (typeof CURRENCIES)[number]['code'];
export const DEFAULT_CURRENCY: CurrencyCode = 'USD';
/** The day the rates in `CURRENCIES` are from. */
export const RATES_DATE = '2026-10-16';

export const isCurrencyCode = (value: unknown): value is CurrencyCode => CURRENCIES.some((c) => c.code === value);

/** An amount in US dollars in another currency, at the rate in `CURRENCIES`. */
export function convertUsd(usd: number, currency: CurrencyCode): number {
  return usd * (CURRENCIES.find((c) => c.code === currency)?.perUsd ?? 1);
}

/**
 * "$3.20", "€12", "¥480": an estimate in a currency, whole units from 100 up (cents don't matter there). Under the
 * smallest unit it says "<$0.01". `locale` is the app's or a test's; the system's when `Intl` can't read it.
 */
export function formatCost(usd: number, currency: CurrencyCode, locale?: string): string {
  locale = safeLocale(locale);
  const amount = convertUsd(usd, currency);
  const base = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const digits = base.resolvedOptions().maximumFractionDigits ?? 2;
  const smallest = 10 ** -digits;
  if (amount > 0 && amount < smallest) return `<${base.format(smallest)}`;
  return amount >= 100 ? new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount) : base.format(amount);
}
