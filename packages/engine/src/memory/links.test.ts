import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeProjectPath } from './folders.ts';
import { linkNames, resolveLinks, rewriteLinks } from './links.ts';
import { MemoryService } from './memoryService.ts';

describe('links', () => {
  it('finds [[name]] and [[name|label]] outside code and escapes, each once', () => {
    expect(linkNames('See [[a]], [[b|the b]] and [[a]] again. `[[code]]` \\[[escaped]]\n```\n[[fenced]]\n```\n[[ c ]]')).toEqual(['a', 'b', 'c']);
  });

  it('resolves in the same folder first, then the personal one, and collects backlinks', () => {
    const memories = [
      { path: '/p/memory/a.md', name: 'a', body: 'See [[b]] and [[profile]] and [[ghost]].' },
      { path: '/p/memory/b.md', name: 'b', body: 'Back to [[a]].' },
      { path: '/personal/profile.md', name: 'profile', body: 'Me. See [[b]].' },
      { path: '/personal/b.md', name: 'b', body: 'Personal b.' },
    ];
    const map = resolveLinks(memories, '/personal');
    expect(map['/p/memory/a.md']!.links).toEqual([
      { name: 'b', target: '/p/memory/b.md' },
      { name: 'profile', target: '/personal/profile.md' },
      { name: 'ghost', target: null },
    ]);
    // From the personal folder, its own b comes first.
    expect(map['/personal/profile.md']!.links).toEqual([{ name: 'b', target: '/personal/b.md' }]);
    expect(map['/p/memory/b.md']!.backlinks).toEqual(['/p/memory/a.md']);
    expect(map['/personal/profile.md']!.backlinks).toEqual(['/p/memory/a.md']);
  });

  it('rewrites only the links, keeping labels, code and the frontmatter', () => {
    const text = '---\nname: x\ndescription: about [[old]]\n---\n\nSee [[old]], [[old|the old one]], `[[old]]` and [[older]].\n';
    expect(rewriteLinks(text, 'old', 'new')).toBe('---\nname: x\ndescription: about [[old]]\n---\n\nSee [[new]], [[new|the old one]], `[[old]]` and [[older]].\n');
  });
});

describe('renaming with links', () => {
  let base: string;
  let dir: string;
  let personal: string;
  let service: MemoryService;
  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-links-')));
    const root = join(base, 'project');
    mkdirSync(root);
    dir = join(base, 'config', 'projects', encodeProjectPath(root), 'memory');
    personal = join(base, 'personal');
    mkdirSync(dir, { recursive: true });
    mkdirSync(personal);
    service = new MemoryService({ profiles: () => [{ id: 'default', configDir: join(base, 'config') }], personalDir: () => personal, trash: async () => {} });
    writeFileSync(join(dir, 'design.md'), '---\nname: design\n---\nTokens.\n');
    writeFileSync(join(dir, 'sidebar.md'), '---\nname: sidebar\n---\nSee [[design]] for colours.\n');
    writeFileSync(join(personal, 'me.md'), '---\nname: me\n---\nI care about [[design]] too, and `[[design]]` in code.\n');
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it('updates the links to it when asked, and only then', () => {
    const root = join(base, 'project');
    const kept = service.rename({ root, path: join(dir, 'design.md'), name: 'design-system' });
    expect(kept.updatedLinks).toEqual([]);
    expect(readFileSync(join(dir, 'sidebar.md'), 'utf8')).toContain('[[design]]');
    const moved = service.rename({ root, path: join(dir, 'design-system.md'), name: 'tokens', updateLinks: true });
    expect(moved.updatedLinks).toEqual([]);
    // The links still say [[design]]: they never pointed at design-system. Rename back and follow them.
    service.rename({ root, path: join(dir, 'tokens.md'), name: 'design' });
    const followed = service.rename({ root, path: join(dir, 'design.md'), name: 'tokens', updateLinks: true });
    // A personal memory's [[design]] looks in the personal folder only, so it never pointed here and stays.
    expect(followed.updatedLinks).toEqual([join(dir, 'sidebar.md')]);
    expect(readFileSync(join(dir, 'sidebar.md'), 'utf8')).toBe('---\nname: sidebar\n---\nSee [[tokens]] for colours.\n');
    expect(readFileSync(join(personal, 'me.md'), 'utf8')).toContain('[[design]] too');
    expect(service.links(root)[join(dir, 'tokens.md')]!.backlinks).toEqual([join(dir, 'sidebar.md')]);
  });
});
