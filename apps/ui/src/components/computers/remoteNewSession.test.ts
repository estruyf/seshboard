import { describe, expect, it } from 'vitest';
import type { RemoteOptions, RemoteSession } from '@seshboard/protocol/client';
import { remoteBranchChoices, remoteChanges, remoteCheckoutBranch, remoteDefaultChoice, remoteModelChoice, remoteModelChoices, remoteModelLabel, remoteProfiles, remoteProjectProfile, remoteProjectTiles, remoteProviderCreate, remoteTakesEffort } from './remoteNewSession.ts';

const project = (id: string, name: string) => ({ id: id.padEnd(16, '0'), name });
const session = (id: string, projectId: string, status: RemoteSession['status'], updatedAt = 1): RemoteSession => ({
  id,
  title: id,
  projectId: projectId.padEnd(16, '0'),
  projectName: projectId,
  branch: null,
  status,
  updatedAt,
  unread: false,
  pinned: false,
  model: null,
  permissionMode: null,
  profile: null,
});

describe('New session on another computer', () => {
  it('lists that computer’s projects, what needs you and what works first', () => {
    const projects = [project('a', 'cycling'), project('b', 'front-matter'), project('c', 'involv'), project('d', 'wielerwaas')];
    const tiles = remoteProjectTiles(projects, {
      sessions: [session('s1', 'c', 'working'), session('s2', 'c', 'working'), session('s3', 'b', 'idle'), session('s4', 'd', 'idle', 50)],
      prompts: [{ requestId: 'r', sessionId: 's3', toolName: 'Bash', input: {}, title: null, description: null, alwaysLabel: null, createdAt: 1 }],
    });
    expect(tiles.map((t) => [t.project.name, t.label])).toEqual([
      ['front-matter', 'needs you'],
      ['involv', '2 working'],
      ['wielerwaas', 'idle'],
      ['cycling', 'idle'],
    ]);
  });

  it('works before the session list came', () => {
    expect(remoteProjectTiles([project('b', 'b'), project('a', 'a')], null).map((t) => t.project.name)).toEqual(['a', 'b']);
  });
});

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

describe('New session choices on another computer', () => {
  it("start from the project's defaults", () => {
    expect(remoteDefaultChoice(options, 'aaaaaaaaaaaaaaaa')).toEqual({ profileId: 'default', model: 'opus', effort: 'high', permissionMode: 'plan', worktree: true, baseRef: 'fresh' });
    expect(remoteDefaultChoice(options, 'other')).toEqual({ profileId: 'default', model: null, effort: null, permissionMode: 'default', worktree: false, baseRef: 'fresh' });
    expect(remoteDefaultChoice(null, null).permissionMode).toBe('default');
  });

  it("take the project's profile, and another profile's defaults under the project's own", () => {
    expect(remoteProjectProfile(options, 'bbbbbbbbbbbbbbbb')).toBe('work');
    expect(remoteProjectProfile(options, 'aaaaaaaaaaaaaaaa')).toBe('default');
    expect(remoteDefaultChoice(options, 'bbbbbbbbbbbbbbbb')).toEqual({ profileId: 'work', model: 'haiku', effort: 'low', permissionMode: 'plan', worktree: true, baseRef: 'fresh' });
    expect(remoteDefaultChoice(options, 'bbbbbbbbbbbbbbbb', 'default')).toEqual({ profileId: 'default', model: null, effort: null, permissionMode: 'plan', worktree: false, baseRef: 'fresh' });
  });

  it('work with a computer that sends no profiles', () => {
    const older = { ...options, profiles: undefined, defaultProfileId: undefined, projects: [{ id: 'aaaaaaaaaaaaaaaa', defaults: options.projects[0]!.defaults }] } as unknown as RemoteOptions;
    expect(remoteProfiles(older)).toEqual([]);
    expect(remoteProjectProfile(older, 'aaaaaaaaaaaaaaaa')).toBe('default');
    expect(remoteDefaultChoice(older, 'aaaaaaaaaaaaaaaa').model).toBe('opus');
  });

  it('start on the default model when the default is Auto and Auto is off there', () => {
    const auto = { ...options, projects: [{ ...options.projects[0]!, defaults: { ...options.projects[0]!.defaults, model: 'auto' } }] };
    expect(remoteDefaultChoice({ ...auto, auto: { enabled: false, allowed: [] } }, 'aaaaaaaaaaaaaaaa').model).toBeNull();
    expect(remoteDefaultChoice({ ...auto, auto: { enabled: true, allowed: ['sonnet'] } }, 'aaaaaaaaaaaaaaaa').model).toBe('auto');
  });

  it('send only what changed, and the profile only when it is not the project\'s', () => {
    const defaults = remoteDefaultChoice(options, 'bbbbbbbbbbbbbbbb');
    expect(remoteChanges(defaults, defaults, 'work')).toEqual({});
    const other = remoteDefaultChoice(options, 'bbbbbbbbbbbbbbbb', 'default');
    expect(remoteChanges({ ...other, model: 'opus' }, other, 'work')).toEqual({ profileId: 'default', model: 'opus' });
    // Bypass is only picked on the computer itself.
    expect(remoteChanges({ ...defaults, permissionMode: 'bypassPermissions' }, defaults, 'work')).toEqual({});
  });

  it('send where a new worktree starts only for a worktree, and only when it is not the default', () => {
    const defaults = remoteDefaultChoice(options, 'bbbbbbbbbbbbbbbb');
    expect(remoteChanges({ ...defaults, baseRef: 'refs/remotes/origin/dev' }, defaults, 'work')).toEqual({ worktreeBase: 'refs/remotes/origin/dev' });
    expect(remoteChanges({ ...defaults, worktree: false, baseRef: 'head' }, defaults, 'work')).toEqual({ worktree: false });
    const withBase = { ...options, projects: options.projects.map((p) => (p.id === 'bbbbbbbbbbbbbbbb' ? { ...p, defaults: { ...p.defaults, baseRef: 'refs/heads/dev' as const } } : p)) };
    expect(remoteDefaultChoice(withBase, 'bbbbbbbbbbbbbbbb').baseRef).toBe('refs/heads/dev');
  });

  it('name models and say whether they take an effort', () => {
    expect(remoteModelLabel(options.models, null)).toBe('Default model');
    expect(remoteModelLabel(options.models, 'auto')).toBe('Auto');
    expect(remoteModelLabel(options.models, 'haiku')).toBe('Haiku');
    expect(remoteModelLabel(options.models, 'claude-sonnet-5-5')).toBe('Sonnet');
    expect(remoteTakesEffort(options.models, null)).toBe(true);
    expect(remoteTakesEffort(options.models, 'haiku')).toBe(false);
    expect(remoteTakesEffort(options.models, 'unknown')).toBe(true);
  });

  it('give a running session the model chip of the message box', () => {
    const plain = remoteModelChoice(options.models, { model: 'haiku', auto: null });
    expect(plain).toMatchObject({ value: 'haiku', label: 'Haiku', auto: null });
    expect(plain.choices.map((c) => c.value)).toEqual(['', 'opus', 'haiku']);
    // A model the list doesn't know stays in it, checked; the default is ''.
    expect(remoteModelChoice(options.models, { model: 'claude-sonnet-5-5', auto: null }).choices[0]).toEqual({ value: 'claude-sonnet-5-5', label: 'Sonnet' });
    expect(remoteModelChoice(options.models, { model: null, auto: null })).toMatchObject({ value: '', label: 'Default model' });
    // A list with its own default doesn't get a second one.
    expect(remoteModelChoice([{ value: 'default', displayName: 'Default (Opus)', description: '', supportsEffort: true }], { model: null, auto: null }).choices).toEqual([{ value: '', label: 'Default (Opus)' }]);
    expect(remoteModelChoice(options.models, { model: null, auto: { picked: null, choosing: true } })).toMatchObject({ value: 'auto', label: 'Auto', auto: null });
    expect(remoteModelChoice(options.models, { model: 'claude-sonnet-5-5', auto: { picked: 'sonnet', choosing: false } }).auto).toBe('Sonnet');
  });

  it('offer Auto first in New session there, and word the default for another provider', () => {
    const choices = remoteModelChoices(options.models, 'auto', { auto: { allowed: ['sonnet', 'opus'] } });
    expect(choices.map((c) => c.value)).toEqual(['auto', '', 'opus', 'haiku']);
    expect(choices[0]!.separatorAfter).toBe(true);
    expect(remoteModelChoices([], '', { defaultDescription: 'What GitHub Copilot picks' })).toEqual([{ value: '', label: 'Default model', description: 'What GitHub Copilot picks' }]);
  });
});

