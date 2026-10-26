import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canSymlink } from '../util/canSymlink.ts';
import { afterEach, describe, expect, it } from 'vitest';
import { expandHome, listFolders, MAX_FOLDERS } from './folders.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    // Put back what a test locked, so the folder can be removed.
    try {
      chmodSync(join(dir, 'locked'), 0o755);
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});
const tempDir = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-folders-')));
  dirs.push(dir);
  return dir;
};
const names = (result: { folders: Array<{ name: string }> }) => result.folders.map((f) => f.name);

describe('expandHome', () => {
  it('expands ~ and ~/ only', () => {
    expect(expandHome('~', '/Users/me', '/')).toBe('/Users/me');
    expect(expandHome('~/dev', '/Users/me', '/')).toBe(join('/Users/me', 'dev'));
    expect(expandHome('~other/dev', '/Users/me', '/')).toBe('~other/dev');
    expect(expandHome('/opt/x', '/Users/me', '/')).toBe('/opt/x');
  });
});

describe('listFolders', () => {
  it('expands ~ and lists folders only, sorted by name, with their git branch', async () => {
    const home = tempDir();
    mkdirSync(join(home, 'beta', '.git'), { recursive: true });
    writeFileSync(join(home, 'beta', '.git', 'HEAD'), 'ref: refs/heads/main\n');
    mkdirSync(join(home, 'Alpha'));
    writeFileSync(join(home, 'notes.txt'), 'not a folder');
    const result = await listFolders('~/', '', home);
    expect(names(result)).toEqual(['Alpha', 'beta']);
    expect(result.folders[1]).toEqual({ name: 'beta', path: join(home, 'beta'), isGit: true, branch: 'main' });
    expect(result.folders[0]!.isGit).toBe(false);
    expect(result.here?.path).toBe(home);
    // A trailing separator lists the folder; `here` is its own path without it.
    expect((await listFolders(`${join(home, 'Alpha')}/`, '', home)).here).toEqual({ name: 'Alpha', path: join(home, 'Alpha'), isGit: false, branch: null });
  });

  // Windows makes links only with Developer Mode or as an administrator (CI runners are).
  it.skipIf(!canSymlink())('filters by prefix, ignoring case, and follows links to folders', async () => {
    const root = tempDir();
    mkdirSync(join(root, 'switchboard'));
    mkdirSync(join(root, 'Site'));
    mkdirSync(join(root, 'other'));
    symlinkSync(join(root, 'other'), join(root, 'shortcut'));
    writeFileSync(join(root, 'file'), '');
    symlinkSync(join(root, 'file'), join(root, 'sfile'));
    expect(names(await listFolders(root, 's', root))).toEqual(['shortcut', 'Site', 'switchboard']);
    expect(names(await listFolders(root, 'SW', root))).toEqual(['switchboard']);
  });

  it('hides hidden folders unless the prefix starts with a dot', async () => {
    const root = tempDir();
    mkdirSync(join(root, '.config'));
    mkdirSync(join(root, 'code'));
    expect(names(await listFolders(root, '', root))).toEqual(['code']);
    expect(names(await listFolders(root, 'c', root))).toEqual(['code']);
    expect(names(await listFolders(root, '.', root))).toEqual(['.config']);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('skips folders it cannot read', async () => {
    const root = tempDir();
    mkdirSync(join(root, 'locked'));
    mkdirSync(join(root, 'open'));
    chmodSync(join(root, 'locked'), 0o000);
    expect(names(await listFolders(root, '', root))).toEqual(['open']);
    // Listing the locked folder itself is no error either.
    expect((await listFolders(join(root, 'locked'), '', root)).folders).toEqual([]);
  });

  it('lists nothing for a missing folder, a file or a relative path', async () => {
    const root = tempDir();
    writeFileSync(join(root, 'file'), '');
    expect(await listFolders(join(root, 'missing'), '', root)).toEqual({ here: null, folders: [] });
    expect(await listFolders(join(root, 'file'), '', root)).toEqual({ here: null, folders: [] });
    expect(await listFolders('relative/path', '', root)).toEqual({ here: null, folders: [] });
  });

  it(`stops at ${MAX_FOLDERS} folders`, async () => {
    const root = tempDir();
    for (let i = 0; i < MAX_FOLDERS + 10; i++) mkdirSync(join(root, `f${String(i).padStart(3, '0')}`));
    const result = await listFolders(root, '', root);
    expect(result.folders).toHaveLength(MAX_FOLDERS);
    expect(result.folders[0]!.name).toBe('f000');
  });
});
