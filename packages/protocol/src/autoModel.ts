/**
 * Auto model: Haiku reads the first prompt and picks the model a new session starts on. Plain TypeScript (no zod),
 * so main, the engine and the renderer all share it through `./bridge`.
 */
import { priceOf } from './costEstimate.ts';

/** The model value that means "let Auto pick", next to the real models in every model menu, the queue and project defaults. */
export const AUTO_MODEL = 'auto';

/** The models Auto can pick, cheapest first. */
export const AUTO_TIERS = ['haiku', 'sonnet', 'opus', 'fable'] as const;
export type AutoTier = (typeof AUTO_TIERS)[number];

/** The efforts Auto sets with a pick, lowest first. It never goes past `high`: there the next model up often costs less. */
export const AUTO_EFFORTS = ['low', 'medium', 'high'] as const;
export type AutoEffort = (typeof AUTO_EFFORTS)[number];

export const isAutoEffort = (value: unknown): value is AutoEffort => AUTO_EFFORTS.includes(value as AutoEffort);

/** Which way Auto leans on a close call. */
export type AutoLean = 'cheaper' | 'balanced' | 'stronger';

/** Settings › Conversation › Auto model. */
export interface AutoModelPrefs {
  /** Shows Auto in the model menus. Off: anything saved as Auto starts on the default model. */
  enabled: boolean;
  /** The models it can pick; never empty. Fable is off until you turn it on: it costs twice what Opus does. */
  allowed: AutoTier[];
  lean: AutoLean;
  /** Suggests a stronger model when a session grows past its first prompt. It never switches by itself. */
  suggest: boolean;
}

export const DEFAULT_AUTO_MODEL: AutoModelPrefs = { enabled: true, allowed: ['haiku', 'sonnet', 'opus'], lean: 'balanced', suggest: true };

export const isAutoTier = (value: unknown): value is AutoTier => AUTO_TIERS.includes(value as AutoTier);

/** Keeps only valid fields; an empty or broken `allowed` falls back to the default models, in tier order. */
export function sanitizeAutoModel(input: unknown): AutoModelPrefs | null {
  if (typeof input !== 'object' || input === null) return null;
  const raw = input as Record<string, unknown>;
  const allowed = Array.isArray(raw.allowed) ? AUTO_TIERS.filter((tier) => (raw.allowed as unknown[]).includes(tier)) : [];
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_AUTO_MODEL.enabled,
    allowed: allowed.length ? allowed : [...DEFAULT_AUTO_MODEL.allowed],
    lean: raw.lean === 'cheaper' || raw.lean === 'stronger' || raw.lean === 'balanced' ? raw.lean : DEFAULT_AUTO_MODEL.lean,
    suggest: typeof raw.suggest === 'boolean' ? raw.suggest : DEFAULT_AUTO_MODEL.suggest,
  };
}

/**
 * What Auto decided for a session, kept with it so it survives a restart. `model` is null when picking failed
 * (the session then runs on the default model, and `failure` says why).
 */
export interface AutoPickInfo {
  model: AutoTier | null;
  /** Haiku's one short sentence; for a failure, why it failed ("Haiku didn't answer in time"). */
  reason: string;
  /** When it was picked (epoch ms). */
  at: number;
  /** Tokens the routing call used, all types together. */
  tokens: number;
  /** The models it could pick then, for "Run again with…". */
  allowed: AutoTier[];
  /** The effort Auto started it with; null when your own effort was kept. */
  effort?: AutoEffort | null;
  /** You changed the model since: the chip shows the plain model from then on. */
  left?: boolean;
}

/**
 * How heavy each model is against the others, for "About half of what Opus would use": each tier's output list price
 * (`priceOf`, the same table as the Usage cost), so the estimate follows the prices. Always an estimate, never a price:
 * the real cost depends on the cache and on how long the session runs.
 */
export const MODEL_WEIGHTS: Record<AutoTier, number> = {
  haiku: priceOf('claude-haiku-5-5')?.output ?? 0.5,
  sonnet: priceOf('claude-sonnet-5-5')?.output ?? 10,
  opus: priceOf('claude-opus-5-5')?.output ?? 20,
  fable: priceOf('claude-fable-5-2')?.output ?? 40,
};

/** The tier a model id or alias belongs to (`claude-sonnet-4-5` is `sonnet`), or null for another model. */
export function tierOf(model: string | null | undefined): AutoTier | null {
  if (!model) return null;
  const lower = model.toLowerCase();
  return AUTO_TIERS.find((tier) => lower.includes(tier)) ?? null;
}

/** What a model uses against Opus: Opus is 1, a cheaper model less, Fable more. */
export const estimateVsOpus = (tier: AutoTier) => MODEL_WEIGHTS[tier] / MODEL_WEIGHTS.opus;

const FRACTIONS: Array<[number, string]> = [
  [1 / 5, 'a fifth'],
  [1 / 4, 'a quarter'],
  [1 / 3, 'a third'],
  [1 / 2, 'half'],
  [3 / 5, 'three fifths'],
  [2 / 3, 'two thirds'],
  [3 / 4, 'three quarters'],
];

/** "About half of what Opus would use", "Twice what Opus would use", as plain words. Always an estimate. */
export function estimatePhrase(ratio: number): string {
  if (ratio < 0.15) return 'Under a tenth of what Opus would use';
  if (ratio >= 1.5) return ratio < 2.5 ? 'About twice what Opus would use' : `About ${Math.round(ratio)} times what Opus would use`;
  if (ratio >= 0.9) return 'The same as Opus';
  const [, words] = FRACTIONS.reduce((best, next) => (Math.abs(next[0] - ratio) < Math.abs(best[0] - ratio) ? next : best));
  return `About ${words} of what Opus would use`;
}

/** The display name of a tier ("Sonnet"). */
export const tierLabel = (tier: AutoTier) => tier[0]!.toUpperCase() + tier.slice(1);
