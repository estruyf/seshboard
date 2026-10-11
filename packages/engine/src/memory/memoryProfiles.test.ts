import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppStateStore } from '../db/appState.ts';
import { openCacheDatabase } from '../db/database.ts';
import { git } from '../git/gitChanges.ts';
import { ProfileStore } from '../profiles/profileStore.ts';
import { encodeProjectPath } from './folders.ts';
import { MemoryService } from './memoryService.ts';

let base: string;
let root: string;
let service: MemoryService;
const write = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
const memoryOf = (profile: string) => join(base, profile, 'projects', encodeProjectPath(root), 'memory');

beforeEach(async () => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-memory-profiles-')));
  root = join(base, 'project');
  mkdirSync(root, { recursive: true });
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['config', 'user.email', 'test@example.com']);
  await git(root, ['config', 'user.name', 'Test']);
  service = new MemoryService({
    profiles: () => [
      { id: 'default', configDir: join(base, 'default') },
      { id: 'work', configDir: join(base, 'work') },
    ],
    trash: async () => {},
  });
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('memory and profiles', () => {
  it('lists the memories of every profile with their profile', async () => {
    write(join(memoryOf('default'), 'a.md'), '---\nname: a\n---\nx\n');
    write(join(memoryOf('work'), 'b.md'), '---\nname: b\n---\ny\n');
    const { memories } = await service.list(root);
    expect(memories.map((m) => [m.name, m.profileId]).sort()).toEqual([
      ['a', 'default'],
      ['b', 'work'],
    ]);
  });

  it('copies a memory to another profile, with -2 when the name is taken there', () => {
    write(join(memoryOf('default'), 'release.md'), '---\nname: release\ndescription: How to release\n---\nSteps.\n');
    write(join(memoryOf('default'), 'MEMORY.md'), '- [Release](release.md) — How to release\n');
    const first = service.copyToProfile({ root, path: join(memoryOf('default'), 'release.md'), profileId: 'work' });
    expect(first.path).toBe(join(memoryOf('work'), 'release.md'));
    expect(readFileSync(join(memoryOf('work'), 'MEMORY.md'), 'utf8')).toBe('- [Release](release.md) — How to release\n');
    const second = service.copyToProfile({ root, path: join(memoryOf('default'), 'release.md'), profileId: 'work' });
    expect(second.path).toBe(join(memoryOf('work'), 'release-2.md'));
    expect(readFileSync(second.path, 'utf8')).toContain('name: release-2\n');
    expect(() => service.copyToProfile({ root, path: join(memoryOf('default'), 'release.md'), profileId: 'default' })).toThrow(/already/);
  });
});

describe('instructions', () => {
  it('finds CLAUDE.md in subfolders and agent memory, and leaves out dependencies and worktrees', async () => {
    write(join(root, 'CLAUDE.md'), '# Root\n');
    write(join(root, 'apps', 'ui', 'CLAUDE.md'), '# UI\n');
    write(join(root, 'apps', 'ui', 'CLAUDE.local.md'), '# Mine\n');
    write(join(root, 'node_modules', 'x', 'CLAUDE.md'), '# Not this\n');
    write(join(root, '.claude', 'worktrees', 'wt', 'CLAUDE.md'), '# Not this either\n');
    write(join(root, '.claude', 'agent-memory', 'reviewer', 'notes.md'), 'Agent notes.\n');
    write(join(root, '.gitignore'), 'CLAUDE.local.md\n');
    const { instructions } = await service.list(root);
    expect(instructions.map((i) => [i.path.slice(root.length + 1).split(sep).join('/'), i.kind, i.shared])).toEqual([
      ['CLAUDE.md', 'claude-md', true],
      ['apps/ui/CLAUDE.md', 'subfolder', true],
      ['apps/ui/CLAUDE.local.md', 'local', false],
      ['.claude/agent-memory/reviewer/notes.md', 'agent-memory', true],
    ]);
  });

  it('saves an instruction file, says it changed in git, and refuses other files and stale saves', async () => {
    write(join(root, 'CLAUDE.md'), '# Root\n');
    await git(root, ['add', 'CLAUDE.md']);
    await git(root, ['commit', '-qm', 'claude']);
    const path = join(root, 'CLAUDE.md');
    const result = await service.writeInstruction({ root, path, content: '# Root\n\nMore.\n', expectedModified: null, force: false });
    expect(result.changedInGit).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe('# Root\n\nMore.\n');
    expect((await git(root, ['diff', '--cached', '--name-only'])).trim()).toBe('');
    await expect(service.writeInstruction({ root, path, content: 'x', expectedModified: 1, force: false })).rejects.toThrow(/changed on disk/);
    write(join(root, 'README.md'), 'hi');
    await expect(service.writeInstruction({ root, path: join(root, 'README.md'), content: 'x', expectedModified: null, force: false })).rejects.toThrow(/instruction/);
  });
});

describe('the built-in profile', () => {
  it('never sets CLAUDE_CONFIG_DIR for it, only for profiles you add', () => {
    const cache = openCacheDatabase(join(base, 'cache.sqlite'));
    try {
      const store = new ProfileStore(cache.db, createAppStateStore(cache.db), { configDir: join(base, '.claude'), fromEnv: false });
      const builtin = store.runtime('default');
      expect(builtin.configDir).toBe(join(base, '.claude'));
      expect(builtin.envDir).toBeUndefined();
      mkdirSync(join(base, 'work', 'projects'), { recursive: true });
      const id = store.add('Work', 'blue', join(base, 'work'));
      expect(store.runtime(id).envDir).toBe(join(base, 'work'));
    } finally {
      cache.close();
    }
  });
});
