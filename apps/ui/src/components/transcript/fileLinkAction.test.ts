import { describe, expect, it } from 'vitest';
import { clickAction, fileLinkChipLabel, fileLinkError, fileLinkMenu, fileLinkTarget, fileLinkTooltip, type FileLinkNames } from './fileLinkAction.ts';

const windows: FileLinkNames = { fileManager: 'File Explorer', editor: 'VS Code' };
const mac: FileLinkNames = { fileManager: 'Finder', editor: 'Cursor' };

describe('what a click on a file link does', () => {
  it('follows the setting, and Shift does the other', () => {
    expect(clickAction('file-manager', false)).toBe('show');
    expect(clickAction('file-manager', true)).toBe('editor');
    expect(clickAction('editor', false)).toBe('editor');
    expect(clickAction('editor', true)).toBe('show');
  });

  it('is the editor when there is no file manager to show the file in', () => {
    expect(clickAction('file-manager', false, false)).toBe('editor');
    expect(clickAction('file-manager', true, false)).toBe('editor');
    expect(clickAction('editor', true, false)).toBe('editor');
  });

  it('treats a setting it does not know as the default', () => {
    expect(clickAction('reveal' as never, false)).toBe('show');
  });
});

describe('the target of a file link', () => {
  it('keeps the line for the editor only', () => {
    expect(fileLinkTarget('C:\\a\\b.ts', 12, 'editor')).toBe('C:\\a\\b.ts:12');
    expect(fileLinkTarget('C:\\a\\b.ts', 12, 'show')).toBe('C:\\a\\b.ts');
    expect(fileLinkTarget('/a/b.ts', undefined, 'editor')).toBe('/a/b.ts');
  });
});

describe('the tooltip of a file link', () => {
  const shift = 'Shift+click';

  it('says what a click does and what Shift-click does instead', () => {
    expect(fileLinkTooltip({ setting: 'file-manager', path: 'C:\\a\\b.ts', line: 12, names: windows, otherKeys: shift })).toBe('Show C:\\a\\b.ts in File Explorer. Shift+click opens it in VS Code');
    expect(fileLinkTooltip({ setting: 'editor', path: 'C:\\a\\b.ts', line: 12, names: windows, otherKeys: shift })).toBe('Open C:\\a\\b.ts:12 in VS Code. Shift+click shows it in File Explorer');
  });

  it('uses the platform names', () => {
    expect(fileLinkTooltip({ setting: 'file-manager', path: '/a/b.ts', names: mac, otherKeys: '⇧-click' })).toBe('Show /a/b.ts in Finder. ⇧-click opens it in Cursor');
  });

  it('says your editor until the editors are known', () => {
    expect(fileLinkTooltip({ setting: 'file-manager', path: '/a/b.ts', names: { fileManager: 'Finder', editor: null }, otherKeys: shift })).toBe('Show /a/b.ts in Finder. Shift+click opens it in your editor');
  });

  it('offers only the editor without a file manager', () => {
    expect(fileLinkTooltip({ setting: 'file-manager', path: '/a/b.ts', line: 3, names: windows, otherKeys: shift, fileManagerAvailable: false })).toBe('Open /a/b.ts:3 in VS Code');
  });
});

describe('the chip beside a file tool', () => {
  it('names the action of a click', () => {
    expect(fileLinkChipLabel('show')).toBe('Show ↗');
    expect(fileLinkChipLabel('editor')).toBe('Open ↗');
  });
});

describe('the context menu of a file link', () => {
  it('lists both ways and the path, whatever the setting', () => {
    expect(fileLinkMenu(windows).map((item) => item.label)).toEqual(['Show in File Explorer', 'Open in VS Code', 'Copy path']);
    expect(fileLinkMenu(mac).map((item) => item.label)).toEqual(['Show in Finder', 'Open in Cursor', 'Copy path']);
    expect(fileLinkMenu(windows).map((item) => item.id)).toEqual(['show', 'editor', 'copy']);
  });

  it('leaves out the file manager where there is none', () => {
    expect(fileLinkMenu(windows, false).map((item) => item.id)).toEqual(['editor', 'copy']);
  });
});

describe('a failed show or open', () => {
  it('says which one failed and why', () => {
    expect(fileLinkError('show', 'C:\\a.ts', windows, 'Not found: C:\\a.ts')).toBe("Couldn't show C:\\a.ts in File Explorer: Not found: C:\\a.ts");
    expect(fileLinkError('editor', 'C:\\a.ts:3', windows, 'No editor found.')).toBe("Couldn't open C:\\a.ts:3: No editor found.");
  });
});
