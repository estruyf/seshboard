import { describe, expect, it } from 'vitest';
import type { ProfileDefaults, ProjectDefaults, ProjectInfo } from '@switchboard/protocol/client';
import { addedProjects, knownFolders, moveRoot } from '../../state/projectList.ts';
import { INITIAL_CHOICES, layeredDefaults, linkPermissionMode, linkStartingChoices, newSessionChoices, readGlobals, readLastMode, sameDefaults, startingChoices, startingMode, toProjectDefaults } from './choices.ts';

const unset: ProjectDefaults = { model: null, effort: null, permissionMode: null, workspace: null, baseRef: null, branch: null, defaultBranch: null };

describe('new session choices', () => {
  it('start from the project defaults and fall back to the global ones', () => {
    const globals = { ...INITIAL_CHOICES, model: 'sonnet', effort: 'low' as const };
    expect(startingChoices(globals, null)).toEqual({ ...globals, branch: '' });
    expect(startingChoices(globals, { ...unset, workspace: 'worktree', effort: 'high', branch: 'develop' })).toEqual({
      ...globals,
      workspace: 'worktree',
      effort: 'high',
      branch: 'develop',
    });
  });

  it('take the profile defaults where the project sets nothing', () => {
    const noProfile: ProfileDefaults = { model: null, effort: null, permissionMode: null, workspace: null, baseRef: null };
    const profile = { ...noProfile, model: 'opus', permissionMode: 'plan' as const, workspace: 'worktree' as const };
    // Without profile defaults, the project's (or nothing) as before.
    expect(layeredDefaults(null, null)).toBeNull();
    expect(layeredDefaults(null, noProfile)).toBeNull();
    expect(layeredDefaults(unset, noProfile)).toBe(unset);
    // The project's own fields win; the branch only ever comes from the project.
    const layered = layeredDefaults({ ...unset, model: 'sonnet', branch: 'develop' }, profile);
    expect(layered).toEqual({ ...unset, model: 'sonnet', permissionMode: 'plan', workspace: 'worktree', branch: 'develop' });
    expect(layeredDefaults(null, profile)).toEqual({ ...unset, model: 'opus', permissionMode: 'plan', workspace: 'worktree' });
    const globals = { ...INITIAL_CHOICES, model: 'haiku', effort: 'low' as const };
    expect(startingChoices(globals, layered)).toEqual({ ...globals, model: 'sonnet', permissionMode: 'plan', workspace: 'worktree', branch: 'develop' });
    // A link takes the profile's mode, unless it never asks.
    expect(linkStartingChoices(globals, layeredDefaults(null, profile)).permissionMode).toBe('plan');
    expect(linkStartingChoices(globals, layeredDefaults(null, { ...profile, permissionMode: 'bypassPermissions' })).permissionMode).toBe('default');
    // Use project default takes the profile's mode; a mode Settings sets is used over it.
    expect(newSessionChoices(layeredDefaults(null, profile), 'project', 'default').permissionMode).toBe('plan');
    expect(newSessionChoices(layeredDefaults(null, profile), 'acceptEdits', 'default').permissionMode).toBe('acceptEdits');
  });

  it('start a session from a link without the mode you last picked', () => {
    const globals = { ...INITIAL_CHOICES, model: 'sonnet', permissionMode: 'bypassPermissions' as const };
    // No project default: the last-used mode never carries over to a link.
    expect(linkStartingChoices(globals, null)).toEqual({ ...globals, permissionMode: 'default', branch: '' });
    expect(linkStartingChoices({ ...globals, permissionMode: 'acceptEdits' }, unset).permissionMode).toBe('default');
    // The project's own default applies, unless it never asks.
    expect(linkStartingChoices(globals, { ...unset, permissionMode: 'acceptEdits' }).permissionMode).toBe('acceptEdits');
    expect(linkStartingChoices(globals, { ...unset, permissionMode: 'plan' }).permissionMode).toBe('plan');
    for (const mode of ['bypassPermissions', 'auto', 'dontAsk'] as const) {
      expect(linkStartingChoices(globals, { ...unset, permissionMode: mode }).permissionMode).toBe('default');
      expect(linkPermissionMode(mode)).toBe('default');
    }
    expect(linkPermissionMode(null)).toBe('default');
    expect(linkPermissionMode('default')).toBe('default');
  });

  it('save as project defaults, dropping the branch for worktrees', () => {
    const choices = { ...INITIAL_CHOICES, model: '', effort: 'high' as const, branch: 'develop' };
    expect(toProjectDefaults(choices)).toEqual({ model: null, effort: 'high', permissionMode: 'default', workspace: 'current', baseRef: 'fresh', branch: 'develop', defaultBranch: null });
    expect(toProjectDefaults({ ...choices, workspace: 'worktree' }).branch).toBeNull();
    // The project's default branch isn't a New session choice: saving keeps it.
    expect(toProjectDefaults(choices, 'dev').defaultBranch).toBe('dev');
    expect(sameDefaults(toProjectDefaults(choices), toProjectDefaults(choices))).toBe(true);
    expect(sameDefaults(unset, toProjectDefaults(choices))).toBe(false);
  });

  it('read stored globals leniently', () => {
    expect(readGlobals(null)).toEqual({ globals: INITIAL_CHOICES, cwd: null });
    expect(readGlobals({ cwd: '/a', model: 'opus', workspace: 'sideways', effort: 3 })).toEqual({ globals: { ...INITIAL_CHOICES, model: 'opus' }, cwd: '/a' });
    expect(readGlobals({ baseRef: 'refs/heads/dev' }).globals.baseRef).toBe('fresh');
  });
});

