import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isConfigDir, isTrashableInstructionFile, isTrashableMemoryFile, isTrashableRepoFile, isTrashableSessionPath } from './trashGuard.ts';

const config = '/Users/me/.claude';
const id = '11111111-2222-4333-8444-555555555555';

describe('isTrashableSessionPath', () => {
  it('allows a transcript and its subagent folder inside the projects folder', () => {
    expect(isTrashableSessionPath(`${config}/projects/-Users-me-app/${id}.jsonl`, config)).toBe(true);
    expect(isTrashableSessionPath(`${config}/projects/-Users-me-app/${id}`, config)).toBe(true);
  });

  it('refuses anything else', () => {
    expect(isTrashableSessionPath(`${config}/projects/-Users-me-app`, config)).toBe(false);
    expect(isTrashableSessionPath(`${config}/settings.json`, config)).toBe(false);
    expect(isTrashableSessionPath(`/Users/me/app/${id}.jsonl`, config)).toBe(false);
    expect(isTrashableSessionPath(`${config}/projects/../../${id}.jsonl`, config)).toBe(false);
    expect(isTrashableSessionPath(`${config}/projects/x/notes.jsonl`, config)).toBe(false);
    expect(isTrashableSessionPath(`relative/${id}.jsonl`, config)).toBe(false);
  });
});

describe('isTrashableMemoryFile', () => {
  it('allows a memory file right inside a memory folder, never the index, a link or anything deeper', () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'trash-memory-')));
    try {
      const memory = join(base, 'memory');
      mkdirSync(join(memory, 'sub'), { recursive: true });
      writeFileSync(join(memory, 'a.md'), 'a');
      writeFileSync(join(memory, 'MEMORY.md'), '- a');
      writeFileSync(join(memory, 'sub', 'b.md'), 'b');
      writeFileSync(join(base, 'outside.md'), 'x');
      symlinkSync(join(base, 'outside.md'), join(memory, 'link.md'));
      expect(isTrashableMemoryFile(join(memory, 'a.md'), memory)).toBe(true);
      expect(isTrashableMemoryFile(join(memory, 'MEMORY.md'), memory)).toBe(false);
      expect(isTrashableMemoryFile(join(memory, 'sub', 'b.md'), memory)).toBe(false);
      expect(isTrashableMemoryFile(join(memory, 'link.md'), memory)).toBe(false);
      expect(isTrashableMemoryFile(join(base, 'outside.md'), base)).toBe(false);
      expect(isTrashableMemoryFile(`${memory}/../outside.md`, memory)).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('isTrashableInstructionFile', () => {
  it('allows only the instruction files a share can make, inside the project', () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'trash-instructions-')));
    try {
      const root = join(base, 'project');
      mkdirSync(join(root, '.claude', 'rules'), { recursive: true });
      mkdirSync(join(base, 'outside'));
      for (const file of ['CLAUDE.md', 'CLAUDE.local.md', '.claude/CLAUDE.md', '.claude/rules/ui.md', 'README.md']) writeFileSync(join(root, file), 'x');
      for (const file of ['CLAUDE.md', 'CLAUDE.local.md', '.claude/CLAUDE.md', '.claude/rules/ui.md']) expect(isTrashableInstructionFile(join(root, file), root)).toBe(true);
      expect(isTrashableInstructionFile(join(root, 'README.md'), root)).toBe(false);
      expect(isTrashableInstructionFile(join(root, '.claude', 'rules', 'missing.md'), root)).toBe(false);
      symlinkSync(join(base, 'outside'), join(root, '.claude', 'rules', 'linked'));
      writeFileSync(join(base, 'outside', 'x.md'), 'x');
      expect(isTrashableInstructionFile(join(root, '.claude', 'rules', 'linked', 'x.md'), root)).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('isConfigDir', () => {
  it('accepts a profile folder with a projects folder, nothing vaguer', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'trash-config-')));
    try {
      expect(isConfigDir(dir)).toBe(false);
      mkdirSync(join(dir, 'projects'));
      expect(isConfigDir(dir)).toBe(true);
      expect(isConfigDir(`${dir}/../${dir.split('/').pop()}`)).toBe(false);
      expect(isConfigDir('/')).toBe(false);
      expect(isConfigDir(42)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('isTrashableRepoFile', () => {
  it('allows files inside a git checkout, never the checkout itself or .git', () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'trash-repo-')));
    try {
      mkdirSync(join(repo, '.git'));
      mkdirSync(join(repo, 'src'));
      writeFileSync(join(repo, 'src', 'new.ts'), '');
      writeFileSync(join(repo, '.git', 'config'), '');
      expect(isTrashableRepoFile(join(repo, 'src', 'new.ts'), repo)).toBe(true);
      expect(isTrashableRepoFile(join(repo, 'src'), repo)).toBe(false);
      expect(isTrashableRepoFile(repo, repo)).toBe(false);
      expect(isTrashableRepoFile(join(repo, '.git', 'config'), repo)).toBe(false);
      expect(isTrashableRepoFile(join(repo, 'src', '..', '..', 'x'), repo)).toBe(false);
      expect(isTrashableRepoFile(join(repo, 'missing.ts'), repo)).toBe(false);
      rmSync(join(repo, '.git'), { recursive: true });
      expect(isTrashableRepoFile(join(repo, 'src', 'new.ts'), repo)).toBe(false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('refuses .git in any case and at any depth, and folders linked from outside', () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'trash-repo-')));
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'trash-outside-')));
    try {
      mkdirSync(join(repo, '.git'));
      writeFileSync(join(repo, '.git', 'config'), '');
      mkdirSync(join(repo, 'vendor', 'x', '.git'), { recursive: true });
      writeFileSync(join(repo, 'vendor', 'x', '.git', 'HEAD'), '');
      writeFileSync(join(outside, 'precious.txt'), '');
      symlinkSync(outside, join(repo, 'link'));
      symlinkSync(join(repo, '.git'), join(repo, 'git-link'));
      writeFileSync(join(repo, '.gitignore'), '');
      expect(isTrashableRepoFile(join(repo, '.GIT', 'config'), repo)).toBe(false);
      expect(isTrashableRepoFile(join(repo, 'vendor', 'x', '.git', 'HEAD'), repo)).toBe(false);
      expect(isTrashableRepoFile(join(repo, 'link', 'precious.txt'), repo)).toBe(false);
      expect(isTrashableRepoFile(join(repo, 'git-link', 'config'), repo)).toBe(false);
      expect(isTrashableRepoFile(join(repo, '.gitignore'), repo)).toBe(true);
      // The link itself is a file in the checkout; trashing it moves the link, not what it points to.
      expect(isTrashableRepoFile(join(repo, 'link'), repo)).toBe(true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuses instead of throwing when a parent is a file', () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'trash-repo-')));
    try {
      mkdirSync(join(repo, '.git'));
      writeFileSync(join(repo, 'file.ts'), '');
      expect(isTrashableRepoFile(join(repo, 'file.ts', 'child'), repo)).toBe(false);
      expect(isConfigDir(join(repo, 'file.ts'))).toBe(false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
