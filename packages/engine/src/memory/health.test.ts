import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { git } from '../git/gitChanges.ts';
import { encodeProjectPath } from './folders.ts';
import { duplicates, looksLikeRepoPath, referencesIn, sameText } from './health.ts';
import { MemoryService } from './memoryService.ts';

describe('what a memory mentions', () => {
  it('takes paths, npm scripts and make targets, not identifiers, flags or URLs', () => {
    const body = [
      'Run `npm run release`, then `make docs`.',
      'The script is `scripts/release.sh`; see `package.json` and apps/ui/src/styles.css.',
      'Use `useState`, `fs.readFileSync()`, `--force`, `https://x.dev/a/b.md`, `@scope/pkg`, `src/**/*.ts`, `~/notes.md` and `v1.2`.',
      'e.g. Node.js and/or http://example.com/a.ts',
      '```',
      'cat not/a/fact.md',
      '```',
    ].join('\n');
    expect(referencesIn(body)).toEqual({ paths: ['scripts/release.sh', 'package.json', 'apps/ui/src/styles.css'], scripts: ['release'], makeTargets: ['docs'] });
  });

  it('knows a repo path when it sees one', () => {
    expect(looksLikeRepoPath('apps/ui')).toBe(true);
    expect(looksLikeRepoPath('README.md')).toBe(true);
    expect(looksLikeRepoPath('./src/a.ts')).toBe(true);
    expect(['useState', '--dry-run', 'a/b c', 'and/or.', '../up.ts', '/abs/path.ts', 'Node.js'].map(looksLikeRepoPath)).toEqual([false, false, false, false, false, false, false]);
  });

  it('calls two memories duplicates by name, description or text, not loosely', () => {
    const a = { path: '/a/x.md', name: 'release', description: 'npm run release then changelog', body: 'one' };
    expect(duplicates([a, { ...a, path: '/b/x.md' }]).map((f) => f.detail)).toEqual(['release is in two places']);
    expect(duplicates([a, { path: '/a/y.md', name: 'ship', description: 'Then the changelog after npm run release', body: 'two' }])).toHaveLength(1);
    expect(duplicates([a, { path: '/a/y.md', name: 'ship', description: 'Deploys go through CI', body: 'two' }])).toEqual([]);
    expect(sameText('the sidebar shows needs you then working then pinned then by day', 'the sidebar shows needs you then working then pinned then by day too')).toBe(true);
    expect(sameText('the sidebar shows needs you then working first', 'the queue starts the next prompt when a session is idle')).toBe(false);
  });
});

describe('memory health', () => {
  let base: string;
  let root: string;
  let dir: string;
  let personal: string;
  let service: MemoryService;
  const write = (path: string, text: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  const memory = (folder: string, name: string, description: string, body: string) => write(join(folder, `${name}.md`), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`);

  beforeEach(async () => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-health-')));
    root = join(base, 'project');
    dir = join(base, 'config', 'projects', encodeProjectPath(root), 'memory');
    personal = join(base, 'personal');
    write(join(root, 'package.json'), JSON.stringify({ scripts: { check: 'vitest' } }));
    write(join(root, 'src', 'app.ts'), 'x');
    await git(root, ['init', '-q', '-b', 'main']);
    await git(root, ['config', 'user.email', 'test@example.com']);
    await git(root, ['config', 'user.name', 'Test']);
    await git(root, ['add', '.']);
    await git(root, ['commit', '-qm', 'init']);
    service = new MemoryService({ profiles: () => [{ id: 'default', configDir: join(base, 'config') }], personalDir: () => personal, home: base, trash: async () => {} });
    memory(dir, 'release', 'How to release', 'Run `npm run check`, then `scripts/release.sh` and `npm run release`. Edit `src/app.ts` with `useState` and `--force`.');
    memory(dir, 'ok', 'Fine', 'All of `src/app.ts` and `package.json` exist.');
    memory(personal, 'release', 'My release notes', 'Personal, no stale check: `nowhere/at/all.ts`.');
    write(join(dir, 'MEMORY.md'), '- [release](release.md) — How to release\n- [gone](gone.md) — Missing\n');
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it('finds stale references, duplicates, index problems, an index over the limit and old memories', async () => {
    const old = join(dir, 'ok.md');
    const longAgo = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    utimesSync(old, longAgo, longAgo);
    const findings = await service.health(root);
    const by = (kind: string) => findings.filter((f) => f.kind === kind);
    expect(by('staleReference')).toEqual([{ kind: 'staleReference', memoryPaths: [join(dir, 'release.md')], detail: expect.stringContaining('scripts/release.sh'), refs: ['scripts/release.sh', 'npm run release'] }]);
    expect(by('duplicate').map((f) => f.memoryPaths)).toEqual([[join(dir, 'release.md'), join(personal, 'release.md')]]);
    expect(by('indexMismatch').find((f) => f.indexPath === join(dir, 'MEMORY.md'))).toMatchObject({ memoryPaths: [join(dir, 'ok.md')], refs: ['gone.md'] });
    // The personal folder has a memory and no MEMORY.md at all.
    expect(by('indexMismatch').find((f) => f.indexPath === join(personal, 'MEMORY.md'))).toMatchObject({ memoryPaths: [join(personal, 'release.md')] });
    expect(by('old').map((f) => f.memoryPaths)).toEqual([[old]]);
    expect(by('overLimit')).toEqual([]);
    write(join(dir, 'MEMORY.md'), Array.from({ length: 214 }, (_, i) => `- line ${i}\n`).join(''));
    expect((await service.health(root)).find((f) => f.kind === 'overLimit')).toMatchObject({ linesNotLoaded: 14 });
  });

  it('previews and fixes only the index lines that are wrong', async () => {
    const preview = service.fixIndexPreview(root, join(dir, 'MEMORY.md'));
    expect(preview.after).toBe('- [release](release.md) — How to release\n- [ok](ok.md) — Fine\n');
    expect(preview.diff).toContain('-- [gone](gone.md) — Missing');
    expect(preview.diff).toContain('+- [ok](ok.md) — Fine');
    expect(readFileSync(join(dir, 'MEMORY.md'), 'utf8')).toContain('gone.md');
    service.fixIndex(root, join(dir, 'MEMORY.md'));
    expect(readFileSync(join(dir, 'MEMORY.md'), 'utf8')).toBe(preview.after);
    expect((await service.health(root)).some((f) => f.kind === 'indexMismatch' && f.indexPath === join(dir, 'MEMORY.md'))).toBe(false);
    expect(() => service.fixIndexPreview(root, join(root, 'MEMORY.md'))).toThrow(/MEMORY.md/);
  });
});
