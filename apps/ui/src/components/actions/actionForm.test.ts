import { describe, expect, it } from 'vitest';
import type { ActionSuggestion, ListedAction } from '@switchboard/protocol/client';
import { applySavedAction, EMPTY_DRAFT, friendlySaveError, groupActions, insertVariable, projectName, scopeParams, slug, validateDraft, visibleSuggestions, withoutAction } from './actionForm.ts';

const action = (over: Partial<ListedAction>): ListedAction => ({
  ...EMPTY_DRAFT,
  id: 'test',
  name: 'Test',
  command: 'npm test',
  trusted: true,
  ...over,
  scope: over.scope ?? 'project',
});
const suggestion = (name: string): ActionSuggestion => ({
  name,
  command: `npm run ${name}`,
  type: 'shell',
  icon: 'play',
});

describe('slug', () => {
  it('turns a name into an id', () => {
    expect(slug('Run Tests!')).toBe('run-tests');
  });
  it('falls back when nothing usable is left', () => {
    expect(slug('✨')).toBe('action');
  });
});

describe('groupActions', () => {
  it('puts project and global actions under yours, shared ones apart', () => {
    const list = [action({ id: 'a' }), action({ id: 'b', scope: 'global' }), action({ id: 'c', scope: 'shared' })];
    const { yours, shared } = groupActions(list);
    expect(yours.map((a) => a.id)).toEqual(['a', 'b']);
    expect(shared.map((a) => a.id)).toEqual(['c']);
  });
});

describe('scopeParams', () => {
  it('sends global actions without a project and shared ones to the project file', () => {
    expect(scopeParams('project', '/p')).toEqual({ projectRoot: '/p' });
    expect(scopeParams('global', '/p')).toEqual({ projectRoot: null });
    expect(scopeParams('shared', '/p')).toEqual({ projectRoot: '/p', shared: true });
  });
});

describe('visibleSuggestions', () => {
  const all = ['a', 'b', 'c', 'd', 'e', 'f'].map(suggestion);
  it('shows the first four and counts the rest', () => {
    const { shown, hidden } = visibleSuggestions(all, [], false);
    expect(shown.map((s) => s.name)).toEqual(['a', 'b', 'c', 'd']);
    expect(hidden).toBe(2);
  });
  it('shows them all when expanded', () => {
    expect(visibleSuggestions(all, [], true)).toEqual({
      shown: all,
      hidden: 0,
    });
  });
  it('leaves out commands already added', () => {
    const { shown } = visibleSuggestions(all.slice(0, 2), [action({ command: 'npm run a' })], false);
    expect(shown.map((s) => s.name)).toEqual(['b']);
  });
});

describe('validateDraft', () => {
  it('needs a name and a command', () => {
    expect(validateDraft({ ...EMPTY_DRAFT, name: '  ' }, [], null)).toEqual({
      name: 'Give the action a name.',
      command: 'Enter the command to run.',
    });
  });
  it('asks for a prompt for Ask Claude actions', () => {
    expect(validateDraft({ ...EMPTY_DRAFT, name: 'X', type: 'prompt' }, [], null).command).toBe('Enter what to ask Claude.');
  });
  it('limits the name to 40 characters', () => {
    expect(validateDraft({ ...EMPTY_DRAFT, name: 'x'.repeat(41), command: 'ls' }, [], null).name).toMatch(/40/);
  });
  it('flags a name another action in the same scope already uses', () => {
    expect(validateDraft({ ...EMPTY_DRAFT, name: 'test', command: 'ls' }, [action({})], null).name).toMatch(/already/);
  });
  it('allows the same name in another scope, or for the action being edited', () => {
    expect(validateDraft({ ...EMPTY_DRAFT, name: 'Test', command: 'ls', scope: 'global' }, [action({})], null)).toEqual({});
    expect(validateDraft({ ...EMPTY_DRAFT, name: 'Test', command: 'ls' }, [action({})], { scope: 'project', id: 'test' })).toEqual({});
  });
  it('flags a new shared action your own action for this project would hide, but not the one moving', () => {
    const draft = { ...EMPTY_DRAFT, name: 'Test', command: 'ls', scope: 'shared' as const };
    expect(validateDraft(draft, [action({})], null).name).toBe('Your action “Test” for this project already uses this name.');
    expect(validateDraft(draft, [action({})], { scope: 'project', id: 'test' })).toEqual({});
  });
  it('refuses a shortcut Switchboard uses', () => {
    expect(validateDraft({ ...EMPTY_DRAFT, name: 'X', command: 'ls', shortcut: 'cmd+k' }, [], null).shortcut).toBe('⌘K is used by Switchboard.');
    expect(validateDraft({ ...EMPTY_DRAFT, name: 'X', command: 'ls', shortcut: 'cmd+shift+f' }, [], null).shortcut).toMatch(/Switchboard/);
  });
  it('refuses a shortcut another action already has, in any scope', () => {
    const list = [action({ id: 'build', name: 'Build', shortcut: 'cmd+shift+b', scope: 'global' })];
    expect(validateDraft({ ...EMPTY_DRAFT, name: 'X', command: 'ls', shortcut: 'cmd+shift+b' }, list, null).shortcut).toBe('“Build” already uses ⌘⇧B.');
  });
  it('lets the action being edited keep its shortcut, also when it moves scope', () => {
    const list = [action({ id: 'build', name: 'Build', shortcut: 'cmd+shift+b' })];
    const draft = { ...EMPTY_DRAFT, name: 'Build', command: 'ls', shortcut: 'cmd+shift+b' };
    expect(validateDraft(draft, list, { scope: 'project', id: 'build' }).shortcut).toBeUndefined();
    expect(validateDraft({ ...draft, scope: 'global' }, list, { scope: 'project', id: 'build' }).shortcut).toBeUndefined();
  });
  it('compares shortcuts saved in the older form', () => {
    const list = [action({ id: 'zoom', name: 'Zoom', shortcut: 'cmd+alt++' })];
    expect(validateDraft({ ...EMPTY_DRAFT, name: 'X', command: 'ls', shortcut: 'cmd+alt+plus' }, list, null).shortcut).toMatch(/Zoom/);
  });
});

