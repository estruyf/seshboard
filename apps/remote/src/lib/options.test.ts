import { describe, expect, it } from 'vitest';
import type { RemoteOptions } from '@switchboard/protocol/remote-client';
import { changedFrom, defaultChoice, modelLabel, takesEffort } from './options.ts';

const options: RemoteOptions = {
  models: [
    { value: 'opus', displayName: 'Opus', description: '', supportsEffort: true },
    { value: 'haiku', displayName: 'Haiku', description: '', supportsEffort: false },
  ],
  efforts: ['low', 'medium', 'high'],
  modes: ['default', 'acceptEdits', 'plan', 'auto'],
  projects: [{ id: 'aaaaaaaaaaaaaaaa', defaults: { model: 'opus', effort: 'high', permissionMode: 'plan', worktree: true } }],
};

describe('New session choices', () => {
  it('start from the project\'s defaults', () => {
    expect(defaultChoice(options, 'aaaaaaaaaaaaaaaa')).toEqual({ model: 'opus', effort: 'high', permissionMode: 'plan', worktree: true });
    expect(defaultChoice(options, 'other')).toEqual({ model: null, effort: null, permissionMode: 'default', worktree: false });
    expect(defaultChoice(null, null).permissionMode).toBe('default');
  });

  it('send only what was changed', () => {
    const defaults = defaultChoice(options, 'aaaaaaaaaaaaaaaa');
    expect(changedFrom(defaults, defaults)).toEqual({});
    expect(changedFrom({ ...defaults, effort: 'low', worktree: false }, defaults)).toEqual({ effort: 'low', worktree: false });
    // A mode a phone can't pick is never sent, even when it is the project's default.
    expect(changedFrom({ ...defaults, permissionMode: 'bypassPermissions' }, defaults)).toEqual({});
  });

  it('name models', () => {
    expect(modelLabel(options.models, 'opus')).toBe('Opus');
    expect(modelLabel(options.models, null)).toBe('Default model');
    expect(modelLabel(options.models, 'claude-sonnet-4-5-20250929')).toBe('Sonnet');
    expect(modelLabel(options.models, 'custom-model')).toBe('custom-model');
    expect(modelLabel([{ value: 'default', displayName: 'Default (recommended)', description: '', supportsEffort: true }], null)).toBe('Default (recommended)');
  });

  it('know which models take an effort', () => {
    expect(takesEffort(options.models, 'haiku')).toBe(false);
    expect(takesEffort(options.models, null)).toBe(true);
  });
});
