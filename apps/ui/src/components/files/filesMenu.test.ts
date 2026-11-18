import { describe, expect, it } from 'vitest';
import { filesActionLabel, filesMenu } from './filesMenu.ts';

describe('the Files menu', () => {
  it('adds a file or a folder to the message first', () => {
    expect(filesMenu({ kind: 'file', path: 'src/a.ts' })[0]).toBe('add-file');
    expect(filesMenu({ kind: 'folder', path: 'src' }).slice(0, 2)).toEqual(['add-folder', 'search-folder']);
  });

  it('offers the selected lines in the viewer only when lines are picked', () => {
    const picked = { kind: 'viewer' as const, path: '/r/a.ts', lines: { start: 6, end: 12 } };
    expect(filesMenu(picked).slice(0, 3)).toEqual(['add-lines', 'ask-lines', 'add-file']);
    expect(filesActionLabel('add-lines', picked, 'Finder')).toBe('Add lines 6–12 to message');
    expect(filesActionLabel('ask-lines', picked, 'Finder')).toBe('Ask about lines 6–12');
    expect(filesMenu({ ...picked, lines: null })[0]).toBe('add-file');
  });

  it('lists the open files and closing the others only with more than one tab', () => {
    expect(filesMenu({ kind: 'tab', path: '/r/a.ts', tabs: 3 })).toEqual(expect.arrayContaining(['add-open-files', 'close-others', 'close-all']));
    expect(filesMenu({ kind: 'tab', path: '/r/a.ts', tabs: 1 })).not.toContain('add-open-files');
    expect(filesActionLabel('reveal', { kind: 'file', path: 'a' }, 'File Explorer')).toBe('Show in File Explorer');
  });
});
