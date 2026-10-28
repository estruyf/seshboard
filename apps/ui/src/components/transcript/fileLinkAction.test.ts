import { describe, expect, it } from 'vitest';
import { clickAction, fileLinkChipLabel, fileLinkError, fileLinkMenu, fileLinkTarget, fileLinkTooltip, type FileLinkNames } from './fileLinkAction.ts';

const windows: FileLinkNames = { fileManager: 'File Explorer', editor: 'VS Code' };
const mac: FileLinkNames = { fileManager: 'Finder', editor: 'Cursor' };

describe('what a click on a file link does', () => {
  it('previews a previewable file with the Seshboard setting, and Shift opens the editor', () => {
    expect(clickAction('switchboard', false, { previewable: true })).toBe('preview');
    expect(clickAction('switchboard', true, { previewable: true })).toBe('editor');
  });

  it('shows any other file in the file manager with the Seshboard setting, and Shift opens the editor', () => {
    expect(clickAction('switchboard', false)).toBe('show');
    expect(clickAction('switchboard', false, { previewable: false })).toBe('show');
    expect(clickAction('switchboard', true)).toBe('editor');
  });

  it('follows the file manager and editor settings, previewable or not', () => {
    for (const previewable of [false, true]) {
      expect(clickAction('file-manager', false, { previewable })).toBe('show');
      expect(clickAction('file-manager', true, { previewable })).toBe('editor');
      expect(clickAction('editor', false, { previewable })).toBe('editor');
      expect(clickAction('editor', true, { previewable })).toBe('show');
    }
  });

  it('is the editor where it would show the file but there is no file manager', () => {
    expect(clickAction('file-manager', false, { fileManagerAvailable: false })).toBe('editor');
    expect(clickAction('file-manager', true, { fileManagerAvailable: false })).toBe('editor');
    expect(clickAction('editor', true, { fileManagerAvailable: false })).toBe('editor');
    expect(clickAction('switchboard', false, { fileManagerAvailable: false })).toBe('editor');
  });

  it('keeps the preview where there is no file manager', () => {
    expect(clickAction('switchboard', false, { fileManagerAvailable: false, previewable: true })).toBe('preview');
    expect(clickAction('switchboard', true, { fileManagerAvailable: false, previewable: true })).toBe('editor');
  });

  it('treats a setting it does not know as the default', () => {
    expect(clickAction('reveal' as never, false)).toBe('show');
    expect(clickAction('reveal' as never, false, { previewable: true })).toBe('preview');
  });
});

describe('the target of a file link', () => {
  it('keeps the line for the editor and the preview, the range for the preview only', () => {
    expect(fileLinkTarget('C:\\a\\b.ts', 12, 'editor')).toBe('C:\\a\\b.ts:12');
    expect(fileLinkTarget('C:\\a\\b.ts', 12, 'show')).toBe('C:\\a\\b.ts');
    expect(fileLinkTarget('C:\\a\\b.md', 12, 'preview')).toBe('C:\\a\\b.md:12');
    expect(fileLinkTarget('/a/b.ts', 12, 'preview', 20)).toBe('/a/b.ts:12-20');
    expect(fileLinkTarget('/a/b.ts', 12, 'editor', 20)).toBe('/a/b.ts:12');
    expect(fileLinkTarget('/a/b.ts', 12, 'show', 20)).toBe('/a/b.ts');
    expect(fileLinkTarget('/a/b.ts', undefined, 'editor')).toBe('/a/b.ts');
  });
});

describe('the tooltip of a file link', () => {
  const shift = 'Shift+click';

  it('says what a click does and what Shift-click does instead', () => {
    expect(fileLinkTooltip({ setting: 'file-manager', path: 'C:\\a\\b.ts', line: 12, names: windows, otherKeys: shift })).toBe('Show C:\\a\\b.ts in File Explorer. Shift+click opens it in VS Code');
    expect(fileLinkTooltip({ setting: 'editor', path: 'C:\\a\\b.ts', line: 12, names: windows, otherKeys: shift })).toBe('Open C:\\a\\b.ts:12 in VS Code. Shift+click shows it in File Explorer');
  });

  it('previews a previewable file with the Seshboard setting', () => {
    expect(fileLinkTooltip({ setting: 'switchboard', path: '/a/README.md', names: mac, otherKeys: '⇧-click', previewable: true })).toBe('Preview /a/README.md in Seshboard. ⇧-click opens it in Cursor');
  });

  it('shows any other file in the file manager with the Seshboard setting', () => {
    expect(fileLinkTooltip({ setting: 'switchboard', path: '/a/b.ts', line: 3, names: mac, otherKeys: '⇧-click' })).toBe('Show /a/b.ts in Finder. ⇧-click opens it in Cursor');
  });

  it('uses the platform names', () => {
    expect(fileLinkTooltip({ setting: 'file-manager', path: '/a/b.ts', names: mac, otherKeys: '⇧-click' })).toBe('Show /a/b.ts in Finder. ⇧-click opens it in Cursor');
  });

  it('says your editor until the editors are known', () => {
    expect(fileLinkTooltip({ setting: 'file-manager', path: '/a/b.ts', names: { fileManager: 'Finder', editor: null }, otherKeys: shift })).toBe('Show /a/b.ts in Finder. Shift+click opens it in your editor');
    expect(fileLinkTooltip({ setting: 'switchboard', path: '/a/b.md', names: { fileManager: 'Finder', editor: null }, otherKeys: shift, previewable: true })).toBe('Preview /a/b.md in Seshboard. Shift+click opens it in your editor');
  });

  it('offers only the editor without a file manager, except for a preview', () => {
    expect(fileLinkTooltip({ setting: 'file-manager', path: '/a/b.ts', line: 3, names: windows, otherKeys: shift, fileManagerAvailable: false })).toBe('Open /a/b.ts:3 in VS Code');
    expect(fileLinkTooltip({ setting: 'switchboard', path: '/a/b.md', names: windows, otherKeys: shift, fileManagerAvailable: false, previewable: true })).toBe('Preview /a/b.md in Seshboard. Shift+click opens it in VS Code');
  });
});

describe('the chip beside a file tool', () => {
  it('names the action of a click', () => {
    expect(fileLinkChipLabel('preview')).toBe('Preview ↗');
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

  it('starts with Open in Seshboard for a previewable file', () => {
    expect(fileLinkMenu(mac, { previewable: true }).map((item) => item.id)).toEqual(['preview', 'show', 'editor', 'copy']);
    expect(fileLinkMenu(mac, { previewable: true })[0]!.label).toBe('Open in Seshboard');
  });

  it('leaves out the file manager where there is none', () => {
    expect(fileLinkMenu(windows, { fileManagerAvailable: false }).map((item) => item.id)).toEqual(['editor', 'copy']);
    expect(fileLinkMenu(windows, { fileManagerAvailable: false, previewable: true }).map((item) => item.id)).toEqual(['preview', 'editor', 'copy']);
  });
});

describe('a failed preview, show or open', () => {
  it('says which one failed and why', () => {
    expect(fileLinkError('show', 'C:\\a.ts', windows, 'Not found: C:\\a.ts')).toBe("Couldn't show C:\\a.ts in File Explorer: Not found: C:\\a.ts");
    expect(fileLinkError('editor', 'C:\\a.ts:3', windows, 'No editor found.')).toBe("Couldn't open C:\\a.ts:3: No editor found.");
    expect(fileLinkError('preview', 'C:\\a.md', windows, 'Not found: C:\\a.md')).toBe("Couldn't preview C:\\a.md: Not found: C:\\a.md");
  });
});
