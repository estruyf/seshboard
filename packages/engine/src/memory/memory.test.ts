import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ShareTarget } from '@switchboard/protocol';
import { git } from '../git/gitChanges.ts';
import { canSymlink } from '../util/canSymlink.ts';
import { autoMemoryDirectory, encodeProjectPath, memoryDirFor } from './folders.ts';
import { MemoryService, type MemoryTrashScope } from './memoryService.ts';
import { findSecrets } from './secrets.ts';
import { placeSection, removeIndexLine, restoreIndexLine, unifiedDiff } from './textEdit.ts';

let base: string;
let root: string;
let configDir: string;
let memoryDir: string;
let trashed: Array<{ paths: string[]; scope: MemoryTrashScope }>;
let service: MemoryService;

const write = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
const read = (path: string) => readFileSync(path, 'utf8');
const run = (...args: string[]) => git(root, args);
const memoryFile = (name: string, body: string, type = 'project') => {
  const path = join(memoryDir, `${name}.md`);
  write(path, `---\nname: ${name}\ndescription: About ${name}\nmetadata:\n  type: ${type}\n  originSessionId: abc\n---\n\n${body}\n`);
  return path;
};
const INDEX = '# Memory\n- [Sidebar order](sidebar-order.md) — Needs you first\n- [Design system](design-system.md) — Tokens\n';
const share = (memoryPath: string, target: ShareTarget, options: { heading?: string; placement?: 'add' | 'replace'; removeMemory?: boolean; secretsChecked?: boolean } = {}) =>
  service.share({ root, memoryPath, target, heading: options.heading ?? 'Sidebar Order', placement: options.placement ?? 'add', removeMemory: options.removeMemory ?? false, secretsChecked: options.secretsChecked ?? false });
const preview = (memoryPath: string, target: ShareTarget, heading = 'Sidebar Order', placement: 'add' | 'replace' = 'add') => service.sharePreview({ root, memoryPath, target, heading, placement });

