import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeProjectPath } from './folders.ts';
import { MemoryService } from './memoryService.ts';
import { BLOCK_END, BLOCK_START, blockLine, conflictBase, importLine, syncedBy, withBlock, withoutBlock } from './personal.ts';

let base: string;
let home: string;
let root: string;
let work: string;
let personal: string;
let chosen: string | null;
let service: MemoryService;
const builtin = () => join(home, '.claude');
const read = (path: string) => readFileSync(path, 'utf8');
const write = (path: string, text: string) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
};
const projectMemory = (configDir: string) => join(configDir, 'projects', encodeProjectPath(root), 'memory');

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-personal-')));
  home = join(base, 'home');
  root = join(home, 'code', 'app');
  work = join(base, 'work-profile');
  personal = join(base, 'app-data', 'memory');
  chosen = null;
  mkdirSync(root, { recursive: true });
  const profiles = [
    { id: 'default', configDir: builtin() },
    { id: 'work', configDir: work },
  ];
  service = new MemoryService({
    profiles: () => profiles,
    allProfiles: () => profiles,
    personalDir: () => chosen ?? personal,
    personalDefault: personal,
    savePersonalDir: (dir) => (chosen = dir),
    home,
    trash: async (paths) => paths.forEach((p) => rmSync(p)),
  });
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('the marked block in CLAUDE.md', () => {
  const line = '@~/notes/MEMORY.md';

  it('adds the block at the end and takes it out again, leaving the rest byte for byte', () => {
    const original = '# Me\n\nI like short answers.\n';
    const added = withBlock(original, line);
    expect(added).toBe(`# Me\n\nI like short answers.\n\n${BLOCK_START}\n${line}\n${BLOCK_END}\n`);
    expect(blockLine(added)).toBe(line);
    expect(withoutBlock(added)).toBe(original);
    expect(withBlock('', line)).toBe(`${BLOCK_START}\n${line}\n${BLOCK_END}\n`);
  });

  it('updates a block in the middle in place, in CRLF too', () => {
    const middle = `a\r\n${BLOCK_START}\r\n@old\r\n${BLOCK_END}\r\nb\r\n`;
    expect(withBlock(middle, line)).toBe(`a\r\n${BLOCK_START}\r\n${line}\r\n${BLOCK_END}\r\nb\r\n`);
    expect(withoutBlock(middle)).toBe('a\r\nb\r\n');
    expect(withoutBlock('no block\n')).toBe('no block\n');
  });

  it('escapes spaces and uses ~ for the import line', () => {
    expect(importLine('/Users/me/Library/Application Support/Seshboard/memory', '/Users/me')).toBe('@~/Library/Application\\ Support/Seshboard/memory/MEMORY.md');
  });

  it('installs in every profile’s CLAUDE.md, follows a new folder, and removes only the block', () => {
    write(join(builtin(), 'CLAUDE.md'), '# Mine\n');
    expect(service.blockPreview().map((p) => [p.profileId, p.exists])).toEqual([
      ['default', true],
      ['work', false],
    ]);
    expect(existsSync(personal)).toBe(false);
    service.installBlock();
    expect(existsSync(join(personal, 'MEMORY.md'))).toBe(true);
    expect(read(join(builtin(), 'CLAUDE.md'))).toBe(`# Mine\n\n${BLOCK_START}\n${importLine(personal, home)}\n${BLOCK_END}\n`);
    expect(read(join(work, 'CLAUDE.md'))).toBe(`${BLOCK_START}\n${importLine(personal, home)}\n${BLOCK_END}\n`);
    expect(service.personal().profiles.every((p) => p.installed && p.upToDate)).toBe(true);

    const synced = join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Memory');
    service.setPersonalDir(synced);
    expect(read(join(builtin(), 'CLAUDE.md'))).toContain(`@~/Library/Mobile\\ Documents/com~apple~CloudDocs/Memory/MEMORY.md`);
    expect(service.personal().synced).toBe('iCloud Drive');

    service.removeBlock();
    expect(read(join(builtin(), 'CLAUDE.md'))).toBe('# Mine\n');
    expect(read(join(work, 'CLAUDE.md'))).toBe('');
    expect(service.personal().profiles.some((p) => p.installed)).toBe(false);
  });
});

/** A path as index lines and imports write it: with `/`, which Claude Code reads on Windows too. */
const slashed = (path: string) => path.replace(/\\/g, '/');

