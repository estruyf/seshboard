import { describe, expect, it } from 'vitest';
import { modelName } from './modelName.ts';

describe('modelName', () => {
  it('names the family of a model id', () => {
    expect(modelName('claude-fable-5-1')).toBe('Fable');
    expect(modelName('claude-3-5-sonnet-20241022')).toBe('Sonnet');
    expect(modelName('claude-sonnet-5-5')).toBe('Sonnet');
  });
  it('leaves a context suffix out', () => {
    expect(modelName('opus[1m]')).toBe('Opus');
    expect(modelName('claude-opus-5-5[1m]')).toBe('Opus');
  });
  it('says Unknown without a model, and keeps an id with no family', () => {
    expect(modelName(null)).toBe('Unknown');
    expect(modelName('')).toBe('Unknown');
    expect(modelName('123')).toBe('123');
  });
});