describe('the branch on another computer', () => {
  const branches = { current: 'main', branches: ['feat/login', 'main', 'taken'], checkedOutElsewhere: ['taken'] };

  it('lists the current branch first, and the ones in another worktree as not choosable', () => {
    expect(remoteBranchChoices(branches)).toEqual([
      { value: 'main', label: 'main', note: 'current' },
      { value: 'feat/login', label: 'feat/login' },
      { value: 'taken', label: 'taken', disabled: true, description: 'Checked out in another worktree' },
    ]);
    expect(remoteBranchChoices({ current: null, branches: ['main'], checkedOutElsewhere: [] })[0]).toEqual({ value: '', label: 'Stay on the current checkout' });
  });

  it('checks out only another branch it still lists, and never in a new worktree', () => {
    expect(remoteCheckoutBranch('feat/login', branches, false)).toBe('feat/login');
    expect(remoteCheckoutBranch('main', branches, false)).toBeNull();
    expect(remoteCheckoutBranch('feat/login', branches, true)).toBeNull();
    expect(remoteCheckoutBranch('gone', branches, false)).toBeNull();
    expect(remoteCheckoutBranch(null, branches, false)).toBeNull();
    expect(remoteCheckoutBranch('feat/login', null, false)).toBeNull();
  });
});

describe('remoteProviderCreate', () => {
  const copilot = { id: 'copilot' as const, name: 'GitHub Copilot', modes: [{ value: 'default' as const, label: 'Ask before edits', description: '' }], supports: ['worktree' as const, 'branch' as const] };

  it('sends the provider\'s own model and mode, with where when it can', () => {
    expect(remoteProviderCreate(copilot, { profileId: 'cp', model: 'gpt-5', mode: 'default', worktree: true, checkoutBranch: 'feature' })).toEqual({ profileId: 'cp', model: 'gpt-5', permissionMode: 'default', worktree: true });
    expect(remoteProviderCreate(copilot, { profileId: 'cp', model: null, mode: 'default', worktree: false, checkoutBranch: 'feature' })).toEqual({ profileId: 'cp', model: null, permissionMode: 'default', worktree: false, checkoutBranch: 'feature' });
  });

  it('leaves out a worktree and a branch for a computer whose provider has neither', () => {
    expect(remoteProviderCreate({ ...copilot, supports: [] }, { profileId: 'cp', model: null, mode: 'default', worktree: true, checkoutBranch: 'feature' })).toEqual({ profileId: 'cp', model: null, permissionMode: 'default', worktree: false });
  });
});
