import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IconThemes, listIconThemes, parseJsonc } from './iconThemes.ts';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16"/></svg>';

let home: string;
const write = (path: string, content: string) => {
  mkdirSync(dirname(join(home, path)), { recursive: true });
  writeFileSync(join(home, path), content);
};

/** An icon theme extension in `~/<editor>/extensions/<folder>`. */
function extension(editor: string, folder: string, version: string, theme: Record<string, unknown>) {
  const root = `${editor}/extensions/${folder}`;
  write(`${root}/package.json`, JSON.stringify({ name: 'icons', publisher: 'Demo', version, contributes: { iconThemes: [{ id: 'demo-icons', label: 'Demo Icons', path: './dist/theme.json' }] } }));
  write(`${root}/dist/theme.json`, `// Made by hand\n${JSON.stringify(theme, null, 2).replace(/\n}$/, ',\n}')}`);
  for (const icon of ['file', 'folder', 'folder-open', 'ts', 'test', 'readme', 'src']) write(`${root}/icons/${icon}.svg`, SVG);
}

const THEME = {
  iconDefinitions: {
    ...Object.fromEntries(['file', 'folder', 'folder-open', 'ts', 'test', 'readme', 'src'].map((id) => [id, { iconPath: `../icons/${id}.svg` }])),
    font: { fontCharacter: '\\E001' },
    outside: { iconPath: '../../../../secret.svg' },
  },
  file: 'file',
  folder: 'folder',
  folderExpanded: 'folder-open',
  fileExtensions: { 'Test.TS': 'test', md: 'font' },
  fileNames: { 'README.md': 'readme', 'secret.txt': 'outside' },
  folderNames: { src: 'src' },
  languageIds: { typescript: 'ts' },
  hidesExplorerArrows: true,
  light: { fileNames: { 'readme.md': 'file' } },
};

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-icons-')));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('parseJsonc', () => {
  it('reads comments and trailing commas, and leaves strings alone', () => {
    expect(parseJsonc('{\n  // a comment\n  "a": "x // y, ]", /* block */ "b": [1, 2,],\n}')).toEqual({ a: 'x // y, ]', b: [1, 2] });
    expect(parseJsonc('{"q": "say \\"hi\\" // no"}')).toEqual({ q: 'say "hi" // no' });
  });
});

describe('icon themes', () => {
  it('lists the themes of every editor, the newest version of each once', () => {
    extension('.vscode', 'demo.icons-1.0.0', '1.0.0', THEME);
    extension('.vscode', 'demo.icons-1.10.0', '1.10.0', THEME);
    extension('.cursor', 'demo.icons-1.2.0', '1.2.0', THEME);
    expect(listIconThemes({ home, platform: process.platform })).toEqual([{ id: 'demo.icons/demo-icons', label: 'Demo Icons', editor: 'VS Code' }]);
  });

  it('leaves out a version VS Code marked as obsolete', () => {
    extension('.vscode', 'demo.icons-1.0.0', '1.0.0', THEME);
    extension('.vscode', 'demo.icons-2.0.0', '2.0.0', { ...THEME, file: 'ts' });
    write('.vscode/extensions/.obsolete', JSON.stringify({ 'demo.icons-2.0.0': true }));
    expect(new IconThemes({ home, builtInRoots: [] }).load('demo.icons/demo-icons')?.base.file).toBe('file');
  });

  it('loads the associations in lower case, with only the icons it can draw', () => {
    extension('.vscode', 'demo.icons-1.0.0', '1.0.0', THEME);
    const theme = new IconThemes({ home, builtInRoots: [] }).load('demo.icons/demo-icons');
    expect(theme).toMatchObject({
      label: 'Demo Icons',
      hidesExplorerArrows: true,
      base: { file: 'file', folder: 'folder', folderExpanded: 'folder-open', fileExtensions: { 'test.ts': 'test' }, fileNames: { 'readme.md': 'readme' }, folderNames: { src: 'src' }, languageIds: { typescript: 'ts' } },
      light: { fileNames: { 'readme.md': 'file' } },
    });
    // The font icon and the one outside the extension's folder are left out.
    expect(theme?.base.fileExtensions?.md).toBeUndefined();
    expect(theme?.base.fileNames?.['secret.txt']).toBeUndefined();
    // Without an editor's built-in languages, the common ones still map.
    expect(theme?.languages.extensions.ts).toBe('typescript');
  });

  it('reads the languages from the built-in and installed extensions', () => {
    extension('.vscode', 'demo.icons-1.0.0', '1.0.0', THEME);
    write('app/extensions/typescript-basics/package.json', JSON.stringify({ name: 'typescript-basics', publisher: 'vscode', contributes: { languages: [{ id: 'typescript', extensions: ['.ts', '.CTS'] }] } }));
    write('.vscode/extensions/demo.lang-1.0.0/package.json', JSON.stringify({ name: 'lang', publisher: 'demo', contributes: { languages: [{ id: 'demo', extensions: ['.demo'], filenames: ['Demofile'] }] } }));
    const theme = new IconThemes({ home, builtInRoots: [join(home, 'app', 'extensions')] }).load('demo.icons/demo-icons');
    expect(theme?.languages).toEqual({ extensions: { ts: 'typescript', cts: 'typescript', demo: 'demo' }, fileNames: { demofile: 'demo' } });
  });

  it('gives icons as data URLs, and null for one it does not have', async () => {
    extension('.vscode', 'demo.icons-1.0.0', '1.0.0', THEME);
    const themes = new IconThemes({ home, builtInRoots: [] });
    const icons = await themes.icons('demo.icons/demo-icons', ['ts', 'outside', 'nope']);
    expect(icons.ts).toBe(`data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}`);
    expect(icons.outside).toBeNull();
    expect(icons.nope).toBeNull();
  });

  it('gives null for a theme that is not installed', () => {
    expect(new IconThemes({ home, builtInRoots: [] }).load('demo.icons/demo-icons')).toBeNull();
  });
});
