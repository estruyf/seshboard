import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { openCacheDatabase } from '../db/database.ts';
import { migrations } from '../db/migrations.ts';
import { canSymlink } from '../util/canSymlink.ts';
import { detectIconPath, iconDataUrl, MAX_ICON_BYTES } from './projectIcons.ts';
import { decodePng, encodePng } from './pngShrink.ts';
import { folderKey, ProjectRegistry } from './projectRegistry.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const tempDir = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-projects-')));
  dirs.push(dir);
  return dir;
};
const file = (path: string, content: string | Buffer = '<svg/>') => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
};
/** A 1024-pixel PNG of noise, too large to send as it is (an app icon, as Xcode and Swift packages keep them). */
const bigPng = () => {
  const data = new Uint8Array(1024 * 1024 * 4).map(() => Math.floor(Math.random() * 256));
  const bytes = encodePng({ width: 1024, height: 1024, data });
  expect(bytes.length).toBeGreaterThan(MAX_ICON_BYTES);
  return bytes;
};
const iconSize = (icon: ReturnType<typeof iconDataUrl>) => {
  const image = icon?.kind === 'image' ? decodePng(Buffer.from(icon.dataUrl.split(',')[1]!, 'base64')) : null;
  return image ? [image.width, image.height] : null;
};

describe('detectIconPath', () => {
  it('prefers a declared icon, then conventions, then workspace packages', () => {
    const root = tempDir();
    expect(detectIconPath(root)).toBeNull();
    file(join(root, 'apps', 'web', 'public', 'favicon.svg'));
    expect(detectIconPath(root)).toBe(join(root, 'apps', 'web', 'public', 'favicon.svg'));
    file(join(root, 'public', 'favicon.ico'), 'ico');
    expect(detectIconPath(root)).toBe(join(root, 'public', 'favicon.ico'));
    file(join(root, 'public', 'favicon.svg'));
    expect(detectIconPath(root)).toBe(join(root, 'public', 'favicon.svg'));
    file(join(root, 'media', 'brand.png'), 'png');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ icon: 'media/brand.png' }));
    expect(detectIconPath(root)).toBe(join(root, 'media', 'brand.png'));
  });

  it('ignores a declared icon outside the project folder', () => {
    const outside = tempDir();
    file(join(outside, 'secret.png'), 'png');
    const root = tempDir();
    writeFileSync(join(root, '.seshboard.json'), JSON.stringify({ iconPath: join('..', relative(dirname(root), outside), 'secret.png') }));
    expect(detectIconPath(root)).toBeNull();
    writeFileSync(join(root, '.seshboard.json'), JSON.stringify({ iconPath: join(outside, 'secret.png') }));
    expect(detectIconPath(root)).toBeNull();
    // Nor through a link inside the project that points out of it (where this process may make links).
    if (canSymlink()) {
      mkdirSync(join(root, 'public'));
      symlinkSync(join(outside, 'secret.png'), join(root, 'public', 'favicon.png'));
      expect(detectIconPath(root)).toBeNull();
    }
    // A workspace package may use the monorepo's shared icon.
    file(join(root, 'media', 'icon.svg'));
    file(join(root, 'packages', 'app', 'package.json'), JSON.stringify({ icon: '../../media/icon.svg' }));
    expect(detectIconPath(root)).toBe(join(root, 'media', 'icon.svg'));
  });

  it('skips files that are too large to send', () => {
    const root = tempDir();
    file(join(root, 'logo.svg'), 'x'.repeat(MAX_ICON_BYTES + 1));
    expect(detectIconPath(root)).toBeNull();
  });

  it('finds a large app icon and scales it down', () => {
    const root = tempDir();
    file(join(root, 'Resources', 'AppIcon.png'), bigPng());
    const path = detectIconPath(root);
    expect(path?.toLowerCase()).toBe(join(root, 'Resources', 'AppIcon.png').toLowerCase());
    expect(iconSize(iconDataUrl(path!))).toEqual([128, 128]);
  });
});

