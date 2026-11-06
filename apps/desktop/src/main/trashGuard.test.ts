import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { isConfigDir, isTrashableCodexSession, isTrashableCopilotSession, isTrashableInstructionFile, isTrashableMemoryFile, isTrashableRepoFile, isTrashableSessionPath } from './trashGuard.ts';

// In this platform's form (C:Usersme.claude on Windows): the guard only takes normalised absolute paths.
const config = resolve('/Users/me/.claude');
const path = (...parts: string[]) => [config, ...parts].join(sep);
const id = '11111111-2222-4333-8444-555555555555';

function canSymlink(): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'trash-symlink-'));
  try {
    symlinkSync(dir, join(dir, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('isTrashableCopilotSession', () => {
  it("allows a session's folder in Copilot's session-state, and nothing else", () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'trash-copilot-')));
    try {
      const sessions = join(home, 'session-state');
      mkdirSync(join(sessions, id), { recursive: true });
      writeFileSync(join(sessions, id, 'events.jsonl'), '');
      expect(isTrashableCopilotSession(join(sessions, id), home)).toBe(true);
      // Not the folder itself, a file in a session, another folder name, or a session that isn't there.
      expect(isTrashableCopilotSession(sessions, home)).toBe(false);
      expect(isTrashableCopilotSession(join(sessions, id, 'events.jsonl'), home)).toBe(false);
      mkdirSync(join(sessions, 'settings'));
      expect(isTrashableCopilotSession(join(sessions, 'settings'), home)).toBe(false);
      expect(isTrashableCopilotSession(join(sessions, '22222222-2222-4333-8444-555555555555'), home)).toBe(false);
      // Not one in another folder, or a path that isn't normalised.
      mkdirSync(join(home, 'other', id), { recursive: true });
      expect(isTrashableCopilotSession(join(home, 'other', id), home)).toBe(false);
      expect(isTrashableCopilotSession(`${sessions}${sep}..${sep}session-state${sep}${id}`, home)).toBe(false);
      if (canSymlink()) {
        // A link named like a session goes to whatever it points at: refused.
        const link = '33333333-2222-4333-8444-555555555555';
        symlinkSync(join(home, 'other'), join(sessions, link));
        expect(isTrashableCopilotSession(join(sessions, link), home)).toBe(false);
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('isTrashableCodexSession', () => {
  it("allows a thread's rollout file in a day's folder or the archive, and nothing else", () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'trash-codex-')));
    try {
      const day = join(home, 'sessions', '2026', '11', '06');
      const archive = join(home, 'archived_sessions');
      mkdirSync(day, { recursive: true });
      mkdirSync(archive);
      const rollout = `rollout-2026-11-06T10-00-00-${id}.jsonl`;
      for (const name of [rollout, `${rollout}.zst`, 'notes.jsonl', `${rollout}.bak`]) writeFileSync(join(day, name), '');
      writeFileSync(join(archive, rollout), '');
      expect(isTrashableCodexSession(join(day, rollout), home)).toBe(true);
      expect(isTrashableCodexSession(join(day, `${rollout}.zst`), home)).toBe(true);
      expect(isTrashableCodexSession(join(archive, rollout), home)).toBe(true);
      // Not another file, a folder, one that isn't there, or a rollout outside the day folders and the archive.
      expect(isTrashableCodexSession(join(day, 'notes.jsonl'), home)).toBe(false);
      expect(isTrashableCodexSession(join(day, `${rollout}.bak`), home)).toBe(false);
      expect(isTrashableCodexSession(day, home)).toBe(false);
      expect(isTrashableCodexSession(join(day, `rollout-2026-11-06T10-00-00-22222222-2222-4333-8444-555555555555.jsonl`), home)).toBe(false);
      mkdirSync(join(day, `rollout-2026-11-06T11-00-00-${id}.jsonl`));
      expect(isTrashableCodexSession(join(day, `rollout-2026-11-06T11-00-00-${id}.jsonl`), home)).toBe(false);
      for (const folder of [join(home, 'sessions'), join(home, 'sessions', '2026', '11'), join(home, 'other', '2026', '11', '06'), home]) {
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, rollout), '');
        expect(isTrashableCodexSession(join(folder, rollout), home)).toBe(false);
      }
      // Not a path that isn't normalised, or a relative one.
      expect(isTrashableCodexSession(`${day}${sep}..${sep}06${sep}${rollout}`, home)).toBe(false);
      expect(isTrashableCodexSession(join('sessions', '2026', '11', '06', rollout), home)).toBe(false);
      if (canSymlink()) {
        // A link named like a rollout, or a day folder that is a link to elsewhere: refused.
        const outside = join(home, 'elsewhere');
        mkdirSync(outside);
        writeFileSync(join(outside, rollout), '');
        const linked = `rollout-2026-11-06T12-00-00-${id}.jsonl`;
        symlinkSync(join(outside, rollout), join(day, linked));
        expect(isTrashableCodexSession(join(day, linked), home)).toBe(false);
        symlinkSync(outside, join(home, 'sessions', '2026', '11', '07'));
        expect(isTrashableCodexSession(join(home, 'sessions', '2026', '11', '07', rollout), home)).toBe(false);
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('isTrashableSessionPath', () => {
  it('allows a transcript and its subagent folder inside the projects folder', () => {
    expect(isTrashableSessionPath(path('projects', '-Users-me-app', `${id}.jsonl`), config)).toBe(true);
    expect(isTrashableSessionPath(path('projects', '-Users-me-app', id), config)).toBe(true);
  });

  it('refuses anything else', () => {
    expect(isTrashableSessionPath(path('projects', '-Users-me-app'), config)).toBe(false);
    expect(isTrashableSessionPath(path('settings.json'), config)).toBe(false);
    expect(isTrashableSessionPath(join(resolve('/Users/me/app'), `${id}.jsonl`), config)).toBe(false);
    expect(isTrashableSessionPath(path('projects', '..', '..', `${id}.jsonl`), config)).toBe(false);
    expect(isTrashableSessionPath(path('projects', 'x', 'notes.jsonl'), config)).toBe(false);
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
      expect(isTrashableMemoryFile(join(memory, 'a.md'), memory)).toBe(true);
      expect(isTrashableMemoryFile(join(memory, 'MEMORY.md'), memory)).toBe(false);
      // The same file on a disk that ignores case (Windows, and macOS by default).
      expect(isTrashableMemoryFile(join(memory, 'memory.md'), memory)).toBe(false);
      expect(isTrashableMemoryFile(join(memory, 'sub', 'b.md'), memory)).toBe(false);
      // Making links on Windows needs Developer Mode or an administrator.
      if (canSymlink()) {
        symlinkSync(join(base, 'outside.md'), join(memory, 'link.md'));
        expect(isTrashableMemoryFile(join(memory, 'link.md'), memory)).toBe(false);
      }
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
      if (canSymlink()) {
        symlinkSync(join(base, 'outside'), join(root, '.claude', 'rules', 'linked'));
        writeFileSync(join(base, 'outside', 'x.md'), 'x');
        expect(isTrashableInstructionFile(join(root, '.claude', 'rules', 'linked', 'x.md'), root)).toBe(false);
      }
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
      expect(isConfigDir(`${dir}${sep}..${sep}${basename(dir)}`)).toBe(false);
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

  it.skipIf(process.platform !== 'win32')("refuses .git by its 8.3 short name or an NTFS stream's name", () => {
    const repo = realpathSync.native(mkdtempSync(join(tmpdir(), 'trash-repo-')));
    try {
      mkdirSync(join(repo, '.git'));
      writeFileSync(join(repo, '.git', 'config'), '');
      expect(isTrashableRepoFile(join(repo, '.git::$INDEX_ALLOCATION', 'config'), repo)).toBe(false);
      expect(isTrashableRepoFile(join(repo, 'a:b.txt'), repo)).toBe(false);
      // The short name Windows gave the folder (`GIT~1`), when the drive makes them.
      // Verbatim, as Node would otherwise escape the quotes cmd.exe needs.
      const short = spawnSync('cmd.exe', ['/d', '/s', '/c', `"for %I in ("${join(repo, '.git')}") do @echo %~sI"`], { encoding: 'utf8', windowsVerbatimArguments: true }).stdout.trim();
      expect(short.toLowerCase().startsWith(repo.toLowerCase().slice(0, 2))).toBe(true);
      if (basename(short).toLowerCase() !== '.git') expect(isTrashableRepoFile(join(repo, basename(short), 'config'), repo)).toBe(false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  // Making links on Windows needs Developer Mode or an administrator.
  it.skipIf(!canSymlink())('refuses .git in any case and at any depth, and folders linked from outside', () => {
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
