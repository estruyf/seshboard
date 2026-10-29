import { describe, expect, it } from 'vitest';
import type { RemoteOptions } from '@seshboard/protocol/remote-client';
import { autoDescription, autoFace, autoOn, changedFrom, defaultChoice, modelLabel, profilesOf, projectProfile, takesEffort } from './options.ts';

const options: RemoteOptions = {
  models: [
    { value: 'opus', displayName: 'Opus', description: '', supportsEffort: true },
    { value: 'haiku', displayName: 'Haiku', description: '', supportsEffort: false },
  ],
  efforts: ['low', 'medium', 'high'],
  modes: ['default', 'acceptEdits', 'plan', 'auto'],
  profiles: [
    { id: 'default', name: 'Personal', color: 'yellow', defaults: { model: null, effort: null, permissionMode: null, worktree: null } },
    { id: 'work', name: 'Work', color: 'blue', defaults: { model: 'haiku', effort: 'low', permissionMode: 'acceptEdits', worktree: true } },
  ],
  defaultProfileId: 'default',
  projects: [
    { id: 'aaaaaaaaaaaaaaaa', profileId: null, defaults: { model: 'opus', effort: 'high', permissionMode: 'plan', worktree: true } },
    { id: 'bbbbbbbbbbbbbbbb', profileId: 'work', defaults: { model: null, effort: null, permissionMode: 'plan', worktree: null } },
  ],
};

describe('New session choices', () => {
  it('start from the project\'s defaults', () => {
    expect(defaultChoice(options, 'aaaaaaaaaaaaaaaa')).toEqual({ profileId: 'default', model: 'opus', effort: 'high', permissionMode: 'plan', worktree: true });
    expect(defaultChoice(options, 'other')).toEqual({ profileId: 'default', model: null, effort: null, permissionMode: 'default', worktree: false });
    expect(defaultChoice(null, null).permissionMode).toBe('default');
  });

  it('take the project\'s profile and its defaults under the project\'s own', () => {
    expect(projectProfile(options, 'bbbbbbbbbbbbbbbb')).toBe('work');
    expect(projectProfile(options, 'aaaaaaaaaaaaaaaa')).toBe('default');
    expect(defaultChoice(options, 'bbbbbbbbbbbbbbbb')).toEqual({ profileId: 'work', model: 'haiku', effort: 'low', permissionMode: 'plan', worktree: true });
    // Another profile for this session brings its defaults where the project sets none.
    expect(defaultChoice(options, 'bbbbbbbbbbbbbbbb', 'default')).toEqual({ profileId: 'default', model: null, effort: null, permissionMode: 'plan', worktree: false });
  });

  it('work with a computer that sends no profiles', () => {
    const older = { ...options, profiles: undefined, defaultProfileId: undefined, projects: [{ id: 'aaaaaaaaaaaaaaaa', defaults: options.projects[0]!.defaults }] } as unknown as RemoteOptions;
    expect(profilesOf(older)).toEqual([]);
    expect(defaultChoice(older, 'aaaaaaaaaaaaaaaa')).toEqual({ profileId: 'default', model: 'opus', effort: 'high', permissionMode: 'plan', worktree: true });
  });

  it('send only what was changed', () => {
    const defaults = defaultChoice(options, 'aaaaaaaaaaaaaaaa');
    expect(changedFrom(defaults, defaults)).toEqual({});
    expect(changedFrom({ ...defaults, effort: 'low', worktree: false }, defaults)).toEqual({ effort: 'low', worktree: false });
    // A mode a phone can't pick is never sent, even when it is the project's default.
    expect(changedFrom({ ...defaults, permissionMode: 'bypassPermissions' }, defaults)).toEqual({});
    // The profile only when it isn't the project's; what matches the new profile's defaults isn't sent.
    const work = defaultChoice(options, 'aaaaaaaaaaaaaaaa', 'work');
    expect(changedFrom(work, work, 'default')).toEqual({ profileId: 'work' });
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

  it('offer Auto only while it is on, and start a default of Auto on the default model while it is off', () => {
    const autoDefault = { ...options, projects: [{ id: 'cccccccccccccccc', profileId: null, defaults: { model: 'auto', effort: null, permissionMode: null, worktree: null } }] };
    expect(autoOn(options)).toBe(false);
    expect(defaultChoice(autoDefault, 'cccccccccccccccc').model).toBeNull();
    const on = { ...autoDefault, auto: { enabled: true, allowed: ['sonnet' as const, 'opus' as const] } };
    expect(autoOn(on)).toBe(true);
    expect(defaultChoice(on, 'cccccccccccccccc').model).toBe('auto');
    expect(modelLabel(on.models, 'auto')).toBe('Auto');
    expect(takesEffort(on.models, 'auto')).toBe(true);
    expect(autoDescription(['haiku', 'sonnet', 'opus'])).toBe('Haiku reads your prompt and picks Haiku, Sonnet or Opus. Picked once, when the session starts.');
    expect(autoDescription(['opus'])).toBe('Haiku reads your prompt and picks Opus. Picked once, when the session starts.');
  });

  it('show on a running session\'s chip what Auto picked', () => {
    expect(autoFace({ picked: 'sonnet', choosing: false })).toBe('Auto · Sonnet');
    expect(autoFace({ picked: null, choosing: true })).toBe('Auto');
    expect(autoFace({ picked: null, choosing: false })).toBe('Auto · Default model');
    expect(autoFace(null)).toBeNull();
    expect(autoFace(undefined)).toBeNull();
  });
});
