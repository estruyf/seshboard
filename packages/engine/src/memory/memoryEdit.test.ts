import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeProjectPath } from './folders.ts';
import { editMemoryFile } from './frontmatterEdit.ts';
import { MemoryService } from './memoryService.ts';
import { indexSeparator, styledIndexLine, updateIndexLine } from './textEdit.ts';

let base: string;
let root: string;
let memoryDir: string;
let service: MemoryService;
const read = (path: string) => readFileSync(path, 'utf8');
const CLAUDE_FILE = '---\nname: sidebar-order\ndescription: Needs you first\nmetadata:\n  node_type: memory\n  type: feedback\n  originSessionId: 9b9414df\n  modified: 2026-10-04T14:16:33.977Z\n---\n\nNeeds you, then Working.\n';

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-memory-edit-')));
  root = join(base, 'project');
  const configDir = join(base, 'config');
  mkdirSync(root, { recursive: true });
  memoryDir = join(configDir, 'projects', encodeProjectPath(root), 'memory');
  mkdirSync(memoryDir, { recursive: true });
  service = new MemoryService({ profiles: () => [{ id: 'default', configDir }], trash: async (paths) => paths.forEach((p) => rmSync(p)) });
  writeFileSync(join(memoryDir, 'MEMORY.md'), '# Memory\n- [sidebar-order](sidebar-order.md) — Needs you first\n');
  writeFileSync(join(memoryDir, 'sidebar-order.md'), CLAUDE_FILE);
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('editing frontmatter', () => {
  it('changes description and type in place and keeps every other field', () => {
    expect(editMemoryFile(CLAUDE_FILE, { description: 'Needs you: first', type: 'project' }, 'New body.')).toBe(
      '---\nname: sidebar-order\ndescription: "Needs you: first"\nmetadata:\n  node_type: memory\n  type: project\n  originSessionId: 9b9414df\n  modified: 2026-10-04T14:16:33.977Z\n---\n\nNew body.\n',
    );
  });

  it('keeps a top-level type there, adds a missing one under metadata, and replaces a folded description', () => {
    expect(editMemoryFile('---\nname: a\ntype: user\n---\nx\n', { type: 'feedback' })).toBe('---\nname: a\ntype: feedback\n---\n\nx\n');
    expect(editMemoryFile('---\nname: a\nextra: 1\n---\nx\n', { type: 'user' })).toBe('---\nname: a\nextra: 1\nmetadata:\n  type: user\n---\n\nx\n');
    expect(editMemoryFile('---\nname: a\ndescription: >\n  long\n  text\nmetadata:\n  type: user\n---\nx\n', { description: 'short' })).toBe('---\nname: a\ndescription: short\nmetadata:\n  type: user\n---\n\nx\n');
    expect(editMemoryFile('No frontmatter.\n', { name: 'b', description: 'd', type: 'user' })).toBe('---\nname: b\ndescription: d\nmetadata:\n  type: user\n---\n\nNo frontmatter.\n');
  });

  it('keeps CRLF line endings', () => {
    expect(editMemoryFile('---\r\nname: a\r\n---\r\n\r\nx\r\n', { description: 'd' }, 'y\nz')).toBe('---\r\nname: a\r\ndescription: d\r\n---\r\n\r\ny\r\nz\r\n');
  });
});

describe('index lines', () => {
  it('writes new lines in the style of the existing ones', () => {
    expect(indexSeparator('- [a](a.md): one\n')).toBe(': ');
    expect(indexSeparator('')).toBe(' — ');
    expect(styledIndexLine('- [a](a.md) - one\n', 'b', 'b.md', 'two')).toBe('- [b](b.md) - two');
  });

  it('updates only the line for one file', () => {
    const index = '# M\n- [Sidebar](sidebar.md) — old\n- [other](other.md) — keep\n';
    expect(updateIndexLine(index, 'sidebar.md', { hook: 'new' })).toBe('# M\n- [Sidebar](sidebar.md) — new\n- [other](other.md) — keep\n');
    expect(updateIndexLine(index, 'other.md', { file: 'renamed.md' })).toBe('# M\n- [Sidebar](sidebar.md) — old\n- [renamed](renamed.md) — keep\n');
    expect(updateIndexLine(index, 'missing.md', { hook: 'x' })).toBeNull();
  });
});

