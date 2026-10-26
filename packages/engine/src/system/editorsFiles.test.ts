import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appStateFake } from './testing.ts';
import { detectEditors, openCommand, spawnOptions } from './editors.ts';
import { FileIndex, fuzzyScore, walk } from './files.ts';
import { ShellEnvironment } from './shellEnvironment.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const tempDir = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-sys-')));
  dirs.push(dir);
  return dir;
};

describe('openCommand', () => {
  // What exists, instead of real files: the same cases run on any OS.
  const installed = (...paths: string[]) => (path: string) => paths.includes(path);
  const mac = (editorId: string, path: string, line: number | undefined, env: Record<string, string>, isDirectory: boolean, folder?: string, exists = installed()) =>
    openCommand(editorId, path, line, env, isDirectory, folder, 'darwin', exists);

  it('jumps to a line through the editor CLI when it is on PATH', () => {
    expect(mac('vscode', '/repo/a.ts', 12, { PATH: '/usr/local/bin' }, false, undefined, installed('/usr/local/bin/code'))).toEqual({ command: '/usr/local/bin/code', args: ['-g', '/repo/a.ts:12'] });
  });

  it('opens a file in its project window where the editor can', () => {
    const exists = installed('/bin/code', '/bin/zed', '/bin/idea');
    expect(mac('vscode', '/repo/src/a.ts', 12, { PATH: '/bin' }, false, '/repo', exists).args).toEqual(['/repo', '-g', '/repo/src/a.ts:12']);
    expect(mac('zed', '/repo/src/a.ts', undefined, { PATH: '/bin' }, false, '/repo', exists).args).toEqual(['/repo', '/repo/src/a.ts']);
    // A folder opens on its own; JetBrains IDEs find the open project themselves.
    expect(mac('vscode', '/repo', undefined, { PATH: '/bin' }, true, '/repo', exists).args).toEqual(['-g', '/repo']);
    expect(mac('idea', '/repo/src/a.ts', 3, { PATH: '/bin' }, false, '/repo', exists).args).toEqual(['--line', '3', '/repo/src/a.ts']);
  });

  it('falls back to `open -a` without the CLI, and handles Finder and terminals', () => {
    expect(mac('cursor', '/repo', undefined, { PATH: '' }, true)).toEqual({ command: 'open', args: ['-a', 'Cursor', '/repo'] });
    expect(mac('finder', '/repo/a.ts', undefined, {}, false)).toEqual({ command: 'open', args: ['-R', '/repo/a.ts'] });
    expect(mac('terminal', '/repo/src/a.ts', undefined, {}, false)).toEqual({ command: 'open', args: ['-a', 'Terminal', '/repo/src'] });
    expect(() => mac('nope', '/x', undefined, {}, true)).toThrow(/Unknown editor/);
  });

  it('on Windows, runs an editor\'s .cmd through cmd.exe, and uses File Explorer and Windows Terminal', () => {
    const env = { PATH: 'C:\\Windows;C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\bin', PATHEXT: '.COM;.EXE;.BAT;.CMD', ComSpec: 'C:\\Windows\\system32\\cmd.exe' };
    const exists = installed('C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd', 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe');
    const win = (editorId: string, path: string, isDirectory: boolean, folder?: string, line?: number, extraEnv = {}) =>
      openCommand(editorId, path, line, { ...env, ...extraEnv }, isDirectory, folder, 'win32', exists);
    const code = win('vscode', 'C:\\repo\\src\\a.ts', false, 'C:\\repo', 12);
    expect(code.command).toBe('C:\\Windows\\system32\\cmd.exe');
    expect(code.verbatim).toBe(true);
    expect(code.args.slice(0, 4)).toEqual(['/d', '/v:off', '/s', '/c']);
    expect(code.args[4]).toContain('code.cmd');
    expect(win('finder', 'C:\\repo\\a b.ts', false)).toEqual({ command: 'explorer.exe', args: ['/select,"C:\\repo\\a b.ts"'], verbatim: true, window: true });
    expect(win('finder', 'C:\\repo', true)).toEqual({ command: 'explorer.exe', args: ['"C:\\repo"'], verbatim: true, window: true });
    const wt = win('windows-terminal', 'C:\\repo;x\\a.ts', false, undefined, undefined, { PATH: 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps' });
    expect(wt).toEqual({ command: 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe', args: ['-d', 'C:\\repo\\;x'], window: true });
  });
  it('on Linux, shows a file\'s folder in the file manager and opens terminals by their CLI', () => {
    const linux = (editorId: string, path: string, isDirectory: boolean) => openCommand(editorId, path, undefined, { PATH: '/usr/bin' }, isDirectory, undefined, 'linux', installed('/usr/bin/kitty', '/usr/bin/ghostty'));
    expect(linux('finder', '/repo/src/a.ts', false)).toEqual({ command: 'xdg-open', args: ['/repo/src'] });
    expect(linux('finder', '/repo', true)).toEqual({ command: 'xdg-open', args: ['/repo'] });
    expect(linux('kitty', '/repo/src/a.ts', false)).toEqual({ command: '/usr/bin/kitty', args: ['--directory', '/repo/src'] });
    expect(linux('ghostty', '/repo', true)).toEqual({ command: '/usr/bin/ghostty', args: ['--working-directory=/repo'] });
  });
});

describe('spawnOptions', () => {
  it('hides the console of a helper like cmd.exe, but never the window of Explorer or Windows Terminal', () => {
    expect(spawnOptions({ command: 'cmd.exe', args: [] }, {}).windowsHide).toBe(true);
    expect(spawnOptions({ command: 'explorer.exe', args: [], verbatim: true, window: true }, {})).toMatchObject({ windowsHide: false, windowsVerbatimArguments: true });
    expect(spawnOptions({ command: 'wt.exe', args: [], window: true }, {}, { detached: true })).toMatchObject({ windowsHide: false, detached: true });
  });
});

describe('detectEditors', () => {
  it('on Linux, offers Files when xdg-open is there, and what has a CLI', () => {
    const exists = (path: string) => ['/usr/bin/xdg-open', '/usr/bin/code', '/usr/bin/konsole', '/usr/bin/ghostty'].includes(path);
    expect(detectEditors({ PATH: '/usr/bin' }, '/home/me', 'linux', exists)).toEqual([
      { id: 'vscode', name: 'VS Code', kind: 'editor' },
      { id: 'finder', name: 'Files', kind: 'finder' },
      { id: 'ghostty', name: 'Ghostty', kind: 'terminal' },
      { id: 'konsole', name: 'Konsole', kind: 'terminal' },
    ]);
    expect(detectEditors({ PATH: '/usr/bin' }, '/home/me', 'linux', () => false)).toEqual([]);
  });

  it('on Windows, offers File Explorer and what has a CLI, also where installers put one off PATH', () => {
    const env = { PATH: 'C:\\Windows', PATHEXT: '.EXE;.CMD', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', ProgramFiles: 'C:\\Program Files' };
    const exists = (path: string) => ['C:\\Users\\me\\AppData\\Local\\Programs\\cursor\\resources\\app\\bin\\cursor.cmd', 'C:\\Program Files\\Sublime Text\\subl.exe'].includes(path);
    expect(detectEditors(env, 'C:\\Users\\me', 'win32', exists)).toEqual([
      { id: 'cursor', name: 'Cursor', kind: 'editor' },
      { id: 'sublime', name: 'Sublime Text', kind: 'editor' },
      { id: 'finder', name: 'File Explorer', kind: 'finder' },
    ]);
  });
});

describe('file search', () => {
  it('ranks basename matches first', () => {
    const files = ['src/components/sidebar/Sidebar.tsx', 'docs/side-notes.md', 'src/state/sidebarRows.ts'];
    const ranked = files
      .map((f) => ({ f, s: fuzzyScore(f, 'sidebar') }))
      .filter((x) => x.s !== null)
      .sort((a, b) => b.s! - a.s!)
      .map((x) => x.f);
    expect(ranked[0]).toBe('src/components/sidebar/Sidebar.tsx');
    expect(fuzzyScore('src/a.ts', 'zzz')).toBeNull();
    expect(fuzzyScore('src/engine/hostManager.ts', 'hstmgr')).not.toBeNull();
  });

  it('lists files outside git while skipping dependency folders', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'src'));
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(dir, 'src', 'main.ts'), '');
    writeFileSync(join(dir, 'node_modules', 'pkg', 'main.ts'), '');
    await expect(new FileIndex().search(dir, 'main', 10)).resolves.toEqual(['src/main.ts']);
  });

  it('resolves paths mentioned in a reply to files that exist', async () => {
    const home = tempDir();
    const dir = join(home, 'repo');
    mkdirSync(join(dir, 'src', 'search'), { recursive: true });
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'src', 'search', 'suggestions.ts'), '');
    writeFileSync(join(dir, 'src', 'index.ts'), '');
    writeFileSync(join(dir, 'docs', 'index.ts'), '');
    const index = new FileIndex();
    const paths = ['src/index.ts', './src/index.ts', join(dir, 'docs'), '~/repo/src/index.ts', 'suggestions.ts', 'search/suggestions.ts', 'index.ts', 'item.Description', '../repo/src/index.ts', 'nope/suggestions.ts'];
    expect(await index.resolve(dir, paths, home)).toEqual([
      join(dir, 'src', 'index.ts'),
      join(dir, 'src', 'index.ts'),
      join(dir, 'docs'),
      join(dir, 'src', 'index.ts'),
      // Found deeper in the project when exactly one file ends with the path.
      join(dir, 'src', 'search', 'suggestions.ts'),
      join(dir, 'src', 'search', 'suggestions.ts'),
      // Two files end with index.ts: no guess.
      null,
      null,
      join(dir, 'src', 'index.ts'),
      null,
    ]);
    // Without a folder only absolute and ~ paths resolve.
    expect(await index.resolve(null, ['src/index.ts', '~/repo/docs'], home)).toEqual([null, join(dir, 'docs')]);
    // On Windows Claude may write them with backslashes.
    if (sep === '\\') expect(await index.resolve(dir, ['search\\suggestions.ts', '~\\repo\\docs'], home)).toEqual([join(dir, 'src', 'search', 'suggestions.ts'), join(dir, 'docs')]);
  });

  it('walks shallow folders first, skips the home folder\'s Library and stops at its time budget', async () => {
    const home = tempDir();
    mkdirSync(join(home, 'Library', 'Caches'), { recursive: true });
    mkdirSync(join(home, 'code', 'deep'), { recursive: true });
    writeFileSync(join(home, 'Library', 'Caches', 'x.ts'), '');
    writeFileSync(join(home, 'notes.md'), '');
    writeFileSync(join(home, 'code', 'deep', 'a.ts'), '');
    expect((await walk(home, { home })).sort()).toEqual(['code/deep/a.ts', 'notes.md']);
    // Library is only skipped in the home folder itself.
    expect(await walk(join(home, 'Library'), { home })).toEqual(['Caches/x.ts']);
    // With no time left, the walk returns what it has instead of going on.
    expect(await walk(home, { home, budgetMs: -1 })).toEqual([]);
  });
});

describe('ShellEnvironment', () => {
  it('uses the cached PATH for lookups while the shell is still loading, and refreshes the cache', async () => {
    const store = appStateFake({ 'shell.path': '/cached/bin' });
    let finish!: () => void;
    const env = new ShellEnvironment(store, () => new Promise((resolve) => (finish = () => resolve({ shell: '/bin/zsh', env: { PATH: '/fresh/bin', SECRET: 'x' }, resolved: true, durationMs: 400 }))));
    expect((await env.forLookup()).PATH).toBe('/cached/bin');
    expect(await env.describe()).toMatchObject({ cached: true });
    finish();
    await env.ready;
    expect((await env.forLookup()).PATH).toBe('/fresh/bin');
    // Only PATH is persisted, never the rest of the environment.
    expect(store.dump()).toEqual({ 'shell.path': '/fresh/bin' });
  });
});
