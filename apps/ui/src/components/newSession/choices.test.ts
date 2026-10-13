import { describe, expect, it } from 'vitest';
import type { ProjectDefaults, ProjectInfo } from '@switchboard/protocol/client';
import { addedProjects, knownFolders, moveRoot } from '../../state/projectList.ts';
import { globalPatch, INITIAL_CHOICES, layeredDefaults, linkPermissionMode, linkStartingChoices, readGlobals, sameDefaults, startingChoices, toProjectDefaults, withNewSessionMode } from './choices.ts';

const unset: ProjectDefaults = { model: null, effort: null, permissionMode: null, workspace: null, baseRef: null, branch: null };

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
    const { branch: _, ...noProfile } = unset;
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
    // Fields the profile decides are not remembered globally either.
    expect(globalPatch({ model: 'haiku', permissionMode: 'default', effort: 'max' }, layered)).toEqual({ effort: 'max' });
    // A link takes the profile's mode, unless it never asks.
    expect(linkStartingChoices(globals, layeredDefaults(null, profile)).permissionMode).toBe('plan');
    expect(linkStartingChoices(globals, layeredDefaults(null, { ...profile, permissionMode: 'bypassPermissions' })).permissionMode).toBe('default');
    // The mode Settings sets for new sessions sits under the profile's, and fills in where the profile sets none.
    expect(startingChoices(withNewSessionMode(globals, 'acceptEdits'), layeredDefaults(null, profile)).permissionMode).toBe('plan');
    expect(startingChoices(withNewSessionMode(globals, 'acceptEdits'), layeredDefaults(null, { ...profile, permissionMode: null })).permissionMode).toBe('acceptEdits');
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

  it('only remember changes globally for fields the project leaves unset', () => {
    const project = { ...unset, model: 'opus' };
    expect(globalPatch({ model: 'haiku', effort: 'max', branch: 'x' }, project)).toEqual({ effort: 'max' });
    expect(globalPatch({ model: 'haiku' }, null)).toEqual({ model: 'haiku' });
  });

  it('save as project defaults, dropping the branch for worktrees', () => {
    const choices = { ...INITIAL_CHOICES, model: '', effort: 'high' as const, branch: 'develop' };
    expect(toProjectDefaults(choices)).toEqual({ model: null, effort: 'high', permissionMode: 'default', workspace: 'current', baseRef: 'fresh', branch: 'develop' });
    expect(toProjectDefaults({ ...choices, workspace: 'worktree' }).branch).toBeNull();
    expect(sameDefaults(toProjectDefaults(choices), toProjectDefaults(choices))).toBe(true);
    expect(sameDefaults(unset, toProjectDefaults(choices))).toBe(false);
  });

  it('read stored globals leniently', () => {
    expect(readGlobals(null)).toEqual({ globals: INITIAL_CHOICES, cwd: null });
    expect(readGlobals({ cwd: '/a', model: 'opus', workspace: 'sideways', effort: 3 })).toEqual({ globals: { ...INITIAL_CHOICES, model: 'opus' }, cwd: '/a' });
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
  const globals = { ...INITIAL_CHOICES, permissionMode: 'plan' as const };
  const project = (permissionMode: ProjectDefaults['permissionMode']): ProjectDefaults => ({ model: null, effort: null, permissionMode, workspace: null, baseRef: null, branch: null });

  it('starts in the mode picked last, unless Settings sets one', () => {
    expect(startingChoices(withNewSessionMode(globals, 'last'), null).permissionMode).toBe('plan');
    expect(startingChoices(withNewSessionMode(globals, 'auto'), null).permissionMode).toBe('auto');
    expect(startingChoices(withNewSessionMode(globals, 'default'), null).permissionMode).toBe('default');
  });

  it("gives way to a project's own default", () => {
    expect(startingChoices(withNewSessionMode(globals, 'auto'), project('acceptEdits')).permissionMode).toBe('acceptEdits');
    expect(startingChoices(withNewSessionMode(globals, 'auto'), project(null)).permissionMode).toBe('auto');
  });

  it('never reaches a session a link starts', () => {
    expect(linkStartingChoices(withNewSessionMode(globals, 'auto'), null).permissionMode).toBe('default');
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
