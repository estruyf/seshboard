import { safeLocale } from './locale.ts';
import type { TokenCounts } from './usage.ts';

/**
 * What tokens would cost at the API list prices of their model's maker (Anthropic, or OpenAI for Codex and Copilot's
 * GPT models), for the estimate next to the plan's usage bars. A plan is not billed per token, so this is never a
 * charge: it says what the same work would have cost on the API. Prices are per million tokens, in US dollars; for
 * Anthropic a cache write is 1.25 times the input price for the 5-minute cache and twice it for the hour-long one (Claude
 * Code uses either; the transcript says which). Fast mode's premium is left out.
 */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  /** A write to the 5-minute cache. */
  cacheWrite: number;
  /** A write to the hour-long cache. */
  cacheWrite1h: number;
  /**
   * A request whose prompt (input, cache reads and cache writes together) is over `over` tokens pays `price` for all
   * of its tokens, output included (Haiku 5.5). Each request on its own: the ones under it keep the lower price.
   */
  longPrompt?: { over: number; price: ModelPrice };
}

const price = (input: number, output: number, cacheRead = input / 10): ModelPrice => ({ input, output, cacheRead, cacheWrite: input * 1.25, cacheWrite1h: input * 2 });

/**
 * An OpenAI price: its cache writes last 30 minutes (`cacheWrite`) or 12 hours (`cacheWrite1h`), and a model without
 * them listed writes at the input price. A request over 272k prompt tokens pays twice for its prompt and 1.5 times for
 * its output, unless `long` is false.
 */
const openai = (input: number, cacheRead: number, output: number, cacheWrite?: [number, number], long = true): ModelPrice => {
  const p = (scale: number, outScale: number): ModelPrice => ({
    input: input * scale,
    output: output * outScale,
    cacheRead: cacheRead * scale,
    cacheWrite: (cacheWrite?.[0] ?? input) * scale,
    cacheWrite1h: (cacheWrite?.[1] ?? input) * scale,
  });
  return long ? { ...p(1, 1), longPrompt: { over: 272_000, price: p(2, 1.5) } } : p(1, 1);
};

/** An OpenAI model's whole name, with or without its snapshot date: `gpt-5-4` is not `gpt-5-4-nano`. */
const named = (name: string) => new RegExp(`${name}(-\\d{4}-\\d{2}-\\d{2})?$`);

const FABLE_5_2 = price(8, 40, 0.2);
const OPUS_5_5 = price(4, 20, 0.2);
const SONNET_5_5 = price(2, 10, 0.1);
const HAIKU_5_5: ModelPrice = { ...price(0.1, 0.5), longPrompt: { over: 100_000, price: price(0.5, 2.5) } };

/**
 * List prices by model id, first match wins: newer versions before the family's older ones. Model ids come from the
 * transcripts as the API wrote them (`claude-opus-4-1-20250805`, `claude-sonnet-5-5`), so a pattern matches a prefix
 * of the version, and a `.0` version (`opus-5`) is kept from matching a later point release (`opus-5-6`), which the
 * family's line at the end prices. Checked against Anthropic's pricing on 2026-11-17.
 */
const PRICES: ReadonlyArray<readonly [RegExp, ModelPrice]> = [
  [/(fable|mythos)-5-2/, FABLE_5_2],
  [/(fable|mythos)-5-1/, price(10, 50, 0.25)],
  [/(fable|mythos)-5(?!-\d)/, price(10, 50)],
  [/opus-5-5/, OPUS_5_5],
  [/opus-(5(?!-\d)|4-[5-9])/, price(5, 25)],
  [/opus-4|3-opus/, price(15, 75)],
  [/sonnet-5-5/, SONNET_5_5],
  [/sonnet-5(?!-\d)/, price(2, 10, 0.2)],
  [/sonnet-4|3-[57]-sonnet/, price(3, 15)],
  [/haiku-5-5/, HAIKU_5_5],
  [/haiku-4/, price(1, 5)],
  [/3-5-haiku/, price(0.8, 4)],
  [/3-haiku/, price(0.25, 1.25)],
  // A family's newer model than this table knows: priced like its latest.
  [/fable|mythos/, FABLE_5_2],
  [/opus/, OPUS_5_5],
  [/sonnet/, SONNET_5_5],
  [/haiku/, HAIKU_5_5],
  // OpenAI's, for Codex and Copilot. Checked against OpenAI's pricing on 2026-11-17; no family line, as the names don't
  // say which a newer model is like.
  [named('gpt-6-1-sol'), openai(2, 0.1, 10, [2.5, 5])],
  [named('gpt-6-luna'), openai(0.1, 0.01, 0.5, [0.125, 0.25])],
  [named('gpt-6-astra'), openai(10, 1, 50, [12.5, 25])],
  [named('gpt-5-6-terra'), openai(2, 0.2, 12, [2.5, 5])],
  [named('gpt-5-6-luna'), openai(0.2, 0.02, 1.2, [0.25, 0.5])],
  [named('gpt-5-5'), openai(5, 0.5, 30)],
  [named('gpt-5-4'), openai(2.5, 0.25, 15)],
  [named('gpt-5-3-codex'), openai(1.75, 0.175, 14, undefined, false)],
  // Microsoft's, in Copilot (Azure's list price).
  [named('mai-code-1-1-flash'), openai(0.2, 0.02, 1.2, undefined, false)],
];