describe('ProjectRegistry', () => {
  it('lists session folders and added folders with custom, detected or no icons', () => {
    const data = tempDir();
    const cache = openCacheDatabase(join(data, 'cache.sqlite'));
    const registry = new ProjectRegistry(cache.db, join(data, 'icons'));
    const withIcon = tempDir();
    file(join(withIcon, 'public', 'favicon.svg'));
    const plain = tempDir();
    registry.add(plain);

    const byRoot = () => Object.fromEntries(registry.list(new Map([[withIcon, { count: 2, lastActivity: 5 }]])).map((p) => [p.root, p]));
    expect(byRoot()[withIcon]).toMatchObject({ iconSource: 'detected', added: false, order: null, sessionCount: 2, lastActivity: 5, icon: { kind: 'image' } });
    expect(byRoot()[withIcon]!.icon).toMatchObject({ dataUrl: expect.stringMatching(/^data:image\/svg\+xml;base64,/) });
    expect(byRoot()[plain]).toMatchObject({ icon: null, iconSource: null, added: true, exists: true, order: 0, sessionCount: 0, lastActivity: null });

    registry.setIcon(plain, { kind: 'emoji', value: '🚲' });
    expect(byRoot()[plain]).toMatchObject({ icon: { kind: 'emoji', value: '🚲' }, iconSource: 'custom' });
    const custom = join(tempDir(), 'mine.png');
    file(custom, 'png-bytes');
    registry.setIcon(withIcon, { kind: 'file', path: custom });
    rmSync(custom);
    expect(byRoot()[withIcon]).toMatchObject({ iconSource: 'custom', icon: { kind: 'image', dataUrl: expect.stringMatching(/^data:image\/png/) } });
    // A large PNG is scaled down; another large image is turned away with the reason.
    const big = join(tempDir(), 'AppIcon.png');
    file(big, bigPng());
    registry.setIcon(withIcon, { kind: 'file', path: big });
    expect(iconSize(byRoot()[withIcon]!.icon)).toEqual([128, 128]);
    const photo = join(tempDir(), 'photo.jpg');
    file(photo, Buffer.alloc(MAX_ICON_BYTES + 1, 1));
    expect(() => registry.setIcon(withIcon, { kind: 'file', path: photo })).toThrow(/200 KB or smaller, or a PNG/);
    registry.setIcon(withIcon, { kind: 'none' });
    expect(byRoot()[withIcon]).toMatchObject({ icon: null });
    registry.setIcon(withIcon, { kind: 'auto' });
    expect(byRoot()[withIcon]).toMatchObject({ iconSource: 'detected' });

    registry.remove(plain);
    expect(byRoot()[plain]).toBeUndefined();
    // A folder with sessions stays listed for the Add project picker, just not as a project.
    registry.add(withIcon);
    registry.remove(withIcon);
    expect(byRoot()[withIcon]).toMatchObject({ added: false });
    expect(() => registry.add(join(plain, 'nope'))).toThrow(/Not a folder/);
    cache.close();
  });
});

describe('project list', () => {
  it('knows a folder by any spelling on Windows', () => {
    expect(folderKey('C:\\Repo\\')).toBe(folderKey('c:/repo'));
    expect(folderKey('C:\\Repo')).not.toBe(folderKey('C:\\Repo2'));
    // Elsewhere case matters, as on Linux, and macOS paths keep comparing exactly as before.
    expect(folderKey('/Users/me/Repo')).not.toBe(folderKey('/Users/me/repo'));
  });

  it.skipIf(process.platform !== 'win32')('lists a Windows folder once, however its sessions spelled it', () => {
    const data = tempDir();
    const cache = openCacheDatabase(join(data, 'cache.sqlite'));
    const registry = new ProjectRegistry(cache.db, join(data, 'icons'));
    const [added, other] = [tempDir(), tempDir()];
    registry.add(added);
    // A terminal often reports the drive in lower case; Claude Code may write `/`.
    const activity = new Map([
      [added.toLowerCase(), { count: 2, lastActivity: 10 }],
      [other, { count: 1, lastActivity: 20 }],
      [other.replace(/\\/g, '/'), { count: 3, lastActivity: 30 }],
    ]);
    // The added project keeps its own spelling and gets its sessions; the other folder's two spellings add up, under
    // the most recent one.
    expect(registry.list(activity).map((p) => [p.root, p.added, p.sessionCount])).toEqual([
      [added, true, 2],
      [other.replace(/\\/g, '/'), false, 4],
    ]);
    cache.close();
  });

  it('keeps your order, appends new projects and lists other session folders by activity', () => {
    const data = tempDir();
    const cache = openCacheDatabase(join(data, 'cache.sqlite'));
    const registry = new ProjectRegistry(cache.db, join(data, 'icons'));
    const [a, b, c, other, older] = [tempDir(), tempDir(), tempDir(), tempDir(), tempDir()];
    registry.add(a);
    registry.add(b);
    registry.add(c);
    const activity = new Map([
      [older, { count: 1, lastActivity: 10 }],
      [other, { count: 3, lastActivity: 20 }],
      [b, { count: 1, lastActivity: 30 }],
    ]);
    const roots = () => registry.list(activity).map((p) => [p.root, p.added, p.order]);
    expect(roots()).toEqual([[a, true, 0], [b, true, 1], [c, true, 2], [other, false, null], [older, false, null]]);

    registry.reorder([c, a]);
    expect(registry.addedRoots()).toEqual([c, a, b]);
    // Adding again keeps the place; removing and adding puts it at the end.
    registry.add(c);
    expect(registry.addedRoots()).toEqual([c, a, b]);
    registry.remove(c);
    registry.add(c);
    expect(registry.addedRoots()).toEqual([a, b, c]);
    cache.close();
  });

  it('names a project, and goes back to the folder name when cleared', () => {
    const data = tempDir();
    const cache = openCacheDatabase(join(data, 'cache.sqlite'));
    const registry = new ProjectRegistry(cache.db, join(data, 'icons'));
    const root = tempDir();
    const folder = basename(root);
    registry.add(root);
    const project = () => registry.list(new Map()).find((p) => p.root === root)!;
    expect(project()).toMatchObject({ name: folder, nameSource: 'folder' });

    registry.rename(root, '  Client\n  website ');
    expect(project()).toMatchObject({ name: 'Client website', nameSource: 'custom' });
    // The folder's own name, or an empty one, follows the folder again.
    registry.rename(root, folder);
    expect(project()).toMatchObject({ name: folder, nameSource: 'folder' });
    registry.rename(root, 'Docs');
    registry.rename(root, '   ');
    expect(project()).toMatchObject({ name: folder, nameSource: 'folder' });

    // Removing a project keeps its name for when it is added again.
    registry.rename(root, 'Docs');
    registry.remove(root);
    registry.add(root);
    expect(project().name).toBe('Docs');
    expect(registry.addedEntries()).toEqual([expect.objectContaining({ root, name: 'Docs' })]);
    cache.close();
  });

  it('stores defaults for new sessions, and only for projects', () => {
    const data = tempDir();
    const cache = openCacheDatabase(join(data, 'cache.sqlite'));
    const registry = new ProjectRegistry(cache.db, join(data, 'icons'));
    const root = tempDir();
    const unset = { model: null, effort: null, permissionMode: null, workspace: null, baseRef: null, branch: null, defaultBranch: null };
    expect(() => registry.setDefaults(root, unset)).toThrow(/Add this folder/);
    registry.add(root);
    const project = () => registry.list(new Map()).find((p) => p.root === root)!;
    expect(project().defaults).toEqual(unset);
    registry.setDefaults(root, { ...unset, model: 'opus', effort: 'high', workspace: 'worktree', baseRef: 'head' });
    expect(project().defaults).toEqual({ ...unset, model: 'opus', effort: 'high', workspace: 'worktree', baseRef: 'head' });

    // A value an older or newer build wrote that no longer validates falls back to unset.
    cache.db.prepare('UPDATE project_settings SET defaults_json = ? WHERE root = ?').run(JSON.stringify({ model: 'sonnet', effort: 'turbo' }), root);
    expect(project().defaults).toEqual({ ...unset, model: 'sonnet' });
    // Global default for the permission mode is kept; without it the field stays out.
    registry.setDefaults(root, { ...unset, globalPermissionMode: true });
    expect(project().defaults).toEqual({ ...unset, globalPermissionMode: true });
    registry.setDefaults(root, { ...unset, globalModel: true, globalEffort: true });
    expect(project().defaults).toEqual({ ...unset, globalModel: true, globalEffort: true });
    registry.setDefaults(root, unset);
    expect(project().defaults).not.toHaveProperty('globalPermissionMode');
    expect(project().defaults).toEqual(unset);
    cache.close();
  });
});