beforeEach(async () => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-memory-')));
  root = join(base, 'project');
  configDir = join(base, 'config');
  mkdirSync(root, { recursive: true });
  memoryDir = join(configDir, 'projects', encodeProjectPath(root), 'memory');
  mkdirSync(memoryDir, { recursive: true });
  await run('init', '-q', '-b', 'main');
  await run('config', 'user.email', 'test@example.com');
  await run('config', 'user.name', 'Test');
  write(join(root, 'README.md'), 'hello\n');
  await run('add', '.');
  await run('commit', '-qm', 'initial');
  trashed = [];
  service = new MemoryService({
    profiles: () => [{ id: 'default', configDir }],
    trash: async (paths, scope) => {
      trashed.push({ paths, scope });
      for (const p of paths) rmSync(p);
    },
  });
  write(join(memoryDir, 'MEMORY.md'), INDEX);
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

/** Nothing is ever staged by a share. */
const staged = async () => (await run('diff', '--cached', '--name-only')).trim();

describe('memory folders', () => {
  it('finds the memory folder under the encoded project path, or autoMemoryDirectory', () => {
    expect(memoryDirFor(configDir, root)).toBe(memoryDir);
    write(join(configDir, 'settings.json'), JSON.stringify({ autoMemoryDirectory: '~/notes/memory' }));
    expect(autoMemoryDirectory(configDir, root, '/home/me')).toBe('/home/me/notes/memory');
    write(join(root, '.claude', 'settings.local.json'), JSON.stringify({ autoMemoryDirectory: '/elsewhere' }));
    expect(autoMemoryDirectory(configDir, root, '/home/me')).toBe('/elsewhere');
    // The committed project settings can't move it.
    rmSync(join(root, '.claude', 'settings.local.json'));
    rmSync(join(configDir, 'settings.json'));
    write(join(root, '.claude', 'settings.json'), JSON.stringify({ autoMemoryDirectory: '/attacker' }));
    expect(memoryDirFor(configDir, root)).toBe(memoryDir);
  });

  it('shares one memory folder between a repository and its worktrees', () => {
    const worktree = join(root, '.claude', 'worktrees', 'wt');
    const shared = new MemoryService({ profiles: () => [{ id: 'default', configDir }], repoRoot: () => root, trash: async () => {} });
    expect(shared.dirs(worktree)).toEqual([memoryDir]);
  });

  it('lists memories with their frontmatter and the instruction files with paths and sharing', async () => {
    memoryFile('sidebar-order', 'Needs you first.');
    write(join(memoryDir, 'loose.md'), 'No frontmatter here.\n');
    write(join(root, 'CLAUDE.md'), '# Project\n');
    write(join(root, 'CLAUDE.local.md'), 'mine\n');
    write(join(root, '.claude', 'rules', 'ui.md'), '---\npaths:\n  - "apps/ui/**"\n---\n\nUse tokens.\n');
    const list = await service.list(root);
    expect(list.memoryDir).toBe(memoryDir);
    expect(list.indexLines).toBe(3);
    expect(list.memories.map((m) => [m.name, m.type, m.description]).sort()).toEqual([
      ['loose', null, null],
      ['sidebar-order', 'project', 'About sidebar-order'],
    ]);
    expect(list.instructions.map((i) => [i.path.slice(root.length + 1).split(sep).join('/'), i.kind, i.shared, i.paths])).toEqual([
      ['CLAUDE.md', 'claude-md', true, undefined],
      ['CLAUDE.local.md', 'local', false, undefined],
      ['.claude/rules/ui.md', 'rule', true, ['apps/ui/**']],
    ]);
  });

  it('reads only inside the project and its memory folder', () => {
    const path = memoryFile('sidebar-order', 'x');
    expect(service.read(root, path)).toContain('name: sidebar-order');
    write(join(base, 'outside.md'), 'secret');
    expect(() => service.read(root, join(base, 'outside.md'))).toThrow(/Only memory/);
    // Making links on Windows needs Developer Mode or an administrator.
    if (canSymlink()) {
      symlinkSync(join(base, 'outside.md'), join(root, 'link.md'));
      expect(() => service.read(root, join(root, 'link.md'))).toThrow(/Only memory/);
    }
  });
});

describe('sharing a memory', () => {
  it('creates a root CLAUDE.md, flattening links, and undoes it', async () => {
    const path = memoryFile('sidebar-order', 'Needs you first. See [[design-system]] for colours.');
    const p = await preview(path, { kind: 'claude-md' });
    expect(p.exists).toBe(false);
    expect(p.after).toBe('## Sidebar Order\n\nNeeds you first. See design-system for colours.\n');
    expect(p.diff).toContain('--- /dev/null');
    expect(p.diff).toContain('+## Sidebar Order');
    const result = await share(path, { kind: 'claude-md' });
    expect(result.targetPath).toBe(join(root, 'CLAUDE.md'));
    expect(read(result.targetPath)).toBe(p.after);
    expect(await staged()).toBe('');
    await service.undoShare(result.undoToken);
    expect(existsSync(result.targetPath)).toBe(false);
    expect(trashed.at(-1)).toEqual({ paths: [result.targetPath], scope: { instructionsRoot: root } });
  });

  it('appends to an existing CLAUDE.md with exactly one blank line, and undo restores it', async () => {
    write(join(root, 'CLAUDE.md'), '# Project\n\nIntro.\n\n\n\n');
    const path = memoryFile('sidebar-order', 'Needs you first.');
    const result = await share(path, { kind: 'claude-md' });
    expect(read(result.targetPath)).toBe('# Project\n\nIntro.\n\n## Sidebar Order\n\nNeeds you first.\n');
    await service.undoShare(result.undoToken);
    expect(read(result.targetPath)).toBe('# Project\n\nIntro.\n\n\n\n');
  });

  it('uses .claude/CLAUDE.md when the root has none', async () => {
    write(join(root, '.claude', 'CLAUDE.md'), '# Here\n');
    const path = memoryFile('sidebar-order', 'Body.');
    const result = await share(path, { kind: 'claude-md' });
    expect(result.targetPath).toBe(join(root, '.claude', 'CLAUDE.md'));
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(false);
    await service.undoShare(result.undoToken);
    expect(read(result.targetPath)).toBe('# Here\n');
  });

  it('writes a new rule with paths frontmatter, and adds to an existing rule', async () => {
    const path = memoryFile('sidebar-order', 'Body.');
    const created = await share(path, { kind: 'rule', file: 'ui', paths: ['apps/ui/**'] });
    expect(created.targetPath).toBe(join(root, '.claude', 'rules', 'ui.md'));
    expect(read(created.targetPath)).toBe('---\npaths:\n  - "apps/ui/**"\n---\n\n## Sidebar Order\n\nBody.\n');
    await service.undoShare(created.undoToken);
    expect(existsSync(created.targetPath)).toBe(false);

    write(join(root, '.claude', 'rules', 'ui.md'), '---\npaths: apps/**\n---\n\nRule.\n');
    const added = await share(path, { kind: 'rule', file: 'ui.md', paths: ['ignored/**'] });
    expect(read(added.targetPath)).toBe('---\npaths: apps/**\n---\n\nRule.\n\n## Sidebar Order\n\nBody.\n');
    await service.undoShare(added.undoToken);
    expect(read(added.targetPath)).toBe('---\npaths: apps/**\n---\n\nRule.\n');
    await expect(preview(path, { kind: 'rule', file: '../escape' })).rejects.toThrow(/rule/);
  });

  it('warns when CLAUDE.local.md is not ignored, and adds it to .gitignore on request', async () => {
    const path = memoryFile('sidebar-order', 'Mine.');
    expect((await preview(path, { kind: 'local' })).warnings.map((w) => w.kind)).toEqual(['localNotIgnored']);
    service.ignoreLocal(root);
    expect(read(join(root, '.gitignore'))).toBe('CLAUDE.local.md\n');
    expect((await preview(path, { kind: 'local' })).warnings).toEqual([]);
    const result = await share(path, { kind: 'local' });
    expect(read(join(root, 'CLAUDE.local.md'))).toBe('## Sidebar Order\n\nMine.\n');
    await service.undoShare(result.undoToken);
    expect(existsSync(join(root, 'CLAUDE.local.md'))).toBe(false);
    expect(await staged()).toBe('');
  });

  it('replaces a section with the same heading, or adds a new one', async () => {
    const claude = '# P\n\n## Sidebar order\n\nOld text.\n\n### Detail\n\nOld detail.\n\n## Other\n\nKeep.\n';
    write(join(root, 'CLAUDE.md'), claude);
    const path = memoryFile('sidebar-order', 'New text.');
    const added = await preview(path, { kind: 'claude-md' });
    // A CLAUDE.md that isn't committed yet is an uncommitted change too.
    expect(added.warnings.map((w) => w.kind)).toEqual(['sameHeading', 'targetDirty']);
    expect(added.after).toBe(`${claude}\n## Sidebar Order\n\nNew text.\n`);
    const replaced = await preview(path, { kind: 'claude-md' }, 'Sidebar Order', 'replace');
    expect(replaced.after).toBe('# P\n\n## Sidebar Order\n\nNew text.\n\n## Other\n\nKeep.\n');
    expect(replaced.diff).toContain('-Old detail.');
    const result = await share(path, { kind: 'claude-md' }, { placement: 'replace' });
    expect(read(result.targetPath)).toBe(replaced.after);
  });

  it('refuses text that is already there', async () => {
    write(join(root, 'CLAUDE.md'), '# P\n\nNeeds you first.\nThen working.\n');
    const path = memoryFile('sidebar-order', 'Needs you first.\nThen working.');
    expect((await preview(path, { kind: 'claude-md' })).warnings.map((w) => w.kind)).toEqual(['alreadyThere', 'targetDirty']);
    await expect(share(path, { kind: 'claude-md' })).rejects.toThrow(/already/);
  });

  it('keeps CRLF line endings', async () => {
    write(join(root, 'CLAUDE.md'), '# P\r\n\r\nIntro.\r\n');
    const path = memoryFile('sidebar-order', 'One.\nTwo.');
    const result = await share(path, { kind: 'claude-md' });
    expect(read(result.targetPath)).toBe('# P\r\n\r\nIntro.\r\n\r\n## Sidebar Order\r\n\r\nOne.\r\nTwo.\r\n');
  });

  it('moves the memory to the Trash and takes out only its MEMORY.md line, and undo puts both back', async () => {
    const path = memoryFile('sidebar-order', 'Body.');
    const original = read(path);
    const result = await share(path, { kind: 'claude-md' }, { removeMemory: true });
    expect(result.removed).toBe(true);
    expect(existsSync(path)).toBe(false);
    expect(trashed).toEqual([{ paths: [path], scope: { memoryDir } }]);
    expect(read(join(memoryDir, 'MEMORY.md'))).toBe('# Memory\n- [Design system](design-system.md) — Tokens\n');
    await service.undoShare(result.undoToken);
    expect(read(path)).toBe(original);
    expect(read(join(memoryDir, 'MEMORY.md'))).toBe(INDEX);
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(false);
    // Only the last share, once.
    await expect(service.undoShare(result.undoToken)).rejects.toThrow(/last share/);
  });

  it('flags uncommitted changes in the target', async () => {
    write(join(root, 'CLAUDE.md'), '# P\n');
    await run('add', 'CLAUDE.md');
    await run('commit', '-qm', 'claude');
    const path = memoryFile('sidebar-order', 'Body.');
    expect((await preview(path, { kind: 'claude-md' })).warnings).toEqual([]);
    write(join(root, 'CLAUDE.md'), '# P\n\nEdited.\n');
    expect((await preview(path, { kind: 'claude-md' })).warnings).toEqual([{ kind: 'targetDirty', detail: 'CLAUDE.md' }]);
  });

  it('flags secrets and refuses until they are checked', async () => {
    const path = memoryFile('deploy', 'The token is ghp_abcdefghijklmnopqrstuvwxyz0123456789AB.');
    const p = await preview(path, { kind: 'claude-md' }, 'Deploy');
    expect(p.warnings).toEqual([{ kind: 'secrets', detail: 'a GitHub token' }]);
    await expect(share(path, { kind: 'claude-md' }, { heading: 'Deploy' })).rejects.toThrow(/secret/);
    await share(path, { kind: 'claude-md' }, { heading: 'Deploy', secretsChecked: true });
    expect(read(join(root, 'CLAUDE.md'))).toContain('ghp_');
  });

  it('refuses memories outside the folder and targets behind a symlink', async () => {
    write(join(base, 'elsewhere', 'x.md'), 'x');
    await expect(preview(join(base, 'elsewhere', 'x.md'), { kind: 'claude-md' })).rejects.toThrow(/memories/);
    await expect(preview(join(memoryDir, 'MEMORY.md'), { kind: 'claude-md' })).rejects.toThrow(/memories/);
    const path = memoryFile('sidebar-order', 'Body.');
    // Making links on Windows needs Developer Mode or an administrator.
    if (!canSymlink()) return;
    mkdirSync(join(base, 'outside'));
    symlinkSync(join(base, 'outside'), join(root, '.claude'));
    await expect(preview(path, { kind: 'rule', file: 'ui' })).rejects.toThrow(/outside the project/);
    rmSync(join(root, '.claude'));
    write(join(base, 'target.md'), 'outside\n');
    symlinkSync(join(base, 'target.md'), join(root, 'CLAUDE.md'));
    await expect(share(path, { kind: 'claude-md' })).rejects.toThrow(/link/);
    expect(read(join(base, 'target.md'))).toBe('outside\n');
  });

  it("doesn't undo over later edits", async () => {
    const path = memoryFile('sidebar-order', 'Body.');
    const result = await share(path, { kind: 'claude-md' });
    write(result.targetPath, 'changed by hand\n');
    await expect(service.undoShare(result.undoToken)).rejects.toThrow(/changed since/);
    expect(read(result.targetPath)).toBe('changed by hand\n');
  });
});

describe('copying a section to memory', () => {
  beforeEach(() => {
    write(join(root, 'CLAUDE.md'), '# P\n\n## Design system\n\nTokens live in styles.css. Use components/ui.\n\n### Colours\n\nOnly tokens.\n\n## Other\n\nNo.\n');
  });

  it('writes the memory in Claude Code’s format and adds its index line, leaving CLAUDE.md alone', async () => {
    const before = read(join(root, 'CLAUDE.md'));
    const copy = await service.createFromSection({ root, file: join(root, 'CLAUDE.md'), heading: 'Design system', name: 'design-system', type: 'project', description: 'Tokens live in styles.css.', dryRun: false });
    expect(copy.path).toBe(join(memoryDir, 'design-system.md'));
    expect(read(copy.path)).toBe('---\nname: design-system\ndescription: Tokens live in styles.css.\nmetadata:\n  type: project\n---\n\nTokens live in styles.css. Use components/ui.\n\n### Colours\n\nOnly tokens.\n');
    expect(copy.indexLine).toBe('- [Design system](design-system.md) — Tokens live in styles.css.');
    expect(read(join(memoryDir, 'MEMORY.md'))).toBe(`${INDEX}${copy.indexLine}\n`);
    expect(copy.indexLines).toBe(4);
    expect(read(join(root, 'CLAUDE.md'))).toBe(before);
    expect(await staged()).toBe('');
  });

  it('picks another name when it is taken, and a dry run writes nothing', async () => {
    write(join(memoryDir, 'design-system.md'), 'existing\n');
    const copy = await service.createFromSection({ root, file: join(root, 'CLAUDE.md'), heading: 'Colours', name: 'design-system', type: 'project', description: 'Only tokens.', dryRun: true });
    expect(copy.name).toBe('design-system-2');
    expect(existsSync(copy.path)).toBe(false);
    expect(read(join(memoryDir, 'MEMORY.md'))).toBe(INDEX);
  });

  it('counts the index past the limit', async () => {
    write(join(memoryDir, 'MEMORY.md'), Array.from({ length: 200 }, (_, i) => `- line ${i}`).join('\n') + '\n');
    const copy = await service.createFromSection({ root, file: join(root, 'CLAUDE.md'), heading: 'Other', name: 'other', type: 'project', description: 'No.', dryRun: true });
    expect(copy.indexLines).toBe(201);
  });

  it('only copies from the project’s instruction files', async () => {
    write(join(root, 'notes.md'), '## Design system\n\nx\n');
    await expect(service.createFromSection({ root, file: join(root, 'notes.md'), heading: 'Design system', name: 'x', type: 'project', description: '', dryRun: true })).rejects.toThrow(/instructions/);
    await expect(service.createFromSection({ root, file: join(root, 'CLAUDE.md'), heading: 'Missing', name: 'x', type: 'project', description: '', dryRun: true })).rejects.toThrow(/no section/);
  });
});

describe('text edits', () => {
  it('diffs a change at the end with context and the no-newline marker', () => {
    expect(unifiedDiff('a\nb\nc\nd\ne', 'a\nb\nc\nd\ne\n\n## X\n', 'CLAUDE.md', false)).toBe(
      '--- a/CLAUDE.md\n+++ b/CLAUDE.md\n@@ -2,4 +2,6 @@\n b\n c\n d\n-e\n\\ No newline at end of file\n+e\n+\n+## X\n',
    );
  });

  it('keeps the rest of MEMORY.md byte for byte when a line goes and comes back', () => {
    const index = 'a\r\n- [X](x.md) — y\r\nb';
    const removed = removeIndexLine(index, 'x.md')!;
    expect(removed.text).toBe('a\r\nb');
    expect(restoreIndexLine(removed.text, removed.line, removed.at)).toBe(index);
    const last = removeIndexLine('a\n- [X](x.md)', 'x.md')!;
    expect(restoreIndexLine(last.text, last.line, last.at)).toBe('a\n- [X](x.md)');
  });

  it('adds after headings inside code fences, not in them', () => {
    expect(placeSection('```\n## Same\n```\n', 'Same', 'Body.', 'replace').after).toBe('```\n## Same\n```\n\n## Same\n\nBody.\n');
  });

  it('finds secrets but not ordinary prose', () => {
    expect(findSecrets('Use npm run check before a commit.')).toEqual([]);
    expect(findSecrets('password: hunter2hunter')).toEqual(['a password or token']);
    expect(findSecrets('key sk-ant-api03-abcdefghijklmnopqrstuvwxyz')).toContain('an Anthropic API key');
    expect(findSecrets('-----BEGIN OPENSSH PRIVATE KEY-----')).toEqual(['a private key']);
  });
});