/**
 * A model's list price, or null for one this table doesn't know (`<synthetic>`, a newer GPT). `prompt`: the
 * request's prompt tokens, for a model that costs more over some prompt size (`longPrompt`); left out, the lower price.
 */
export function priceOf(model: string, prompt = 0): ModelPrice | null {
  // Copilot writes versions with a dot (`claude-sonnet-4.6`, `gpt-5.4`), the APIs with a dash.
  const id = model.toLowerCase().replace(/(\d)\.(?=\d)/g, '$1-');
  const p = PRICES.find(([pattern]) => pattern.test(id))?.[1] ?? null;
  return p?.longPrompt && prompt > p.longPrompt.over ? p.longPrompt.price : p;
}

/** Over how many prompt tokens a request of this model costs more (`ModelPrice.longPrompt`), or null when size doesn't matter. */
export const longPromptOver = (model: string): number | null => priceOf(model)?.longPrompt?.over ?? null;

/** Tokens to price: `cacheWrite1h` is the part of `cacheWrite` that went to the hour-long cache (the rest is priced as 5-minute writes). */
export type PricedTokens = TokenCounts & { cacheWrite1h?: number };

const at = (tokens: PricedTokens, p: ModelPrice): number => {
  const hour = Math.min(tokens.cacheWrite, tokens.cacheWrite1h ?? 0);
  return (tokens.input * p.input + tokens.output * p.output + tokens.cacheRead * p.cacheRead + (tokens.cacheWrite - hour) * p.cacheWrite + hour * p.cacheWrite1h) / 1_000_000;
};

/**
 * What tokens of one model cost at its list price, in US dollars; null when the model has no known price. `long`: the
 * part of the tokens that came from requests over the model's `longPrompt` size, priced at its higher price.
 */
export function costOf(tokens: PricedTokens & { long?: PricedTokens }, model: string): number | null {
  const p = priceOf(model);
  if (!p) return null;
  const long = p.longPrompt ? tokens.long : undefined;
  if (!long) return at(tokens, p);
  const part = (key: keyof PricedTokens) => Math.min(tokens[key] ?? 0, long[key] ?? 0);
  const longPart: Required<PricedTokens> = { input: part('input'), output: part('output'), cacheRead: part('cacheRead'), cacheWrite: part('cacheWrite'), cacheWrite1h: part('cacheWrite1h') };
  const rest: PricedTokens = {
    input: tokens.input - longPart.input,
    output: tokens.output - longPart.output,
    cacheRead: tokens.cacheRead - longPart.cacheRead,
    cacheWrite: tokens.cacheWrite - longPart.cacheWrite,
    cacheWrite1h: (tokens.cacheWrite1h ?? 0) - longPart.cacheWrite1h,
  };
  return at(rest, p) + at(longPart, p.longPrompt!.price);
}

/** `costOf` for the tokens of one request, whose prompt size says which price it pays. */
export const requestCostOf = (tokens: PricedTokens, model: string): number | null =>
  costOf({ ...tokens, long: tokens.input + tokens.cacheRead + tokens.cacheWrite > (longPromptOver(model) ?? Infinity) ? tokens : undefined }, model);

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
