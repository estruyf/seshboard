import { describe, expect, it } from 'vitest';
import type { ModelOption } from '@seshboard/protocol/client';
import { findModelOption } from './models.ts';

const row = (value: string, resolvedModel?: string): ModelOption => ({ value, resolvedModel, displayName: value, description: '', supportsEffort: true });
const models = [row('default', 'claude-opus-5-5'), row('opus', 'claude-opus-5-5'), row('sonnet', 'claude-sonnet-5-5'), row('claude-fable-5-1')];

describe('findModelOption', () => {
  it('matches an alias exactly', () => {
    expect(findModelOption(models, 'sonnet')?.value).toBe('sonnet');
    expect(findModelOption(models, 'claude-fable-5-1')?.value).toBe('claude-fable-5-1');
  });

  it('maps a full model id to the named alias that resolves to it', () => {
    expect(findModelOption(models, 'claude-opus-5-5')?.value).toBe('opus');
    expect(findModelOption(models, 'claude-sonnet-5-5')?.value).toBe('sonnet');
  });

  it('finds nothing for unknown or missing models', () => {
    expect(findModelOption(models, 'claude-haiku-4-5')).toBeUndefined();
    expect(findModelOption(models, null)).toBeUndefined();
  });
});
