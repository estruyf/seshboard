/**
 * Auto model: Haiku reads the first prompt and picks the model a new session starts on. Plain TypeScript (no zod),
 * so main, the engine and the renderer all share it through `./bridge`.
 */

/** The model value that means "let Auto pick", next to the real models in every model menu, the queue and project defaults. */
export const AUTO_MODEL = 'auto';

/** The models Auto can pick, cheapest first. */
export const AUTO_TIERS = ['haiku', 'sonnet', 'opus'] as const;
export type AutoTier = (typeof AUTO_TIERS)[number];

/** Which way Auto leans on a close call. */
export type AutoLean = 'cheaper' | 'balanced' | 'stronger';

/** Settings › Conversation › Auto model. */
export interface AutoModelPrefs {
  /** Shows Auto in the model menus. Off: anything saved as Auto starts on the default model. */
  enabled: boolean;
  /** The models it can pick; never empty. */
  allowed: AutoTier[];
  lean: AutoLean;
  /** Suggests a stronger model when a session grows past its first prompt. It never switches by itself. */
  suggest: boolean;
}

export const DEFAULT_AUTO_MODEL: AutoModelPrefs = { enabled: true, allowed: ['haiku', 'sonnet', 'opus'], lean: 'balanced', suggest: true };

export const isAutoTier = (value: unknown): value is AutoTier => AUTO_TIERS.includes(value as AutoTier);

/** Keeps only valid fields; an empty or broken `allowed` falls back to every model, in tier order. */
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
  /** You changed the model since: the chip shows the plain model from then on. */
  left?: boolean;
}

/**
 * How heavy each model is against the others, relative to Haiku, for "About a fifth of what Opus would use". Like
 * `SHARE_WEIGHTS` in Usage, these follow how the models are usually priced; they are estimates, never prices.
 */
export const MODEL_WEIGHTS: Record<AutoTier, number> = { haiku: 1, sonnet: 3, opus: 5 };

/** The tier a model id or alias belongs to (`claude-sonnet-4-5` is `sonnet`), or null for another model. */
export function tierOf(model: string | null | undefined): AutoTier | null {
  if (!model) return null;
  const lower = model.toLowerCase();
  return AUTO_TIERS.find((tier) => lower.includes(tier)) ?? null;
}

/** What a model uses against Opus, 0–1 (Opus itself is 1). */
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

/** "About a fifth of what Opus would use", as plain words; "The same as Opus" for Opus. Always an estimate. */
export function estimatePhrase(ratio: number): string {
  if (ratio >= 0.9) return 'The same as Opus';
  const [, words] = FRACTIONS.reduce((best, next) => (Math.abs(next[0] - ratio) < Math.abs(best[0] - ratio) ? next : best));
  return `About ${words} of what Opus would use`;
}

/** The display name of a tier ("Sonnet"). */
export const tierLabel = (tier: AutoTier) => tier[0]!.toUpperCase() + tier.slice(1);
