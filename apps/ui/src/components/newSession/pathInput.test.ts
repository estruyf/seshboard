import { describe, expect, it } from 'vitest';
import type { FolderEntry, ProjectInfo } from '@switchboard/protocol/client';
import { addOrSelect, completePath, fifthTile, ghostText, isPathInput, knownFolderRows, pathRows, splitPathInput } from './pathInput.ts';

const project = (root: string, name: string, added: boolean, sessionCount = 1, lastActivity = 1, exists = true): ProjectInfo => ({
  root,
  name,
  icon: null,
  nameSource: 'folder',
  iconSource: null,
  added,
  exists,
  order: null,
  defaults: { model: null, effort: null, permissionMode: null, workspace: null, baseRef: null, branch: null },
  profileId: null,
  sessionCount,
  lastActivity,
});
const map = (...list: ProjectInfo[]) => new Map(list.map((p) => [p.root, p]));
const folder = (name: string, path = `/u/me/${name}`): FolderEntry => ({ name, path, isGit: false, branch: null });

describe('isPathInput', () => {
  it('takes ~/ and / on macOS, and plain names are names', () => {
    expect(isPathInput('~/dev', 'darwin')).toBe(true);
    expect(isPathInput('/opt', 'darwin')).toBe(true);
    expect(isPathInput('switchboard', 'darwin')).toBe(false);
    expect(isPathInput('~', 'darwin')).toBe(false);
    expect(isPathInput('~me', 'darwin')).toBe(false);
    expect(isPathInput('C:\\repos', 'darwin')).toBe(false);
  });

  it('takes a drive and ~\\ on Windows, not a bare /', () => {
    expect(isPathInput('C:\\repos', 'win32')).toBe(true);
    expect(isPathInput('e:/repos', 'win32')).toBe(true);
    expect(isPathInput('~\\dev', 'win32')).toBe(true);
    expect(isPathInput('~/dev', 'win32')).toBe(true);
    expect(isPathInput('/opt', 'win32')).toBe(false);
    expect(isPathInput('C:', 'win32')).toBe(false);
    expect(isPathInput('repos', 'win32')).toBe(false);
  });
});

describe('splitPathInput', () => {
  it('splits at the last separator', () => {
    expect(splitPathInput('~/dev/sw', 'darwin')).toEqual({ dir: '~/dev/', prefix: 'sw' });
    expect(splitPathInput('/', 'darwin')).toEqual({ dir: '/', prefix: '' });
    expect(splitPathInput('C:\\repos\\ap', 'win32')).toEqual({ dir: 'C:\\repos\\', prefix: 'ap' });
    // A backslash is part of a name on macOS.
    expect(splitPathInput('/tmp/a\\b', 'darwin')).toEqual({ dir: '/tmp/', prefix: 'a\\b' });
  });
});

describe('completion', () => {
  it('shows the rest of the match and completes the typed start of its name, in its own case', () => {
    expect(ghostText('~/dev/sw', 'Switchboard', 'darwin')).toBe('itchboard');
    expect(completePath('~/dev/sw', 'Switchboard', 'darwin')).toBe('~/dev/Switchboard');
    expect(ghostText('~/dev/', 'switchboard', 'darwin')).toBe('switchboard');
    expect(completePath('~/dev/', 'switchboard', 'darwin')).toBe('~/dev/switchboard');
  });

  it('adds a separator once the name is a folder exactly', () => {
    expect(ghostText('~/dev/switchboard', 'switchboard', 'darwin')).toBe('');
    expect(completePath('~/dev/switchboard', 'switchboard', 'darwin')).toBe('~/dev/switchboard/');
    expect(completePath('C:\\repos\\app', 'app', 'win32')).toBe('C:\\repos\\app\\');
    expect(completePath('C:/repos/app', 'app', 'win32')).toBe('C:/repos/app/');
  });

  it('does nothing for a name that does not continue the text', () => {
    expect(ghostText('~/dev/x', 'switchboard', 'darwin')).toBe('');
    expect(completePath('~/dev/x', 'switchboard', 'darwin')).toBeNull();
    expect(completePath('~/dev/x', undefined, 'darwin')).toBeNull();
  });
});

describe('pathRows', () => {
  const here = folder('dev', '/u/me/dev');
  it('puts the folder itself first after a separator, and an exact match first after a name', () => {
    expect(pathRows(here, [folder('a'), folder('b')], '').map((f) => f.name)).toEqual(['dev', 'a', 'b']);
    expect(pathRows(here, [folder('app-old'), folder('App')], 'app').map((f) => f.name)).toEqual(['App', 'app-old']);
  });

  it('filters stale results again and caps the rows', () => {
    expect(pathRows(null, [folder('alpha'), folder('beta')], 'b').map((f) => f.name)).toEqual(['beta']);
    expect(pathRows(here, Array.from({ length: 10 }, (_, i) => folder(`f${i}`)), '')).toHaveLength(6);
  });
});

describe('addOrSelect', () => {
  it('selects a folder that is already a project and adds any other', () => {
    const projects = map(project('/u/me/app', 'app', true), project('/u/me/old', 'old', false));
    expect(addOrSelect('/u/me/app', projects)).toBe('select');
    expect(addOrSelect('/u/me/old', projects)).toBe('add');
    expect(addOrSelect('/u/me/new', projects)).toBe('add');
  });
});

describe('knownFolderRows', () => {
  const projects = map(
    project('/u/me/payments', 'payments', true),
    project('/u/me/pay-old', 'pay-old', false, 3, 5),
    project('/u/me/paysite', 'paysite', false, 2, 9),
    project('/u/me/gone-pay', 'gone-pay', false, 1, 1, false),
    project('/u/me/web', 'web', false),
    project('/u/me/never', 'pay-never', false, 0),
  );

  it('offers folders with Claude sessions that are not projects yet, for a filter', () => {
    expect(knownFolderRows(projects, 'pay', '/u/me').map((p) => p.root).sort()).toEqual(['/u/me/pay-old', '/u/me/paysite']);
    expect(knownFolderRows(projects, 'zzz', '/u/me')).toEqual([]);
    expect(knownFolderRows(projects, '  ', '/u/me')).toEqual([]);
  });
});

describe('fifthTile', () => {
  it('is +N more with more projects than tiles', () => {
    expect(fifthTile(7, 4, 3)).toEqual({ kind: 'more', count: 3 });
  });
  it('is gone with four or fewer projects', () => {
    expect(fifthTile(4, 4, 0)).toBeNull();
    expect(fifthTile(1, 1, 0)).toBeNull();
    // A picked folder that isn't a project still fills a tile.
    expect(fifthTile(0, 1, 0)).toBeNull();
  });
  it('is one wide Add project… tile without any project', () => {
    expect(fifthTile(0, 0, 0)).toEqual({ kind: 'choose' });
  });
});
