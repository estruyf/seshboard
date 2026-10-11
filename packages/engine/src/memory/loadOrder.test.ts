import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importsOf, loadOrder, memoryIndexCut } from './loadOrder.ts';

let base: string;
let configDir: string;
let root: string;
let memoryDir: string;
const write = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
const order = () => loadOrder({ configDir, root, memoryDir, home: base }).map((e) => [e.path.slice(base.length + 1), e.kind, e.when]);

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-load-')));
  configDir = join(base, 'config');
  root = join(base, 'project');
  memoryDir = join(configDir, 'projects', 'x', 'memory');
  mkdirSync(root, { recursive: true });
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('load order', () => {
  it('lists what loads at launch in Claude Code’s order, with on-demand rules last', () => {
    write(join(configDir, 'CLAUDE.md'), '# Me\n@~/notes/me.md\nMail me@example.com.\n`@not/this.md`\n');
    write(join(base, 'notes', 'me.md'), 'About me.\n');
    write(join(configDir, 'rules', 'b.md'), 'B\n');
    write(join(configDir, 'rules', 'a.md'), 'A\n');
    write(join(root, 'CLAUDE.md'), 'See @docs/guide.md and @missing.md.\n');
    write(join(root, 'docs', 'guide.md'), 'Guide.\n');
    write(join(root, '.claude', 'CLAUDE.md'), 'Not loaded when the root has one.\n');
    write(join(root, 'CLAUDE.local.md'), 'Mine.\n');
    write(join(root, '.claude', 'rules', 'always.md'), 'Always.\n');
    write(join(root, '.claude', 'rules', 'ui.md'), '---\npaths:\n  - "apps/ui/**"\n---\nUI.\n');
    write(join(memoryDir, 'MEMORY.md'), '- [a](a.md) — x\n');
    expect(order()).toEqual([
      ['config/CLAUDE.md', 'user', 'launch'],
      ['notes/me.md', 'import', 'launch'],
      ['config/rules/a.md', 'user-rule', 'launch'],
      ['config/rules/b.md', 'user-rule', 'launch'],
      ['project/CLAUDE.md', 'project', 'launch'],
      ['project/docs/guide.md', 'import', 'launch'],
      ['project/CLAUDE.local.md', 'local', 'launch'],
      ['project/.claude/rules/always.md', 'rule', 'launch'],
      ['config/projects/x/memory/MEMORY.md', 'memory', 'launch'],
      ['project/.claude/rules/ui.md', 'rule', 'on-demand'],
    ]);
    const entries = loadOrder({ configDir, root, memoryDir, home: base });
    expect(entries.find((e) => e.kind === 'import' && e.path.endsWith('guide.md'))?.importedFrom).toBe(join(root, 'CLAUDE.md'));
    expect(entries.at(-1)?.paths).toEqual(['apps/ui/**']);
    expect(entries[0]).toMatchObject({ scope: 'personal', lines: 4 });
  });

  it('uses .claude/CLAUDE.md without a root one, and leaves out what is missing', () => {
    write(join(root, '.claude', 'CLAUDE.md'), 'Here.\n');
    expect(order()).toEqual([['project/.claude/CLAUDE.md', 'project', 'launch']]);
    rmSync(join(root, '.claude'), { recursive: true });
    expect(order()).toEqual([]);
  });

  it('cuts MEMORY.md at 200 lines or 25 KB, whichever comes first', () => {
    const lines = (n: number, size = 10) => Array.from({ length: n }, (_, i) => `${String(i).padEnd(size - 1, 'x')}\n`).join('');
    expect(memoryIndexCut(lines(214))).toEqual({ lines: 200, bytes: 2000 });
    expect(memoryIndexCut(lines(150, 200))).toEqual({ lines: 128, bytes: 25_600 });
    expect(memoryIndexCut('a\nb')).toEqual({ lines: 2, bytes: 3 });
    write(join(memoryDir, 'MEMORY.md'), lines(214));
    const memory = loadOrder({ configDir, root, memoryDir, home: base }).find((e) => e.kind === 'memory')!;
    expect(memory).toMatchObject({ lines: 214, loaded: { lines: 200 } });
  });

  it('reads imports relative to the file, from ~ and absolute, but not addresses or bare names', () => {
    expect(importsOf('@a.md @./b/c.md @~/d.md @/abs/e.md @team me@x.com\n```\n@code.md\n```', '/p/CLAUDE.md', '/home')).toEqual(['/p/a.md', '/p/b/c.md', '/home/d.md', '/abs/e.md']);
  });
});