describe('migration to hand-added projects', () => {
  /** A database at schema v7 (before projects were added by hand), filled by `seed`. */
  const atV7 = (path: string, seed: (db: DatabaseSync) => void) => {
    const db = new DatabaseSync(path);
    migrations.slice(0, 7).forEach((sql) => db.exec(sql));
    db.exec('PRAGMA user_version = 7');
    seed(db);
    db.close();
  };
  const session = (db: DatabaseSync, id: string, root: string, at: number) =>
    db.prepare('INSERT INTO sessions (id, project_root, updated_at, summary_json) VALUES (?, ?, ?, ?)').run(id, root, at, '{}');

  it('keeps the folders upgrading users worked with in Seshboard, and the ones they added', () => {
    const path = join(tempDir(), 'cache.sqlite');
    atV7(path, (db) => {
      session(db, 'own', '/work/app', 100);
      session(db, 'own-2', '/work/app', 300);
      session(db, 'continued', '/work/lib', 200);
      session(db, 'terminal-only', '/tmp/scratch', 400);
      db.prepare('INSERT INTO owned_sessions (id, created_at) VALUES (?, 1), (?, 1)').run('own', 'own-2');
      db.prepare('INSERT INTO continued_sessions (id, created_at) VALUES (?, 1)').run('continued');
      db.prepare('INSERT INTO project_settings (root, icon_json, added_at) VALUES (?, ?, ?), (?, ?, NULL)').run('/work/added', null, 50, '/work/icon-only', '{"kind":"none"}');
    });
    const cache = openCacheDatabase(path);
    const registry = new ProjectRegistry(cache.db, join(tempDir(), 'icons'));
    expect(registry.addedRoots().sort()).toEqual(['/work/added', '/work/app', '/work/lib']);
    cache.close();
  });

  it('starts a new install with no projects', () => {
    const cache = openCacheDatabase(join(tempDir(), 'cache.sqlite'));
    expect(new ProjectRegistry(cache.db, join(tempDir(), 'icons')).addedRoots()).toEqual([]);
    cache.close();
  });
});
