import { describe, expect, it } from 'vitest';
import type { FileIconTheme } from '@seshboard/protocol/client';
import { extensionsOf, fileIconId } from './fileIcons.ts';

const THEME: FileIconTheme = {
  id: 'demo.icons/demo',
  label: 'Demo',
  hidesExplorerArrows: false,
  base: {
    file: 'file',
    folder: 'folder',
    folderExpanded: 'folder-open',
    fileNames: { 'readme.md': 'readme', '.config/app.json': 'app-config' },
    fileExtensions: { ts: 'ts', 'test.ts': 'test' },
    folderNames: { src: 'src', '.github/workflows': 'workflows' },
    folderNamesExpanded: { src: 'src-open' },
    languageIds: { python: 'python', makefile: 'make' },
  },
  light: { file: 'file-light', fileExtensions: { ts: 'ts-light' } },
  languages: { extensions: { py: 'python' }, fileNames: { makefile: 'makefile' } },
};

describe('fileIconId', () => {
  it('picks by name, then the longest extension, then the language, then the file icon', () => {
    expect(fileIconId(THEME, 'docs/README.md', { dir: false })).toBe('readme');
    expect(fileIconId(THEME, 'src/app.test.ts', { dir: false })).toBe('test');
    expect(fileIconId(THEME, 'src/app.ts', { dir: false })).toBe('ts');
    expect(fileIconId(THEME, 'tools/run.py', { dir: false })).toBe('python');
    expect(fileIconId(THEME, 'Makefile', { dir: false })).toBe('make');
    expect(fileIconId(THEME, 'notes.txt', { dir: false })).toBe('file');
  });

  it('matches a name with its folder', () => {
    expect(fileIconId(THEME, 'x/.config/app.json', { dir: false })).toBe('app-config');
    expect(fileIconId(THEME, 'app.json', { dir: false })).toBe('file');
    expect(fileIconId(THEME, '.github/workflows', { dir: true })).toBe('workflows');
  });

  it('gives folders their open and closed icons', () => {
    expect(fileIconId(THEME, 'src', { dir: true })).toBe('src');
    expect(fileIconId(THEME, 'packages/src', { dir: true, open: true })).toBe('src-open');
    expect(fileIconId(THEME, 'lib', { dir: true, open: true })).toBe('folder-open');
    expect(fileIconId(THEME, 'lib', { dir: true })).toBe('folder');
    // A name without an open icon keeps its closed one when open.
    expect(fileIconId({ ...THEME, base: { ...THEME.base, folderNamesExpanded: {} } }, 'src', { dir: true, open: true })).toBe('src');
  });

  it('uses the light entries first in light mode', () => {
    expect(fileIconId(THEME, 'a.ts', { dir: false, light: true })).toBe('ts-light');
    expect(fileIconId(THEME, 'a.txt', { dir: false, light: true })).toBe('file-light');
    expect(fileIconId(THEME, 'README.md', { dir: false, light: true })).toBe('readme');
  });

  it('gives null when the theme has nothing for it', () => {
    expect(fileIconId({ ...THEME, base: {}, light: null }, 'a.txt', { dir: false })).toBeNull();
  });
});

it('lists the extensions of a name, longest first', () => {
  expect(extensionsOf('App.Test.TS')).toEqual(['test.ts', 'ts']);
  expect(extensionsOf('.gitignore')).toEqual(['gitignore']);
  expect(extensionsOf('Makefile')).toEqual([]);
  expect(extensionsOf('trailing.')).toEqual([]);
});