describe('moving memory', () => {
  it('moves a memory to personal and back, with both index lines', async () => {
    const dir = projectMemory(builtin());
    write(join(dir, 'profile.md'), '---\nname: profile\ndescription: Who I am\nmetadata:\n  type: user\n---\n\nBelgian dev.\n');
    write(join(dir, 'MEMORY.md'), '- [Profile](profile.md): Who I am\n- [other](other.md): keep\n');
    const { path } = await service.move({ root, path: join(dir, 'profile.md'), to: 'personal' });
    expect(path).toBe(join(personal, 'profile.md'));
    expect(read(join(dir, 'MEMORY.md'))).toBe('- [other](other.md): keep\n');
    expect(read(join(personal, 'MEMORY.md'))).toBe(`- [Profile](${slashed(join(personal, 'profile.md'))}) — Who I am\n`);
    expect(service.personal().memories.map((m) => [m.name, m.profileId])).toEqual([['profile', null]]);

    const back = await service.move({ root, path, to: 'project', profileId: 'work' });
    expect(back.path).toBe(join(projectMemory(work), 'profile.md'));
    expect(read(join(personal, 'MEMORY.md'))).toBe('');
    expect(read(join(projectMemory(work), 'MEMORY.md'))).toBe('- [Profile](profile.md) — Who I am\n');
  });

  it('refuses a name that’s taken in the other folder', async () => {
    write(join(projectMemory(builtin()), 'a.md'), 'x');
    write(join(personal, 'a.md'), 'y');
    await expect(service.move({ root, path: join(projectMemory(builtin()), 'a.md'), to: 'personal' })).rejects.toThrow(/already/);
  });

  it('writes personal memories with full-path index lines', () => {
    service.create({ root: null, name: 'cycling', type: 'reference', description: 'Rides', body: 'A-group.' });
    expect(read(join(personal, 'MEMORY.md'))).toBe(`- [cycling](${slashed(join(personal, 'cycling.md'))}) — Rides\n`);
  });
});

describe('sync conflicts', () => {
  it('recognises the copies sync tools make, only next to the original', () => {
    const has = (names: string[]) => (name: string) => names.includes(name);
    expect(conflictBase("profile (Elio's conflicted copy 2026-10-10).md", has(['profile.md']))).toBe('profile.md');
    expect(conflictBase('profile 2.md', has(['profile.md']))).toBe('profile.md');
    expect(conflictBase('profile (1).md', has(['profile.md']))).toBe('profile.md');
    expect(conflictBase('profile 2.md', has([]))).toBeNull();
    expect(conflictBase('release-2.md', has(['release.md']))).toBeNull();
  });

  it('lists a conflicted copy with its original, and keeps either one', async () => {
    write(join(personal, 'profile.md'), '---\nname: profile\n---\nmine\n');
    write(join(personal, 'profile 2.md'), '---\nname: profile\n---\ntheirs\n');
    const copy = service.personal().memories.find((m) => m.conflictOf);
    expect(copy?.path).toBe(join(personal, 'profile 2.md'));
    expect(copy?.conflictOf).toBe(join(personal, 'profile.md'));
    await service.resolveConflict({ root: null, path: copy!.path, keep: 'this' });
    expect(read(join(personal, 'profile.md'))).toContain('theirs');
    expect(existsSync(join(personal, 'profile 2.md'))).toBe(false);

    write(join(personal, 'profile 2.md'), 'other');
    await service.resolveConflict({ root: null, path: join(personal, 'profile 2.md'), keep: 'other' });
    expect(read(join(personal, 'profile.md'))).toContain('theirs');
    expect(existsSync(join(personal, 'profile 2.md'))).toBe(false);
  });
});

describe('synced folders', () => {
  it('names iCloud, Dropbox, Google Drive, OneDrive and git repositories', () => {
    const no = () => false;
    expect(syncedBy('/Users/me/Library/Mobile Documents/com~apple~CloudDocs/M', '/Users/me', no)).toBe('iCloud Drive');
    expect(syncedBy('/Users/me/Library/CloudStorage/Dropbox/M', '/Users/me', no)).toBe('Dropbox');
    expect(syncedBy('/Users/me/Dropbox/M', '/Users/me', no)).toBe('Dropbox');
    expect(syncedBy('/Users/me/Library/CloudStorage/GoogleDrive-me@x.com/My Drive/M', '/Users/me', no)).toBe('Google Drive');
    expect(syncedBy('/Users/me/Library/CloudStorage/OneDrive-Personal/M', '/Users/me', no)).toBe('OneDrive');
    expect(syncedBy('/Users/me/notes/memory', '/Users/me', (d) => d === '/Users/me/notes')).toBe('a git repository');
    expect(syncedBy('/Users/me/Library/Application Support/Seshboard/memory', '/Users/me', no)).toBeNull();
  });
});