describe('memory files', () => {
  it('creates a memory in Claude Code’s format with an index line, and refuses a name that’s taken', () => {
    const { path } = service.create({ root, name: 'release-process', type: 'reference', description: 'npm run release, then CHANGELOG', body: 'Steps.' });
    expect(read(path)).toBe('---\nname: release-process\ndescription: npm run release, then CHANGELOG\nmetadata:\n  type: reference\n---\n\nSteps.\n');
    expect(read(join(memoryDir, 'MEMORY.md'))).toBe('# Memory\n- [sidebar-order](sidebar-order.md) — Needs you first\n- [release-process](release-process.md) — npm run release, then CHANGELOG\n');
    expect(() => service.create({ root, name: 'sidebar-order', type: 'project', description: '', body: '' })).toThrow(/already/);
    expect(() => service.create({ root, name: 'MEMORY', type: 'project', description: '', body: '' })).toThrow(/name/);
  });

  it.runIf(process.platform !== 'win32')('never writes through a MEMORY.md that is a link (a shared folder could point it anywhere)', () => {
    const outside = join(base, 'outside.txt');
    writeFileSync(outside, 'keep\n');
    rmSync(join(memoryDir, 'MEMORY.md'));
    symlinkSync(outside, join(memoryDir, 'MEMORY.md'));
    expect(() => service.create({ root, name: 'linked', type: 'project', description: 'd', body: 'b' })).toThrow(/is a link/);
    expect(existsSync(join(memoryDir, 'linked.md'))).toBe(false);
    expect(() => service.fixIndex(root, join(memoryDir, 'MEMORY.md'))).toThrow(/is a link/);
    expect(read(outside)).toBe('keep\n');
    expect(() => service.create({ root, name: '../x', type: 'project', description: '', body: '' })).toThrow(/name/);
  });

  it('writes where a remembered memory came from under metadata', () => {
    const { path } = service.create({ root, name: 'archived-dock', type: 'project', description: 'Archived is a footer', body: 'Text.', metadata: { originSessionId: 's-1', source: 'switchboard' } });
    expect(read(path)).toBe('---\nname: archived-dock\ndescription: Archived is a footer\nmetadata:\n  type: project\n  originSessionId: s-1\n  source: switchboard\n---\n\nText.\n');
  });

  it('saves edits keeping unknown fields, updates the index hook, and refuses a file that changed on disk', () => {
    const path = join(memoryDir, 'sidebar-order.md');
    const listed = service.list(root);
    return listed.then(({ memories }) => {
      const memory = memories[0]!;
      expect(memory.originSessionId).toBe('9b9414df');
      expect(memory.profileId).toBe('default');
      service.write({ root, path, description: 'Needs you, then working', type: 'feedback', body: 'Body two.', expectedModified: memory.modified, force: false });
      expect(read(path)).toContain('  node_type: memory\n  type: feedback\n  originSessionId: 9b9414df\n');
      expect(read(path)).toContain('\n\nBody two.\n');
      expect(read(join(memoryDir, 'MEMORY.md'))).toBe('# Memory\n- [sidebar-order](sidebar-order.md) — Needs you, then working\n');
      expect(() => service.write({ root, path, description: 'x', type: 'feedback', body: '', expectedModified: 1, force: false })).toThrow(/changed on disk/);
      service.write({ root, path, description: 'x', type: 'feedback', body: '', expectedModified: 1, force: true });
    });
  });

  it('renames the file, its name and its index line', () => {
    const { path } = service.rename({ root, path: join(memoryDir, 'sidebar-order.md'), name: 'sidebar-groups' });
    expect(path).toBe(join(memoryDir, 'sidebar-groups.md'));
    expect(existsSync(join(memoryDir, 'sidebar-order.md'))).toBe(false);
    expect(read(path)).toContain('name: sidebar-groups\n');
    expect(read(path)).toContain('originSessionId: 9b9414df');
    expect(read(join(memoryDir, 'MEMORY.md'))).toBe('# Memory\n- [sidebar-groups](sidebar-groups.md) — Needs you first\n');
    service.create({ root, name: 'taken', type: 'user', description: '', body: '' });
    expect(() => service.rename({ root, path, name: 'taken' })).toThrow(/already/);
  });

  it('deletes to the Trash with the index line, and restores both', async () => {
    const path = join(memoryDir, 'sidebar-order.md');
    const { undoToken } = await service.remove({ root, path });
    expect(existsSync(path)).toBe(false);
    expect(read(join(memoryDir, 'MEMORY.md'))).toBe('# Memory\n');
    service.restore(undoToken);
    expect(read(path)).toBe(CLAUDE_FILE);
    expect(read(join(memoryDir, 'MEMORY.md'))).toBe('# Memory\n- [sidebar-order](sidebar-order.md) — Needs you first\n');
    expect(() => service.restore(undoToken)).toThrow(/undone/);
  });

  it('only touches memory files in the project’s folders', async () => {
    writeFileSync(join(base, 'outside.md'), 'x');
    expect(() => service.write({ root, path: join(base, 'outside.md'), description: '', type: 'user', body: '', expectedModified: null, force: false })).toThrow(/memory/);
    expect(() => service.rename({ root, path: join(memoryDir, 'MEMORY.md'), name: 'x' })).toThrow(/memory/);
    await expect(service.remove({ root: null, path: join(memoryDir, 'sidebar-order.md') })).rejects.toThrow(/memory/);
  });
});
