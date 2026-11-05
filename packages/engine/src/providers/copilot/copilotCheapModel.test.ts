import { describe, expect, it } from 'vitest';
import { cheapestModel, lowestEffort, type CopilotModelPrice } from './copilotCheapModel.ts';

const priced = (id: string, inputPrice: number, outputPrice: number, state = 'enabled'): CopilotModelPrice => ({ id, policy: { state }, billing: { tokenPrices: { inputPrice, outputPrice } } });
const counted = (id: string, multiplier: number): CopilotModelPrice => ({ id, billing: { multiplier } });

describe('cheapestModel', () => {
  it('picks the lowest token price, the first listed on a tie', () => {
    expect(cheapestModel([priced('sonnet', 200, 1000), priced('haiku', 10, 50), priced('luna', 10, 50), priced('mini', 20, 120)])?.id).toBe('haiku');
  });
  it('picks the lowest multiplier on an account billed per request', () => {
    expect(cheapestModel([counted('big', 1), counted('small', 0.33), counted('free', 0)])?.id).toBe('free');
  });
  it('gives nothing when every model is too dear', () => {
    expect(cheapestModel([priced('haiku-old', 100, 500), counted('big', 1)])).toBeNull();
  });
  it('never picks Auto, a model the account has off, or one that does not say its price', () => {
    expect(cheapestModel([{ id: 'auto', billing: { multiplier: 0 } }, priced('off', 1, 1, 'disabled'), { id: 'unknown' }])).toBeNull();
  });
  it('gives nothing for no models', () => {
    expect(cheapestModel([])).toBeNull();
  });
});

describe('lowestEffort', () => {
  it('takes none, then low, and otherwise leaves it to the model', () => {
    expect(lowestEffort(['none', 'low', 'high'])).toBe('none');
    expect(lowestEffort(['low', 'high'])).toBe('low');
    expect(lowestEffort(['high'])).toBeNull();
    expect(lowestEffort(undefined)).toBeNull();
  });
});