describe('friendlySaveError', () => {
  it('replaces protocol validation messages', () => {
    expect(friendlySaveError(new Error('Invalid params for actions.save'))).toBe('Couldn’t save: check the name and command.');
  });
  it('keeps other messages', () => {
    expect(friendlySaveError('disk full')).toBe('Couldn’t save: disk full');
  });
});

describe('insertVariable', () => {
  it('inserts at the cursor', () => {
    expect(insertVariable('echo ', 5, 5, 'branch')).toEqual({
      text: 'echo ${branch}',
      cursor: 14,
    });
  });
  it('replaces the selection', () => {
    expect(insertVariable('cd X now', 3, 4, 'cwd')).toEqual({
      text: 'cd ${cwd} now',
      cursor: 9,
    });
  });
  it('clamps positions outside the text', () => {
    expect(insertVariable('ab', 10, 12, 'sessionId').text).toBe('ab${sessionId}');
  });
});

describe('projectName', () => {
  it('takes the last folder', () => {
    expect(projectName('/Users/me/code/switchboard/')).toBe('switchboard');
  });
});

describe('applySavedAction', () => {
  const dev = action({ id: 'dev', name: 'Dev' });
  const build = action({ id: 'build', name: 'Build' });
  const shared = action({ id: 'dev', name: 'Dev', scope: 'shared' });
  const names = (list: ListedAction[]) => list.map((a) => `${a.scope}:${a.id}:${a.name}`);

  it('replaces an edited action where it was', () => {
    expect(names(applySavedAction([dev, build], { ...dev, name: 'Develop' }, dev))).toEqual(['project:dev:Develop', 'project:build:Build']);
  });

  it('keeps the place of an action whose id changed with its name', () => {
    expect(names(applySavedAction([dev, build, shared], { ...dev, id: 'serve', name: 'Serve' }, dev))).toEqual(['project:serve:Serve', 'project:build:Build', 'shared:dev:Dev']);
  });

  it('moves an action to another scope without leaving the old copy', () => {
    expect(names(applySavedAction([build, dev], { ...dev, scope: 'global' }, dev))).toEqual(['project:build:Build', 'global:dev:Dev']);
  });

  it('adds a new action at the end', () => {
    expect(names(applySavedAction([dev], build, null))).toEqual(['project:dev:Dev', 'project:build:Build']);
  });

  it('leaves a shared action with the same id alone', () => {
    expect(names(applySavedAction([shared, dev], { ...dev, name: 'Develop' }, dev))).toEqual(['shared:dev:Dev', 'project:dev:Develop']);
  });
});

describe('withoutAction', () => {
  it('removes only the action in that scope', () => {
    const dev = action({ id: 'dev' });
    const shared = action({ id: 'dev', scope: 'shared' });
    expect(withoutAction([dev, shared], dev)).toEqual([shared]);
  });
});