const project = (root: string, extra: Partial<ProjectInfo>): ProjectInfo => ({
  root,
  name: root.split('/').pop()!,
  icon: null,
  nameSource: 'folder',
  iconSource: null,
  added: false,
  exists: true,
  order: null,
  defaults: unset,
  profileId: null,
  sessionCount: 0,
  lastActivity: null,
  ...extra,
});

describe('the permission mode for new sessions', () => {
  const project = (permissionMode: ProjectDefaults['permissionMode']): ProjectDefaults => ({ model: null, effort: null, permissionMode, workspace: null, baseRef: null, branch: null, defaultBranch: null });

  it("uses the project's default, else Ask first", () => {
    expect(startingMode('project', project('acceptEdits'), 'plan')).toBe('acceptEdits');
    expect(startingMode('project', project(null), 'plan')).toBe('default');
    expect(startingMode('project', null, 'plan')).toBe('default');
  });

  it('remembers the mode picked last, over the project default', () => {
    expect(startingMode('remember', null, 'plan')).toBe('plan');
    expect(startingMode('remember', project('acceptEdits'), 'plan')).toBe('plan');
  });

  it('starts in a mode Settings sets, over the project default', () => {
    expect(startingMode('auto', project('acceptEdits'), 'plan')).toBe('auto');
    expect(startingMode('default', project('plan'), 'plan')).toBe('default');
  });

  it('keeps the other choices from the project defaults', () => {
    expect(newSessionChoices({ ...project('plan'), model: 'opus', workspace: 'worktree' }, 'acceptEdits', 'default')).toEqual({ ...INITIAL_CHOICES, model: 'opus', workspace: 'worktree', permissionMode: 'acceptEdits', branch: '' });
  });

  it('reads the last mode leniently, never one that skips every check', () => {
    expect(readLastMode('plan')).toBe('plan');
    expect(readLastMode('auto')).toBe('auto');
    for (const value of ['bypassPermissions', 'dontAsk', '', null, undefined, 3]) expect(readLastMode(value)).toBe('default');
  });

  it('never reaches a session a link starts', () => {
    expect(linkStartingChoices(INITIAL_CHOICES, null).permissionMode).toBe('default');
  });
});

describe('project lists', () => {
  const map = new Map(
    [
      project('/w/zeta', { added: true, order: 1, sessionCount: 2, lastActivity: 10 }),
      project('/w/alpha', { added: true, order: 0 }),
      project('/w/scratch', { sessionCount: 5, lastActivity: 30 }),
      project('/w/old', { sessionCount: 1, lastActivity: 5 }),
    ].map((p) => [p.root, p]),
  );

  it('lists added projects in your order', () => {
    expect(addedProjects(map).map((p) => p.root)).toEqual(['/w/alpha', '/w/zeta']);
  });

  it('offers folders with sessions, most recent first, filterable', () => {
    expect(knownFolders(map, '', null).map((p) => p.root)).toEqual(['/w/scratch', '/w/zeta', '/w/old']);
    expect(knownFolders(map, 'scr', null).map((p) => p.root)).toEqual(['/w/scratch']);
  });

  it('moves a project up or down', () => {
    expect(moveRoot(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveRoot(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveRoot(['a', 'b', 'c'], 'x', 1)).toEqual(['a', 'b', 'c']);
  });
});
