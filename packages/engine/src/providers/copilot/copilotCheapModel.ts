import type { Effort } from '@seshboard/protocol';

/** The parts of a Copilot model that say what it costs (token prices in cents per million, or a premium request multiplier). */
export interface CopilotModelPrice {
  id: string;
  policy?: { state?: string };
  billing?: { multiplier?: number; tokenPrices?: { inputPrice?: number; outputPrice?: number } };
  supportedReasoningEfforts?: string[];
}

/** Dearer than this per million tokens, input plus output, a call per reply isn't worth it ($2). */
const MAX_TOKEN_PRICE = 200;
/** On an account billed per request: dearer than this share of a premium request isn't worth it either. */
const MAX_MULTIPLIER = 0.33;

/** What a model costs, comparable within one account; null when it isn't cheap enough, or doesn't say. */
function priceOf({ billing }: CopilotModelPrice): number | null {
  const tokens = billing?.tokenPrices;
  if (tokens?.inputPrice !== undefined && tokens.outputPrice !== undefined) {
    const price = tokens.inputPrice + tokens.outputPrice;
    return price <= MAX_TOKEN_PRICE ? price : null;
  }
  const multiplier = billing?.multiplier;
  return multiplier !== undefined && multiplier <= MAX_MULTIPLIER ? multiplier : null;
}

/**
 * The account's cheapest model it may use, the first listed on a tie; null when none is cheap enough. A model that
 * doesn't say what it costs never counts, and Auto picks for itself, so neither can run on someone's account by surprise.
 */
export function cheapestModel<M extends CopilotModelPrice>(models: readonly M[]): M | null {
  let best: { model: M; price: number } | null = null;
  for (const model of models) {
    if (model.id === 'auto' || (model.policy?.state !== undefined && model.policy.state !== 'enabled')) continue;
    const price = priceOf(model);
    if (price !== null && (!best || price < best.price)) best = { model, price };
  }
  return best?.model ?? null;
}

/** The effort that spends the fewest tokens on thinking: none where the model has it, low otherwise. */
export function lowestEffort(efforts: readonly string[] | undefined): Effort | 'none' | null {
  if (!efforts?.length) return null;
  if (efforts.includes('none')) return 'none';
  return efforts.includes('low') ? 'low' : null;
}
